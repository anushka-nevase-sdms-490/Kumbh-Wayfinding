"""Delete personal data once it is no longer needed (SOS alerts, closed cases)."""
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from ..config import settings
from ..db import LostCase, LostCaseEvent, SosAlert

# An alert nobody resolved is closed as "expired" after this long (the phone
# says so); the retention time then counts from that moment.
SOS_OPEN_MAX = timedelta(hours=48)


def purge_expired(db: Session) -> dict:
    """Resolved SOS alerts and closed cases past their retention time. Returns counts."""
    now = datetime.utcnow()
    expired = (
        db.query(SosAlert)
        .filter(SosAlert.status.in_(("received", "acknowledged")), SosAlert.created_at < now - SOS_OPEN_MAX)
        .update({SosAlert.status: "expired", SosAlert.resolved_at: now}, synchronize_session=False)
    )
    sos = (
        db.query(SosAlert)
        .filter(SosAlert.status.in_(("resolved", "expired")),
                SosAlert.resolved_at < now - timedelta(days=settings.sos_retention_days))
        .delete(synchronize_session=False)
    )
    old = [
        cid for (cid,) in db.query(LostCase.id).filter(
            LostCase.status == "CLOSED",
            LostCase.closed_at < now - timedelta(days=settings.case_retention_days),
        )
    ]
    if old:
        # Explicit, so it also works where the database does not cascade (SQLite without FKs).
        db.query(LostCaseEvent).filter(LostCaseEvent.case_id.in_(old)).delete(synchronize_session=False)
        db.query(LostCase).filter(LostCase.id.in_(old)).delete(synchronize_session=False)
    if sos or old or expired:
        db.commit()
    return {"sos": sos, "expired": expired, "cases": len(old)}
