"""Boot-time data setup.

No demo places are seeded: volunteers register real Nashik Kumbh boards
(official places from kumbhguidenashik.in/map, plus lane corners) and walk
the lanes between them. Older databases still hold the fictional SETU-*
demo grid, so it is removed here.
"""

from sqlalchemy import or_
from sqlalchemy.orm import Session

from .db import AuditPhoto, Edge, PackVersion, QrNode, SessionLocal, init_db
from .services.pack_builder import build_offline_pack

DEMO_CODE_PREFIX = "SETU-"


def _remove_demo_places(db: Session) -> int:
    like = f"{DEMO_CODE_PREFIX}%"
    edges = (
        db.query(Edge)
        .filter(or_(Edge.from_code.like(like), Edge.to_code.like(like)))
        .delete(synchronize_session=False)
    )
    db.query(AuditPhoto).filter(AuditPhoto.code.like(like)).delete(
        synchronize_session=False
    )
    nodes = (
        db.query(QrNode)
        .filter(QrNode.code.like(like))
        .delete(synchronize_session=False)
    )
    db.commit()
    if nodes or edges:
        print(f"Removed demo data: {nodes} SETU-* places, {edges} lanes.")
    return nodes + edges


def seed(db: Session | None = None):
    close = False
    if db is None:
        init_db()
        db = SessionLocal()
        close = True
    try:
        removed = _remove_demo_places(db)
        if removed or db.query(PackVersion).count() == 0:
            pack, path = build_offline_pack(db)
            print(f"Built pack {pack.version} → {path}")
    finally:
        if close:
            db.close()


if __name__ == "__main__":
    seed()
