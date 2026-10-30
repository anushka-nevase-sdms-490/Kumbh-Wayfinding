"""Record data changes in the audit log (db.AuditLog)."""
from sqlalchemy.orm import Session

from .db import AuditLog, Volunteer


def audit(db: Session, actor: Volunteer | None, action: str, target: str, summary: str) -> None:
    """Add an entry; it is committed together with the change it describes."""
    db.add(
        AuditLog(
            volunteer_id=actor.id if actor else None,
            actor_name=actor.name if actor else "script",
            action=action,
            target=target[:96],
            summary=summary[:400],
        )
    )
