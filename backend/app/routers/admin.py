"""Admin map data: every place and lane (blocked ones too) and pending reports."""
import json
import secrets
from datetime import datetime, timedelta

from sqlalchemy.exc import IntegrityError

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..audit import audit
from ..auth import require_admin, require_operator
from ..db import AuditLog, Edge, QrNode, Volunteer, get_db
from ..config import publishing_manual, settings
from ..db import DatasetRelease
from ..schemas import (
    AdminOverview,
    BoardRequest,
    PlaceAccessRequest,
    PlaceStatusRequest,
    PublishRequest,
    RollbackRequest,
    VerifyRequest,
)
from ..services.graph_report import validate
from ..services.osm_network import is_network_junction_code
from ..services.pack_builder import (
    CLOSURE_FIELDS,
    PLACE_LIVE_FIELDS,
    draft_data,
    ensure_current_pack,
    expire_blocks,
    live_release,
    publish,
    roll_back,
)
from .reports import list_reports

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/overview", response_model=AdminOverview)
def overview(db: Session = Depends(get_db), admin: Volunteer = Depends(require_admin)):
    expire_blocks(db)
    nodes = db.query(QrNode).all()
    return AdminOverview(
        places=[
            {
                "code": n.code,
                "name": n.name,
                "lat": n.lat,
                "lon": n.lon,
                "node_type": n.node_type,
                "confirmed": n.gps_accuracy_m is not None,
                "verification": n.verification or "unverified",
                "verification_note": n.verification_note,
                "op_status": n.op_status,
                "op_status_until": n.op_status_until,
                "op_status_note": n.op_status_note,
                "step_free": n.step_free,
                "access": n.access,
                "access_note": n.access_note,
                "board_code": n.board_code,
            }
            for n in nodes
            if not is_network_junction_code(n.code)
        ],
        # Junctions are needed to draw lanes; the map does not list them.
        junctions={n.code: (n.lat, n.lon) for n in nodes if is_network_junction_code(n.code)},
        lanes=[
            {
                "id": e.id,
                "from_code": e.from_code,
                "to_code": e.to_code,
                "source": e.source,
                "verified": e.verified,
                "walkable": e.walkable,
                "blocked": e.blocked,
                "blocked_until": e.blocked_until,
                "door_state": e.door_state,
                "passage_kind": e.passage_kind or "corridor",
                "obstacle_note": e.obstacle_note,
                "name": e.name,
                "distance_m": e.distance_m,
                "path_json": e.path_json,
                "verification": e.verification or "unverified",
                "verification_note": e.verification_note,
            }
            for e in db.query(Edge).all()
        ],
        reports=list_reports(status="pending", lat=None, lon=None, db=db, vol=admin),
    )


@router.get("/graph-report")
def graph_report(db: Session = Depends(get_db), admin: Volunteer = Depends(require_admin)):
    """Data checks for the admin map (same as scripts/validate_graph.py)."""
    return validate(db)


# Fields that do not make a place or lane "changed" for publishing: closures go
# live anyway, timestamps change on every touch.
_NOT_A_CHANGE = set(CLOSURE_FIELDS) | set(PLACE_LIVE_FIELDS) | {"created_at", "updated_at", "verified_at"}


def _changes(old: list[dict], new: list[dict], key: str) -> tuple[list, list, list]:
    o = {x[key]: x for x in old}
    n = {x[key]: x for x in new}
    same = lambda a, b: {k: v for k, v in a.items() if k not in _NOT_A_CHANGE} == {  # noqa: E731
        k: v for k, v in b.items() if k not in _NOT_A_CHANGE
    }
    return (
        [k for k in n if k not in o],
        [k for k in o if k not in n],
        [k for k in n if k in o and not same(n[k], o[k])],
    )


def _release_info(r: DatasetRelease) -> dict:
    return {
        "id": r.id, "created_at": r.created_at, "by": r.published_by_name, "note": r.note,
        "node_count": r.node_count, "edge_count": r.edge_count, "active": r.active,
    }


