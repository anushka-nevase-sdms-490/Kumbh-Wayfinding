"""
Lost-person cases (Phase 6) for authorized operators and admins only.

- Minimal personal data; a child's contact details are masked in lists.
- Every change is a history event; the audit log records only the case
  reference and statuses, never names or contacts.
- `version` stops two operators overwriting each other (409 on a stale write).
- Closed cases are deleted after CASE_RETENTION_DAYS (services/retention.py).
- Off in production until an authority approves it (CASES_ENABLED=1).
- No automatic identity decisions: only people change a case's status.
"""
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..audit import audit
from ..auth import require_operator
from ..config import cases_on, settings
from ..db import LostCase, LostCaseEvent, SosAlert, Volunteer, get_db
from ..schemas import CaseCreate, CaseStatusChange, CaseUpdate
from ..services.retention import purge_expired

router = APIRouter(prefix="/api/ops/cases", tags=["cases"])

# Allowed status changes. CLOSED is final (an admin can reopen to UNDER_REVIEW).
TRANSITIONS = {
    "NEW": {"UNDER_REVIEW", "POSSIBLE_MATCH", "ESCALATED", "REUNITED", "CLOSED"},
    "UNDER_REVIEW": {"POSSIBLE_MATCH", "ESCALATED", "REUNITED", "CLOSED"},
    "POSSIBLE_MATCH": {"UNDER_REVIEW", "ESCALATED", "REUNITED", "CLOSED"},
    "ESCALATED": {"UNDER_REVIEW", "POSSIBLE_MATCH", "REUNITED", "CLOSED"},
    "REUNITED": {"CLOSED"},
    "CLOSED": set(),
}
# These need a note saying what happened.
NEEDS_NOTE = {"REUNITED", "CLOSED", "ESCALATED"}
CASE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"


def _enabled(vol: Volunteer = Depends(require_operator)) -> Volunteer:
    if not cases_on(settings):
        raise HTTPException(404, "Lost-person cases are not enabled on this server")
    return vol


def _mask(contact: str | None) -> str | None:
    if not contact:
        return None
    digits = [c for c in contact if c.isdigit()]
    return "•••• " + "".join(digits[-2:]) if digits else "••••"


def _summary(c: LostCase) -> dict:
    """For lists: enough to find a case; a child's contact is masked."""
    return {
        "case_ref": c.case_ref, "status": c.status, "person_name": c.person_name,
        "approx_age": c.approx_age, "is_child": c.is_child, "description": c.description[:120],
        "last_seen_place_code": c.last_seen_place_code, "last_seen_at": c.last_seen_at,
        "reporter_contact": _mask(c.reporter_contact) if c.is_child else c.reporter_contact,
        "updated_at": c.updated_at, "version": c.version,
    }


def _detail(db: Session, c: LostCase) -> dict:
    events = db.query(LostCaseEvent).filter(LostCaseEvent.case_id == c.id).order_by(LostCaseEvent.id).all()
    return {
        **_summary(c),
        "gender": c.gender, "description": c.description, "languages": c.languages,
        "last_seen_note": c.last_seen_note, "reporter_name": c.reporter_name,
        "reporter_contact": c.reporter_contact, "outcome_note": c.outcome_note, "sos_id": c.sos_id,
        "created_at": c.created_at, "closed_at": c.closed_at,
        "allowed": sorted(TRANSITIONS.get(c.status, set())),
        "history": [
            {"at": e.at, "actor": e.actor_name, "action": e.action, "from": e.from_status,
             "to": e.to_status, "note": e.note}
            for e in events
        ],
    }


def _event(db: Session, c: LostCase, vol: Volunteer, action: str, frm=None, to=None, note=None):
    db.add(LostCaseEvent(case_id=c.id, actor_name=vol.name, action=action, from_status=frm, to_status=to,
                         note=(note or "")[:200] or None))


def _case(db: Session, ref: str) -> LostCase:
    c = db.query(LostCase).filter(LostCase.case_ref == ref.strip().upper()).first()
    if c is None:
        raise HTTPException(404, "No such case")
    return c


def _apply(c: LostCase, body) -> None:
    for f in ("person_name", "approx_age", "gender", "description", "languages", "last_seen_place_code",
              "last_seen_note", "last_seen_at", "reporter_name", "reporter_contact"):
        v = getattr(body, f)
        setattr(c, f, v.strip() if isinstance(v, str) else v)
    c.is_child = c.approx_age is not None and c.approx_age < 18


