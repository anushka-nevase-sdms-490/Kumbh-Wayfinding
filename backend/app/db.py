from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
)
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    pass


class QrNode(Base):
    __tablename__ = "qr_nodes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(32), unique=True, nullable=False, index=True)
    name = Column(String(128), nullable=False)
    local_name = Column(String(128), nullable=True)
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    node_type = Column(String(32), nullable=False, default="junction")
    # ghat | parking | medical | lost_found | toilet | transport | junction | help | landmark
    icon = Column(String(32), nullable=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Edge(Base):
    __tablename__ = "edges"

    id = Column(Integer, primary_key=True, autoincrement=True)
    from_code = Column(String(32), ForeignKey("qr_nodes.code"), nullable=False, index=True)
    to_code = Column(String(32), ForeignKey("qr_nodes.code"), nullable=False, index=True)
    distance_m = Column(Float, nullable=False)
    surface = Column(String(32), nullable=False, default="paved")  # paved | sand | steps
    walkable = Column(Boolean, nullable=False, default=True)
    bidirectional = Column(Boolean, nullable=False, default=True)
    # Compass degrees when leaving from_code toward to_code along the REAL walk
    # (around desks/glass) — not the straight GPS line.
    heading_ab = Column(Float, nullable=True)
    # Compass degrees when leaving to_code toward from_code along the real walk.
    heading_ba = Column(Float, nullable=True)
    # corridor | door | glass_door | passage — doors need open/closed handling.
    passage_kind = Column(String(32), nullable=False, default="corridor")
    # none | open | closed | unknown — closed doors are not used for routing.
    door_state = Column(String(16), nullable=False, default="none")
    # Dynamic block (barricade, temporary structure, reported obstacle).
    blocked = Column(Boolean, nullable=False, default=False)
    # Optional obstacle label for staff: wall | glass | desk | barricade | …
    obstacle_note = Column(String(64), nullable=True)
    # Physical clearance along the path (m). Low clearance raises path cost.
    clearance_m = Column(Float, nullable=True)
    # Extra cost multiplier (≥1). Used for safety buffer / hard segments.
    cost_mult = Column(Float, nullable=False, default=1.0)
    # Volunteer walked this corridor once — trusted walkable path.
    verified = Column(Boolean, nullable=False, default=False)
    verified_at = Column(DateTime, nullable=True)
    # JSON list of {lat, lon, heading_deg?} samples along the real walk.
    path_json = Column(Text, nullable=True)


class AuditPhoto(Base):
    __tablename__ = "audit_photos"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(32), ForeignKey("qr_nodes.code"), nullable=False, index=True)
    object_key = Column(String(256), nullable=False)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class PackVersion(Base):
    __tablename__ = "pack_versions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    version = Column(String(32), unique=True, nullable=False)
    file_path = Column(String(512), nullable=False)
    signature = Column(String(128), nullable=False)
    node_count = Column(Integer, nullable=False, default=0)
    edge_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)


def _make_engine():
    if settings.use_sqlite:
        url = f"sqlite:///{settings.sqlite_path}"
        return create_engine(url, connect_args={"check_same_thread": False})
    return create_engine(settings.database_url, pool_pre_ping=True)


engine = _make_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db():
    Base.metadata.create_all(bind=engine)
    _ensure_sqlite_columns()


def _ensure_sqlite_columns():
    """Add new columns on existing SQLite files (create_all won't alter)."""
    if not settings.use_sqlite:
        return
    from sqlalchemy import text

    with engine.begin() as conn:
        rows = conn.execute(text("PRAGMA table_info(qr_nodes)")).fetchall()
        names = {r[1] for r in rows}
        if "local_name" not in names:
            conn.execute(
                text("ALTER TABLE qr_nodes ADD COLUMN local_name VARCHAR(128)")
            )

        edge_rows = conn.execute(text("PRAGMA table_info(edges)")).fetchall()
        edge_names = {r[1] for r in edge_rows}
        if "heading_ab" not in edge_names:
            conn.execute(text("ALTER TABLE edges ADD COLUMN heading_ab FLOAT"))
        if "heading_ba" not in edge_names:
            conn.execute(text("ALTER TABLE edges ADD COLUMN heading_ba FLOAT"))
        if "passage_kind" not in edge_names:
            conn.execute(
                text(
                    "ALTER TABLE edges ADD COLUMN passage_kind VARCHAR(32) DEFAULT 'corridor'"
                )
            )
        if "door_state" not in edge_names:
            conn.execute(
                text(
                    "ALTER TABLE edges ADD COLUMN door_state VARCHAR(16) DEFAULT 'none'"
                )
            )
        if "blocked" not in edge_names:
            conn.execute(
                text("ALTER TABLE edges ADD COLUMN blocked BOOLEAN DEFAULT 0")
            )
        if "obstacle_note" not in edge_names:
            conn.execute(
                text("ALTER TABLE edges ADD COLUMN obstacle_note VARCHAR(64)")
            )
        if "clearance_m" not in edge_names:
            conn.execute(text("ALTER TABLE edges ADD COLUMN clearance_m FLOAT"))
        if "cost_mult" not in edge_names:
            conn.execute(
                text("ALTER TABLE edges ADD COLUMN cost_mult FLOAT DEFAULT 1.0")
            )
        if "verified" not in edge_names:
            conn.execute(
                text("ALTER TABLE edges ADD COLUMN verified BOOLEAN DEFAULT 0")
            )
        if "verified_at" not in edge_names:
            conn.execute(text("ALTER TABLE edges ADD COLUMN verified_at DATETIME"))
        if "path_json" not in edge_names:
            conn.execute(text("ALTER TABLE edges ADD COLUMN path_json TEXT"))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