@router.get("/releases")
def releases(db: Session = Depends(get_db), admin: Volunteer = Depends(require_admin)):
    """
    Published versions and what is waiting to be published (PUBLISH_MODE=manual).
    Closures, reopenings and rejections are never waiting: they are live.
    """
    if not publishing_manual(settings):
        return {"mode": "auto", "live": None, "draft": None, "unpublished_closures": 0, "releases": []}
    live = live_release(db)
    content = json.loads(live.content_json)
    nodes, edges = draft_data(db)
    junction = is_network_junction_code
    pa, pr, pc = _changes([n for n in content["nodes"] if not junction(n["code"])],
                          [n for n in nodes if not junction(n["code"])], "code")
    la, lr, lc = _changes(content["edges"], edges, "id")
    names = {n["code"]: n["name"] for n in nodes} | {n["code"]: n["name"] for n in content["nodes"]}
    published_ids = {e["id"] for e in content["edges"]}
    closed_new = sum(
        1 for e in db.query(Edge).filter(
            (Edge.blocked.is_(True)) | (Edge.walkable.is_(False)) | (Edge.door_state == "closed")
        ) if e.id not in published_ids
    )
    rows = db.query(DatasetRelease).order_by(DatasetRelease.id.desc()).limit(20).all()
    return {
        "mode": "manual",
        "live": _release_info(live),
        "draft": {
            "places_added": len(pa), "places_removed": len(pr), "places_changed": len(pc),
            "lanes_added": len(la), "lanes_removed": len(lr), "lanes_changed": len(lc),
            "examples": [f"new place: {names.get(c, c)}" for c in pa[:5]]
            + [f"changed: {names.get(c, c)}" for c in pc[:5]]
            + [f"removed: {names.get(c, c)}" for c in pr[:5]],
        },
        # Closed lanes phones do not have yet (new since the last publish): their closure waits too.
        "unpublished_closures": closed_new,
        "releases": [_release_info(r) for r in rows],
    }


@router.post("/publish")
def publish_data(body: PublishRequest, db: Session = Depends(get_db), admin: Volunteer = Depends(require_admin)):
    """Make the current data the version visitors' phones get."""
    if not publishing_manual(settings):
        raise HTTPException(409, "Publishing is off (PUBLISH_MODE=auto): every change is already live")
    row = publish(db, admin, body.note)
    ensure_current_pack(db)
    return {"success": True, "release": _release_info(row)}


@router.post("/rollback")
def rollback_data(body: RollbackRequest, db: Session = Depends(get_db), admin: Volunteer = Depends(require_admin)):
    """Phones go back to an earlier published version; closures stay live; the database is unchanged."""
    if not publishing_manual(settings):
        raise HTTPException(409, "Publishing is off (PUBLISH_MODE=auto): there are no versions to roll back to")
    row = roll_back(db, admin, body.release_id)
    if row is None:
        raise HTTPException(404, "No such version")
    ensure_current_pack(db)
    return {"success": True, "release": _release_info(row)}


@router.get("/audit")
def audit_log(
    limit: int = 100,
    target: str | None = None,
    db: Session = Depends(get_db),
    admin: Volunteer = Depends(require_admin),
):
    """Recent data changes, newest first (optionally for one place:CODE / lane:ID)."""
    q = db.query(AuditLog)
    if target:
        q = q.filter(AuditLog.target == target)
    rows = q.order_by(AuditLog.id.desc()).limit(max(1, min(limit, 500))).all()
    return [
        {"at": r.at, "actor": r.actor_name, "action": r.action, "target": r.target, "summary": r.summary}
        for r in rows
    ]


def _place(db: Session, code: str) -> QrNode:
    row = db.query(QrNode).filter(QrNode.code == code.strip().upper()).first()
    if row is None or is_network_junction_code(row.code):
        raise HTTPException(404, "No such place")
    return row


@router.post("/place-status")
def set_place_status(
    body: PlaceStatusRequest, db: Session = Depends(get_db), vol: Volunteer = Depends(require_operator)
):
    """
    Open / limited / closed, valid for a number of hours: after that the app
    says "status not confirmed" instead of a stale "open". Live: reaches
    phones at once, like a lane closure.
    """
    row = _place(db, body.code)
    now = datetime.utcnow()
    if body.status == "unknown":
        row.op_status = row.op_status_until = row.op_status_note = None
    else:
        row.op_status = body.status
        row.op_status_until = now + timedelta(hours=body.hours)
        row.op_status_note = (body.note or "").strip() or None
    row.op_status_at, row.op_status_by = now, vol.id
    audit(db, vol, "place.status", f"place:{row.code}",
          f"{row.name}: {body.status}" + (f" for {body.hours:g} h" if body.status != "unknown" else "")
          + (f" — {row.op_status_note}" if row.op_status_note else ""))
    db.commit()
    ensure_current_pack(db)
    return {"success": True, "op_status": row.op_status, "op_status_until": row.op_status_until}