@router.get("")
def list_cases(status: str = "open", q: str = "", db: Session = Depends(get_db), vol: Volunteer = Depends(_enabled)):
    purge_expired(db)
    query = db.query(LostCase)
    if status == "open":
        query = query.filter(LostCase.status != "CLOSED")
    elif status.upper() in TRANSITIONS:
        query = query.filter(LostCase.status == status.upper())
    if q.strip():
        like = f"%{q.strip()}%"
        query = query.filter(
            (LostCase.case_ref.ilike(like)) | (LostCase.person_name.ilike(like))
            | (LostCase.description.ilike(like)) | (LostCase.last_seen_note.ilike(like))
        )
    return [_summary(c) for c in query.order_by(LostCase.updated_at.desc()).limit(200)]


@router.post("", status_code=201)
def create_case(body: CaseCreate, db: Session = Depends(get_db), vol: Volunteer = Depends(_enabled)):
    if body.sos_id is not None and db.get(SosAlert, body.sos_id) is None:
        raise HTTPException(400, "No such SOS alert")
    for _ in range(20):
        ref = "LP-" + "".join(secrets.choice(CASE_ALPHABET) for _ in range(5))
        if not db.query(LostCase).filter(LostCase.case_ref == ref).first():
            break
    else:
        raise HTTPException(503, "Could not make a case number — try again")
    now = datetime.utcnow()
    c = LostCase(case_ref=ref, status="NEW", sos_id=body.sos_id, created_by=vol.id, updated_by=vol.id,
                 created_at=now, updated_at=now, version=1)
    _apply(c, body)
    db.add(c)
    db.flush()
    _event(db, c, vol, "created", to="NEW")
    audit(db, vol, "case.create", f"case:{ref}", f"Case {ref} opened" + (" (child)" if c.is_child else ""))
    db.commit()
    return _detail(db, c)


@router.get("/{ref}")
def get_case(ref: str, db: Session = Depends(get_db), vol: Volunteer = Depends(_enabled)):
    return _detail(db, _case(db, ref))


def _check_version(c: LostCase, version: int) -> None:
    if version != c.version:
        raise HTTPException(409, "Someone else changed this case — reload it and try again")


@router.put("/{ref}")
def update_case(ref: str, body: CaseUpdate, db: Session = Depends(get_db), vol: Volunteer = Depends(_enabled)):
    c = _case(db, ref)
    _check_version(c, body.version)
    if c.status == "CLOSED":
        raise HTTPException(409, "This case is closed")
    _apply(c, body)
    c.version += 1
    c.updated_at, c.updated_by = datetime.utcnow(), vol.id
    _event(db, c, vol, "edited")
    audit(db, vol, "case.edit", f"case:{c.case_ref}", f"Case {c.case_ref} details updated")
    # Atomic version check: a parallel writer that read the same version loses.
    updated = (
        db.query(LostCase).filter(LostCase.id == c.id, LostCase.version == body.version)
        .update({LostCase.version: body.version + 1}, synchronize_session=False)
    )
    if not updated:
        db.rollback()
        raise HTTPException(409, "Someone else changed this case — reload it and try again")
    db.commit()
    return _detail(db, c)


@router.post("/{ref}/status")
def change_status(ref: str, body: CaseStatusChange, db: Session = Depends(get_db), vol: Volunteer = Depends(_enabled)):
    c = _case(db, ref)
    _check_version(c, body.version)
    frm, to = c.status, body.to
    reopen = frm == "CLOSED" and to == "UNDER_REVIEW" and vol.role == "admin"
    if to not in TRANSITIONS.get(frm, set()) and not reopen:
        raise HTTPException(400, f"A case cannot go from {frm} to {to}")
    note = (body.note or "").strip()
    if to in NEEDS_NOTE and not note:
        raise HTTPException(400, f"Say what happened when marking a case {to}")
    updated = (
        db.query(LostCase).filter(LostCase.id == c.id, LostCase.version == body.version)
        .update({LostCase.version: body.version + 1}, synchronize_session=False)
    )
    if not updated:
        db.rollback()
        raise HTTPException(409, "Someone else changed this case — reload it and try again")
    db.refresh(c)
    c.status = to
    c.updated_at, c.updated_by = datetime.utcnow(), vol.id
    if to in ("REUNITED", "CLOSED"):
        c.outcome_note = note or c.outcome_note
    c.closed_at = datetime.utcnow() if to == "CLOSED" else None
    _event(db, c, vol, "reopened" if reopen else "status", frm, to, note)
    audit(db, vol, "case.status", f"case:{c.case_ref}", f"Case {c.case_ref}: {frm} → {to}")
    db.commit()
    return _detail(db, c)
