"""
SOS alerts (Phase 6): visitors send "I need help" — no account, works from the
offline queue on the phone — and operators acknowledge and resolve them.

Truthful states on the phone: Pending (saved on the phone) → Sent (this
server stored it: 201/200 with an id) → Acknowledged (an operator confirmed
it). Setu does not contact the police or an ambulance.
"""
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..audit import audit
from ..auth import require_operator
from ..db import SosAlert, Volunteer, get_db
from ..schemas import SosAck, SosCreate, SosResolve
from ..services.retention import purge_expired
from .reports import _device_hash, _reporter_hash

# A database id from the URL: larger values are refused (422), not a 500.
RowId = Annotated[int, Path(ge=1, le=2_147_483_647)]

router = APIRouter(tags=["sos"])

# New alerts per phone per hour. There is NO refusal per network address: at
# the mela thousands of phones share a few carrier addresses (CGNAT), and an
# SOS must never be refused because of other people. Past this many alerts an
# hour from one address, alerts are accepted but marked as a possible flood.
MAX_SOS_PER_DEVICE_HOUR = 5
FLOOD_MARK_PER_IP_HOUR = 60
# Open alerts the operator console lists (all of them in practice).
OPEN_LIST_LIMIT = 5000


def _public(a: SosAlert) -> dict:
    """What the sending phone may see: the state, never other people's data."""
    return {
        "id": a.id,
        "status": a.status,
        "received_at": a.created_at,
        "ack_at": a.ack_at,
        "ack_message": a.ack_message,
        "resolved_at": a.resolved_at,
    }


@router.post("/api/sos", status_code=201)
def create_sos(body: SosCreate, request: Request, response: Response, db: Session = Depends(get_db)):
    existing = db.query(SosAlert).filter(SosAlert.client_id == body.client_id).first()
    if existing:
        # The phone resent it (lost answer, retry): same alert, never a second one.
        response.status_code = 200
        return {**_public(existing), "duplicate": True}
    ip_hash = _reporter_hash(request)
    device_hash = _device_hash(body.device, ip_hash)
    hour_ago = datetime.utcnow() - timedelta(hours=1)
    by_device = db.query(SosAlert).filter(SosAlert.device_hash == device_hash, SosAlert.created_at > hour_ago).count()
    by_ip = db.query(SosAlert).filter(SosAlert.ip_hash == ip_hash, SosAlert.created_at > hour_ago).count()
    if by_device >= MAX_SOS_PER_DEVICE_HOUR:
        raise HTTPException(429, "Too many alerts from this phone — go to the nearest help desk or call 112")
    alert = SosAlert(
        client_id=body.client_id, kind=body.kind, note=(body.note or "").strip() or None,
        lat=body.lat, lon=body.lon, accuracy_m=body.accuracy_m, place_code=body.place_code,
        lang=body.lang, device_hash=device_hash, ip_hash=ip_hash, asked_at=_asked_at(body.created_at),
        flood_suspect=by_ip >= FLOOD_MARK_PER_IP_HOUR,
    )
    db.add(alert)
    try:
        db.commit()
    except IntegrityError:  # the same client_id arriving twice at once
        db.rollback()
        existing = db.query(SosAlert).filter(SosAlert.client_id == body.client_id).first()
        response.status_code = 200
        return {**_public(existing), "duplicate": True}
    db.refresh(alert)
    return {**_public(alert), "duplicate": False}


@router.get("/api/sos/{client_id}")
def sos_status(client_id: str, db: Session = Depends(get_db)):
    """The phone asks for its own alert's state (the random client_id is the key)."""
    alert = db.query(SosAlert).filter(SosAlert.client_id == client_id).first()
    if alert is None:
        raise HTTPException(404, "No such alert")
    return _public(alert)


def _asked_at(t: datetime | None) -> datetime | None:
    """The phone's "sent at" time as naive UTC; dropped when the clock is clearly
    wrong (in the future, or more than 3 days back; such an alert is still
    accepted, only without this time)."""
    if t is None:
        return None
    if t.tzinfo is not None:
        t = t.astimezone(timezone.utc).replace(tzinfo=None)
    now = datetime.utcnow()
    return t if now - timedelta(days=3) <= t <= now + timedelta(minutes=5) else None


def _ops_view(a: SosAlert) -> dict:
    return {
        "id": a.id, "kind": a.kind, "note": a.note, "lat": a.lat, "lon": a.lon, "asked_at": a.asked_at,
        "accuracy_m": a.accuracy_m, "place_code": a.place_code, "lang": a.lang,
        "created_at": a.created_at, "status": a.status, "ack_at": a.ack_at,
        "ack_message": a.ack_message, "resolved_at": a.resolved_at, "flood_suspect": a.flood_suspect,
    }