@router.post("/place-access")
def set_place_access(
    body: PlaceAccessRequest, db: Session = Depends(get_db), admin: Volunteer = Depends(require_admin)
):
    """Step-free access and access restrictions (published with the data)."""
    row = _place(db, body.code)
    row.step_free, row.access = body.step_free, body.access
    row.access_note = (body.access_note or "").strip() or None
    row.updated_by = admin.id
    audit(db, admin, "place.access", f"place:{row.code}",
          f"{row.name}: step-free {body.step_free}, access {body.access or 'not set'}"
          + (f" — {row.access_note}" if row.access_note else ""))
    db.commit()
    ensure_current_pack(db)
    return {"success": True}


# Board codes: 5 characters without look-alikes (no 0/O, 1/I/L).
BOARD_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"


def _new_board_code(db: Session) -> str:
    for _ in range(50):
        code = "".join(secrets.choice(BOARD_ALPHABET) for _ in range(5))
        taken = db.query(QrNode).filter(QrNode.board_code == code).first()
        # A retired code is never given to another place (boards may still hang there).
        used_before = db.query(AuditLog).filter(AuditLog.target == f"board:{code}").first()
        if not taken and not used_before:
            return code
    raise HTTPException(503, "Could not make a unique board code — try again")


@router.post("/board")
def create_board(body: BoardRequest, db: Session = Depends(get_db), admin: Volunteer = Depends(require_admin)):
    """
    Give a place a board code for a printed QR board. The QR holds
    https://<site>/?at=<code>; the code is also printed for typing. A place
    keeps its code: asking again returns the same one.
    """
    row = _place(db, body.code)
    if row.verification == "rejected":
        raise HTTPException(400, "This place is rejected — it cannot have a board")
    if row.board_code:
        return {"success": True, "board_code": row.board_code, "created": False}
    row.board_code = _new_board_code(db)
    audit(db, admin, "board.create", f"board:{row.board_code}", f"Board {row.board_code} for {row.name} ({row.code})")
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "That board code was just taken — try again")
    ensure_current_pack(db)
    return {"success": True, "board_code": row.board_code, "created": True}


@router.post("/board/retire")
def retire_board(body: BoardRequest, db: Session = Depends(get_db), admin: Volunteer = Depends(require_admin)):
    """A board on the wrong place (or removed): its code stops working and is never reused."""
    row = _place(db, body.code)
    if not row.board_code:
        raise HTTPException(404, "This place has no board code")
    old = row.board_code
    row.board_code = None
    audit(db, admin, "board.retire", f"board:{old}", f"Board {old} retired from {row.name} ({row.code})")
    db.commit()
    ensure_current_pack(db)
    return {"success": True, "retired": old}


@router.get("/boards")
def list_boards(db: Session = Depends(get_db), admin: Volunteer = Depends(require_admin)):
    rows = db.query(QrNode).filter(QrNode.board_code.isnot(None)).order_by(QrNode.name).all()
    return [{"code": r.code, "name": r.name, "local_name": r.local_name, "board_code": r.board_code} for r in rows]


@router.post("/verify")
def set_verification(
    body: VerifyRequest, db: Session = Depends(get_db), admin: Volunteer = Depends(require_admin)
):
    """
    Set the trust level of one place or lane — a person's decision, recorded
    with who and why. `rejected` hides it from visitors (kept for the record).
    """
    if body.target == "place":
        row = db.query(QrNode).filter(QrNode.code == (body.code or "").strip().upper()).first()
        if row is None or is_network_junction_code(row.code):
            raise HTTPException(404, "No such place")
    else:
        row = db.get(Edge, body.lane_id) if body.lane_id is not None else None
        if row is None:
            raise HTTPException(404, "No such lane")
    before = row.verification or "unverified"
    name = row.name if body.target == "place" else f"{row.from_code} ↔ {row.to_code}"
    target = f"place:{row.code}" if body.target == "place" else f"lane:{row.id}"
    audit(db, admin, "trust.set", target,
          f"{name}: {before} → {body.status}" + (f" — {body.note.strip()}" if (body.note or "").strip() else ""))
    row.verification = body.status
    row.verified_by = admin.id
    if body.target == "place" and body.status in ("remotely_reviewed", "volunteer_verified", "officially_verified"):
        row.verified_at = datetime.utcnow()
    row.verification_note = (body.note or "").strip() or None
    row.updated_by = admin.id
    db.commit()
    ensure_current_pack(db)
    return {"success": True, "status": row.verification}
