from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    Index,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
    event,
)
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    pass


class Volunteer(Base):
    """A volunteer or admin account: phone number + PIN, created by an admin."""

    __tablename__ = "volunteers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    phone = Column(String(16), unique=True, nullable=False, index=True)
    name = Column(String(128), nullable=False)
    role = Column(String(16), nullable=False, default="volunteer")  # volunteer | operator | admin
    pin_hash = Column(String(256), nullable=False)
    active = Column(Boolean, nullable=False, default=True)
    failed_logins = Column(Integer, nullable=False, default=0)
    locked_until = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class AuthSession(Base):
    """A signed-in phone. Only the token's sha256 is stored."""

    __tablename__ = "auth_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    token_hash = Column(String(64), unique=True, nullable=False, index=True)
    volunteer_id = Column(Integer, ForeignKey("volunteers.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
    revoked = Column(Boolean, nullable=False, default=False)


def _default_source(ctx) -> str:
    code = (ctx.get_current_parameters().get("code") or "").upper()
    return "osm" if code.startswith("OSM-") else "volunteer"


class QrNode(Base):
    __tablename__ = "qr_nodes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(32), unique=True, nullable=False, index=True)
    name = Column(String(128), nullable=False)
    local_name = Column(String(128), nullable=True)
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    # Accuracy (m) of the GPS fix the place was saved from, when known.
    gps_accuracy_m = Column(Float, nullable=True)
    node_type = Column(String(32), nullable=False, default="junction")
    # ghat | parking | medical | lost_found | toilet | transport | junction | help | landmark
    icon = Column(String(32), nullable=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    # Volunteer who last saved it (null: import, seed or before logins).
    updated_by = Column(Integer, ForeignKey("volunteers.id"), nullable=True)
    # Trust level (app/verification.py); nothing is promoted automatically.
    verification = Column(String(24), nullable=False, default="unverified")
    # Who set the trust level, when, and why (admin review).
    verified_by = Column(Integer, ForeignKey("volunteers.id"), nullable=True)
    verification_note = Column(String(256), nullable=True)
    # When a person last checked it (on-site GPS or an admin review).
    verified_at = Column(DateTime, nullable=True)
    # Where it came from: osm | volunteer | admin.
    source = Column(String(16), nullable=True, default=_default_source)
    # Operational status. Live like lane closures: reaches phones at once,
    # and is no longer claimed after op_status_until (it never goes stale).
    op_status = Column(String(12), nullable=True)  # open | limited | closed; NULL = not known
    op_status_until = Column(DateTime, nullable=True)
    op_status_note = Column(String(120), nullable=True)
    op_status_at = Column(DateTime, nullable=True)
    op_status_by = Column(Integer, ForeignKey("volunteers.id"), nullable=True)
    # Access, published with the data.
    step_free = Column(Boolean, nullable=True)
    access = Column(String(16), nullable=True)  # public | restricted
    access_note = Column(String(120), nullable=True)
    # Short code printed on a Setu QR board here: stable, unique, never reused.
    board_code = Column(String(12), nullable=True)

    __table_args__ = (Index("ix_qr_nodes_board_code", "board_code", unique=True),)


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
    # The block ends by itself at this time (null: until a volunteer reopens it).
    blocked_until = Column(DateTime, nullable=True)
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
    # volunteer (walked) | osm (map road, nobody walked it yet)
    source = Column(String(16), nullable=False, default="volunteer")
    # Street name (OSM lanes), for "onto <street>" instructions.
    name = Column(String(128), nullable=True)
    # Volunteer who last changed it (null: import or before logins).
    updated_by = Column(Integer, ForeignKey("volunteers.id"), nullable=True)
    # Trust level (app/verification.py); nothing is promoted automatically.
    verification = Column(String(24), nullable=False, default="unverified")
    verified_by = Column(Integer, ForeignKey("volunteers.id"), nullable=True)
    verification_note = Column(String(256), nullable=True)


class BlockReport(Base):
    """
    A visitor's "path blocked". Only a suggestion: it changes nothing for
    other visitors until a volunteer confirms it (then the lane is blocked).
    """

    __tablename__ = "block_reports"

    id = Column(Integer, primary_key=True, autoincrement=True)
    edge_id = Column(Integer, ForeignKey("edges.id", ondelete="CASCADE"), nullable=False, index=True)
    # sha256(IP + secret + day): only a flood limit — many phones share one
    # mobile-network IP. No raw IPs are stored.
    reporter_hash = Column(String(64), nullable=False, index=True)
    # sha256(random per-phone id + secret): one phone = one reporter.
    device_hash = Column(String(64), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    expires_at = Column(DateTime, nullable=False)
    status = Column(String(16), nullable=False, default="pending")  # pending | confirmed | rejected | expired
    resolved_by = Column(Integer, ForeignKey("volunteers.id"), nullable=True)
    resolved_at = Column(DateTime, nullable=True)


class PackVersion(Base):
    __tablename__ = "pack_versions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    version = Column(String(32), unique=True, nullable=False)
    file_path = Column(String(512), nullable=False)
    signature = Column(String(128), nullable=False)
    node_count = Column(Integer, nullable=False, default=0)
    edge_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)


class SosAlert(Base):
    """
    A visitor's "I need help" (Phase 6). Public to send, operator-only to read.
    `client_id` is a random id made on the phone: sending it again returns the
    same alert (never a duplicate), and it is the phone's key to ask for the
    status. Deleted sos_retention_days after it is resolved.
    """

    __tablename__ = "sos_alerts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(String(64), unique=True, nullable=False, index=True)
    kind = Column(String(16), nullable=False)  # medical | lost | unsafe | other
    note = Column(String(280), nullable=True)
    lat = Column(Float, nullable=True)
    lon = Column(Float, nullable=True)
    accuracy_m = Column(Float, nullable=True)
    place_code = Column(String(32), nullable=True)
    lang = Column(String(4), nullable=True)
    device_hash = Column(String(64), nullable=True, index=True)
    ip_hash = Column(String(64), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    # received | acknowledged | resolved | expired (open 48 h with nobody resolving it)
    status = Column(String(16), nullable=False, default="received")
    # Many alerts from the same network address within an hour: accepted (never
    # refused — thousands of phones share a carrier address) but marked for operators.
    flood_suspect = Column(Boolean, nullable=False, default=False)
    ack_at = Column(DateTime, nullable=True)
    ack_by = Column(Integer, ForeignKey("volunteers.id"), nullable=True)
    ack_message = Column(String(200), nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    resolved_by = Column(Integer, ForeignKey("volunteers.id"), nullable=True)


class LostCase(Base):
    """
    A lost-person case (Phase 6), operators and admins only. Minimal personal
    data; contact details masked in lists; deleted case_retention_days after
    it is closed. `version` stops two operators overwriting each other.
    """

    __tablename__ = "lost_cases"

    id = Column(Integer, primary_key=True, autoincrement=True)
    case_ref = Column(String(12), unique=True, nullable=False, index=True)
    status = Column(String(16), nullable=False, default="NEW")
    person_name = Column(String(80), nullable=True)
    approx_age = Column(Integer, nullable=True)
    is_child = Column(Boolean, nullable=False, default=False)
    gender = Column(String(12), nullable=True)
    description = Column(String(500), nullable=False)
    languages = Column(String(60), nullable=True)
    last_seen_place_code = Column(String(32), nullable=True)
    last_seen_note = Column(String(200), nullable=True)
    last_seen_at = Column(DateTime, nullable=True)
    reporter_name = Column(String(80), nullable=True)
    reporter_contact = Column(String(20), nullable=True)
    outcome_note = Column(String(200), nullable=True)
    sos_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_by = Column(Integer, ForeignKey("volunteers.id"), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_by = Column(Integer, ForeignKey("volunteers.id"), nullable=True)
    closed_at = Column(DateTime, nullable=True, index=True)
    version = Column(Integer, nullable=False, default=1)


class LostCaseEvent(Base):
    """A case's history (who, when, what changed) — deleted with the case."""

    __tablename__ = "lost_case_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    case_id = Column(Integer, ForeignKey("lost_cases.id", ondelete="CASCADE"), nullable=False, index=True)
    at = Column(DateTime, default=datetime.utcnow, nullable=False)
    actor_name = Column(String(128), nullable=True)
    action = Column(String(24), nullable=False)
    from_status = Column(String(16), nullable=True)
    to_status = Column(String(16), nullable=True)
    note = Column(String(200), nullable=True)


class DatasetRelease(Base):
    """
    A published version of the map data (PUBLISH_MODE=manual). Phones get the
    active release with today's closures, reopenings and rejections applied on
    top (pack_builder._collect). The snapshot is kept in the database so it is
    in the backups.
    """

    __tablename__ = "dataset_releases"

    id = Column(Integer, primary_key=True, autoincrement=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    published_by = Column(Integer, nullable=True)
    published_by_name = Column(String(128), nullable=True)
    note = Column(String(256), nullable=True)
    content_json = Column(Text, nullable=False)
    node_count = Column(Integer, nullable=False, default=0)
    edge_count = Column(Integer, nullable=False, default=0)
    active = Column(Boolean, nullable=False, default=False, index=True)


class AuditLog(Base):
    """
    Who changed the data, and what (admin map "Recent changes"). Written in
    the same transaction as the change, so a change is never without its entry.
    Admin-only; it holds the volunteer's name, never their phone number.
    """

    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    volunteer_id = Column(Integer, nullable=True)  # NULL: a script (OSM import)
    actor_name = Column(String(128), nullable=True)
    action = Column(String(48), nullable=False)
    target = Column(String(96), nullable=False, index=True)
    summary = Column(String(400), nullable=False)


class ClientAction(Base):
    """
    A volunteer write sent with an Idempotency-Key (the phone's offline queue).
    The same key again gets the stored answer instead of doing the work twice.
    status_code is NULL while the first request is still being processed.
    """

    __tablename__ = "client_actions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    key = Column(String(64), unique=True, nullable=False, index=True)
    volunteer_id = Column(Integer, nullable=False)
    path = Column(String(128), nullable=False)
    status_code = Column(Integer, nullable=True)
    response_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


def _make_engine():
    if settings.use_sqlite:
        url = f"sqlite:///{settings.sqlite_path}"
        eng = create_engine(url, connect_args={"check_same_thread": False})

        # SQLite ignores FOREIGN KEY constraints unless asked per connection.
        @event.listens_for(eng, "connect")
        def _sqlite_fk_on(dbapi_conn, _record):
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()

        return eng
    return create_engine(settings.database_url, pool_pre_ping=True)


engine = _make_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db():
    Base.metadata.create_all(bind=engine)
    _ensure_columns()


# Columns added after a table was first created: create_all() makes new
# tables but never alters existing ones (SQLite or Postgres).
_ADDED_COLUMNS = {
    "block_reports": {"device_hash": "VARCHAR(64)"},
    "sos_alerts": {"flood_suspect": "BOOLEAN DEFAULT FALSE"},
    "qr_nodes": {
        "local_name": "VARCHAR(128)",
        "gps_accuracy_m": "FLOAT",
        "updated_by": "INTEGER REFERENCES volunteers(id)",
        "verification": "VARCHAR(24)",
        "verified_by": "INTEGER REFERENCES volunteers(id)",
        "verification_note": "VARCHAR(256)",
        "verified_at": "TIMESTAMP",
        "source": "VARCHAR(16)",
        "op_status": "VARCHAR(12)",
        "op_status_until": "TIMESTAMP",
        "op_status_note": "VARCHAR(120)",
        "op_status_at": "TIMESTAMP",
        "op_status_by": "INTEGER REFERENCES volunteers(id)",
        "step_free": "BOOLEAN",
        "access": "VARCHAR(16)",
        "access_note": "VARCHAR(120)",
        "board_code": "VARCHAR(12)",
    },
    "edges": {
        "heading_ab": "FLOAT",
        "heading_ba": "FLOAT",
        "passage_kind": "VARCHAR(32) DEFAULT 'corridor'",
        "door_state": "VARCHAR(16) DEFAULT 'none'",
        "blocked": "BOOLEAN DEFAULT FALSE",
        "blocked_until": "TIMESTAMP",
        "obstacle_note": "VARCHAR(64)",
        "clearance_m": "FLOAT",
        "cost_mult": "FLOAT DEFAULT 1.0",
        "verified": "BOOLEAN DEFAULT FALSE",
        "verified_at": "TIMESTAMP",
        "path_json": "TEXT",
        "source": "VARCHAR(16) DEFAULT 'volunteer'",
        "name": "VARCHAR(128)",
        "updated_by": "INTEGER REFERENCES volunteers(id)",
        "verification": "VARCHAR(24)",
        "verified_by": "INTEGER REFERENCES volunteers(id)",
        "verification_note": "VARCHAR(256)",
    },
}


def _ensure_columns():
    """Add missing columns on existing databases (small stand-in for migrations)."""
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    with engine.begin() as conn:
        for table, columns in _ADDED_COLUMNS.items():
            if not insp.has_table(table):
                continue
            have = {c["name"] for c in insp.get_columns(table)}
            for name, ddl in columns.items():
                if name not in have:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
        if insp.has_table("qr_nodes"):
            # A board code must point at exactly one place (NULLs allowed).
            conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_qr_nodes_board_code ON qr_nodes (board_code)"
            ))
        _backfill_verification(conn)


def _backfill_verification(conn):
    """
    Trust level for rows from before it existed — from what is known about
    them, never more: OSM rows are `osm_imported`; a place a volunteer saved
    from GPS, or a lane a volunteer walked, is `volunteer_verified`; the rest
    `unverified`.
    """
    from sqlalchemy import text

    conn.execute(text(
        "UPDATE qr_nodes SET verification = CASE "
        "WHEN gps_accuracy_m IS NOT NULL THEN 'volunteer_verified' "
        "WHEN code LIKE 'OSM-%' THEN 'osm_imported' "
        "ELSE 'unverified' END WHERE verification IS NULL"
    ))
    from sqlalchemy import inspect

    place_cols = {c["name"] for c in inspect(conn).get_columns("qr_nodes")}
    if "source" in place_cols:
        conn.execute(text(
            "UPDATE qr_nodes SET source = CASE WHEN code LIKE 'OSM-%' THEN 'osm' ELSE 'volunteer' END "
            "WHERE source IS NULL"
        ))
    if {"verified_at", "updated_at"} <= place_cols:
        # A person's check from before the date was kept: the last save is the best known date.
        conn.execute(text(
            "UPDATE qr_nodes SET verified_at = updated_at WHERE verified_at IS NULL "
            "AND verification IN ('volunteer_verified', 'officially_verified', 'remotely_reviewed')"
        ))
    conn.execute(text(
        "UPDATE edges SET verification = CASE "
        "WHEN source = 'osm' THEN 'osm_imported' "
        "WHEN verified = TRUE THEN 'volunteer_verified' "
        "ELSE 'unverified' END WHERE verification IS NULL"
    ))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