@router.get("/api/ops/sos")
def list_sos(status: str = "open", db: Session = Depends(get_db), vol: Volunteer = Depends(require_operator)):
    """Operators: open alerts (received or acknowledged), newest first; or all recent ones."""
    purge_expired(db)
    q = db.query(SosAlert)
    if status == "open":
        q = q.filter(SosAlert.status.in_(("received", "acknowledged")))
    # Possible-flood alerts after the others; newest first. Open alerts are
    # all listed (the limit is only a safety net): a cut-off at 200 let a flood
    # of fake alerts, or a busy day, push the longest-waiting real ones out.
    limit = OPEN_LIST_LIMIT if status == "open" else 200
    return [_ops_view(a) for a in q.order_by(SosAlert.flood_suspect, SosAlert.created_at.desc()).limit(limit)]


def _alert(db: Session, alert_id: int) -> SosAlert:
    a = db.get(SosAlert, alert_id)
    if a is None:
        raise HTTPException(404, "No such alert")
    return a


@router.post("/api/ops/sos/{alert_id}/ack")
def ack_sos(alert_id: RowId, body: SosAck, db: Session = Depends(get_db), vol: Volunteer = Depends(require_operator)):
    a = _alert(db, alert_id)
    if a.status in ("resolved", "expired"):
        raise HTTPException(409, f"This alert is already {a.status}")
    a.status = "acknowledged"
    a.ack_at = a.ack_at or datetime.utcnow()
    a.ack_by = vol.id
    a.ack_message = (body.message or "").strip() or None
    # No note or location in the audit log: the alert holds those, and is deleted later.
    audit(db, vol, "sos.ack", f"sos:{a.id}", f"SOS #{a.id} ({a.kind}) acknowledged")
    db.commit()
    return _ops_view(a)


@router.post("/api/ops/sos/{alert_id}/resolve")
def resolve_sos(alert_id: RowId, body: SosResolve, db: Session = Depends(get_db), vol: Volunteer = Depends(require_operator)):
    a = _alert(db, alert_id)
    if a.status not in ("resolved", "expired"):
        a.status = "resolved"
        a.resolved_at = datetime.utcnow()
        a.resolved_by = vol.id
        audit(db, vol, "sos.resolve", f"sos:{a.id}", f"SOS #{a.id} ({a.kind}) resolved")
        db.commit()
    return _ops_view(a)


@router.get("/api/ops/summary")
def ops_summary(db: Session = Depends(get_db), vol: Volunteer = Depends(require_operator)):
    """Today's operations at a glance (operators and admins): counts only, no personal data."""
    from statistics import median

    from ..config import cases_on, settings
    from ..db import BlockReport, Edge, LostCase, QrNode

    purge_expired(db)
    now = datetime.utcnow()
    open_q = db.query(SosAlert).filter(SosAlert.status.in_(("received", "acknowledged")))
    acks = [
        (a.ack_at - a.created_at).total_seconds() / 60
        for a in db.query(SosAlert).filter(SosAlert.ack_at.isnot(None), SosAlert.created_at > now - timedelta(hours=24))
    ]
    cases = None
    if cases_on(settings):
        cases = {s: 0 for s in ("NEW", "UNDER_REVIEW", "POSSIBLE_MATCH", "ESCALATED", "REUNITED")}
        for (s,) in db.query(LostCase.status).filter(LostCase.status != "CLOSED"):
            cases[s] = cases.get(s, 0) + 1
    places = db.query(QrNode).filter(QrNode.op_status.isnot(None)).all()
    return {
        "sos": {
            "unacknowledged": open_q.filter(SosAlert.status == "received").count(),
            "acknowledged_open": open_q.filter(SosAlert.status == "acknowledged").count(),
            "possible_flood_open": open_q.filter(SosAlert.flood_suspect.is_(True)).count(),
            "median_minutes_to_ack_24h": round(median(acks), 1) if acks else None,
        },
        "cases": cases,
        "facilities": {
            "closed_now": sum(1 for p in places if p.op_status == "closed" and p.op_status_until and p.op_status_until > now),
            "status_expired": sum(1 for p in places if p.op_status_until and p.op_status_until <= now),
        },
        "boards": db.query(QrNode).filter(QrNode.board_code.isnot(None)).count(),
        "closed_lanes": db.query(Edge).filter((Edge.blocked.is_(True)) | (Edge.door_state == "closed")).count(),
        "pending_visitor_reports": db.query(BlockReport).filter(BlockReport.status == "pending").count(),
    }
