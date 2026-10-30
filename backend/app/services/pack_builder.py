import hashlib
import json
import logging
import os
import time
from datetime import datetime, timedelta
from typing import List, Tuple
from uuid import uuid4

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import publishing_manual, settings
from ..db import BlockReport, DatasetRelease, Edge, PackVersion, QrNode, Volunteer
from ..verification import REJECTED
from ..schemas import EdgeOut, QrNodeOut


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    from math import asin, cos, radians, sin, sqrt

    r = 6371000.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = (
        sin(dlat / 2) ** 2
        + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    )
    return 2 * r * asin(sqrt(a))


logger = logging.getLogger("setu.pack")
REPORT_KEEP_DAYS = 30
KEEP_RELEASES = 20
_warned = {"no_water": False}


# Lane fields that take effect at once even when publishing is manual: closing
# or reopening a lane must never wait for an admin to publish.
CLOSURE_FIELDS = ("walkable", "blocked", "door_state")
# Place fields that are live in the same way: a facility closing must not wait,
# and neither must retiring a board on the wrong place (phones would keep
# telling visitors the wrong location until the next publish).
PLACE_LIVE_FIELDS = ("op_status", "op_status_until", "op_status_note", "op_status_at", "board_code")


def _public_path(raw: str | None) -> str | None:
    """A walked track as visitors get it: positions only. The volunteer's
    timestamps (when they were where) and compass readings stay on the server."""
    if not raw:
        return raw
    try:
        points = json.loads(raw)
    except ValueError:
        return None
    if all(isinstance(p, dict) and set(p) <= {"lat", "lon"} for p in points):
        return raw  # already positions only (OSM lanes): keep the same text
    return json.dumps(
        [{"lat": p["lat"], "lon": p["lon"]} for p in points if isinstance(p, dict) and "lat" in p and "lon" in p],
        separators=(",", ":"),
    )


def _public_node(d: dict) -> dict:
    for k in ("created_at", "updated_at"):
        d.pop(k, None)
    # The day a person checked it, not the time (that would show when a volunteer was there).
    if d.get("verified_at"):
        d["verified_at"] = d["verified_at"][:10]
    return d


def _public_edge(d: dict) -> dict:
    d["path_json"] = _public_path(d.get("path_json"))
    # Free text written by volunteers, and when they checked: not for the public.
    d["obstacle_note"] = None
    d["verified_at"] = None
    return d


def draft_data(db: Session) -> Tuple[List[dict], List[dict]]:
    """Every place and lane as it is in the database now (rejected ones left out)."""
    # Rejected data is kept for the record but never listed or routed on.
    nodes = [n for n in db.query(QrNode).order_by(QrNode.id).all() if n.verification != REJECTED]
    edges = [e for e in db.query(Edge).order_by(Edge.id).all() if e.verification != REJECTED]
    return (
        [_public_node(QrNodeOut.model_validate(n).model_dump(mode="json")) for n in nodes],
        [_public_edge(EdgeOut.model_validate(e).model_dump(mode="json")) for e in edges],
    )


def _on_release(db: Session, release: DatasetRelease) -> Tuple[List[dict], List[dict]]:
    """The published data, with today's closures, reopenings and rejections applied."""
    content = json.loads(release.content_json)
    rejected = {c for (c,) in db.query(QrNode.code).filter(QrNode.verification == REJECTED)}
    live = {
        row[0]: {f: (v.isoformat() if isinstance(v, datetime) else v) for f, v in zip(PLACE_LIVE_FIELDS, row[1:])}
        for row in db.query(QrNode.code, *(getattr(QrNode, f) for f in PLACE_LIVE_FIELDS))
    }
    all_rows = db.query(Edge).all()
    rows = {e.id: e for e in all_rows}
    # A lane deleted and created again (a street re-import) has a new id:
    # find it by its two ends, so its closure still reaches phones.
    by_ends = {frozenset((e.from_code, e.to_code)): e for e in all_rows}
    nodes = [{**n, **live.get(n["code"], {})} for n in content["nodes"] if n["code"] not in rejected]
    edges = []
    for e in content["edges"]:
        ends = frozenset((e["from_code"], e["to_code"]))
        row = rows.get(e["id"])
        # SQLite may reuse a deleted lane's id for another lane: trust the id only if the ends match.
        if row is None or frozenset((row.from_code, row.to_code)) != ends:
            row = by_ends.get(ends)
        if row is not None:
            if row.verification == REJECTED:
                continue
            e = {**e, **{f: getattr(row, f) for f in CLOSURE_FIELDS}}
        edges.append(e)
    return nodes, edges


def live_release(db: Session) -> DatasetRelease | None:
    """The published version phones get (None: PUBLISH_MODE=auto, everything live)."""
    if not publishing_manual(settings):
        return None
    row = (
        db.query(DatasetRelease)
        .filter(DatasetRelease.active.is_(True))
        .order_by(DatasetRelease.id.desc())
        .first()
    )
    if row is None:
        # Publishing was just switched on: today's data is the first version,
        # so phones never get an empty map.
        row = publish(db, None, "First version (made when publishing was switched on)")
    return row


def publish(db: Session, admin: Volunteer | None, note: str | None, by_name: str = "automatic") -> DatasetRelease:
    """Make the current data (draft) the version phones get."""
    from ..audit import audit

    nodes, edges = draft_data(db)
    db.query(DatasetRelease).filter(DatasetRelease.active.is_(True)).update(
        {DatasetRelease.active: False}, synchronize_session=False
    )
    row = DatasetRelease(
        published_by=admin.id if admin else None,
        published_by_name=admin.name if admin else by_name,
        note=(note or "").strip()[:256] or None,
        content_json=json.dumps({"nodes": nodes, "edges": edges}, separators=(",", ":")),
        node_count=len(nodes),
        edge_count=len(edges),
        active=True,
    )
    db.add(row)
    db.flush()
    # Each version is a full copy (about 2 MB): keep the newest KEEP_RELEASES.
    keep = [r for (r,) in db.query(DatasetRelease.id).order_by(DatasetRelease.id.desc()).limit(KEEP_RELEASES)]
    db.query(DatasetRelease).filter(
        DatasetRelease.id.notin_(keep), DatasetRelease.active.is_(False)
    ).delete(synchronize_session=False)
    audit(db, admin, "data.publish", f"release:{row.id}",
          f"Published version {row.id} ({len(nodes)} points, {len(edges)} lanes)"
          + (f" — {row.note}" if row.note else ""))
    db.commit()
    db.refresh(row)
    return row


def roll_back(db: Session, admin: Volunteer, release_id: int) -> DatasetRelease | None:
    """Phones go back to an earlier published version (the database is not changed)."""
    from ..audit import audit

    row = db.get(DatasetRelease, release_id)
    if row is None:
        return None
    db.query(DatasetRelease).filter(DatasetRelease.active.is_(True)).update(
        {DatasetRelease.active: False}, synchronize_session=False
    )
    row.active = True
    audit(db, admin, "data.rollback", f"release:{row.id}", f"Phones rolled back to version {row.id}")
    db.commit()
    return row


def _collect(db: Session) -> Tuple[List[dict], List[dict]]:
    """Places and navigable lanes as they go into the pack, in a stable order."""
    release = live_release(db)
    node_dicts, edge_dicts = _on_release(db, release) if release else draft_data(db)
    # Navigable only: walkable, not blocked, door not closed.
    edge_dicts = [
        e for e in edge_dicts if e["walkable"] and not e["blocked"] and e["door_state"] != "closed"
    ]
    # Never ship a lane whose end place is missing — clients route on it.
    codes = {n["code"] for n in node_dicts}
    edge_dicts = [e for e in edge_dicts if e["from_code"] in codes and e["to_code"] in codes]
    # Never ship a lane drawn through the river unless it is a bridge or a real walk.
    from .river_guard import crossing_problem, load_water_index

    water = load_water_index()
    if water is not None:
        by_code = {n["code"]: n for n in node_dicts}
        edge_dicts = [e for e in edge_dicts if crossing_problem(e, by_code, water) != "error"]
    elif edge_dicts and not _warned["no_water"]:
        _warned["no_water"] = True
        logger.warning(
            "No water data (OSM_DIR / backend/data/osm): lanes are NOT checked for "
            "crossing the river. Run scripts/import_osm.py water."
        )
    return node_dicts, edge_dicts


def content_signature(nodes: List[dict], edges: List[dict]) -> str:
    """Hash of the routing data only — the same data always gives the same signature."""
    raw = json.dumps(
        {"nodes": nodes, "edges": edges}, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


# Phones ask for the pack version often (every app open). Checking it means
# reading and hashing every lane, so a read reuses the answer for this long;
# writes call ensure_current_pack() directly and refresh it at once.
PACK_CHECK_TTL_S = 30.0
_checked: dict = {"id": None, "at": 0.0}


def current_pack(db: Session) -> PackVersion:
    """ensure_current_pack(), at most once per PACK_CHECK_TTL_S per process."""
    # A timed block ending is a change the cache must not hide (cheap indexed query).
    reopened = expire_blocks(db)
    if not reopened and _checked["id"] is not None and time.monotonic() - _checked["at"] < PACK_CHECK_TTL_S:
        row = db.get(PackVersion, _checked["id"])
        if row is not None and os.path.exists(row.file_path):
            return row
    return ensure_current_pack(db)


def _remember(row: PackVersion) -> PackVersion:
    _checked["id"], _checked["at"] = row.id, time.monotonic()
    return row


def _latest(db: Session) -> PackVersion | None:
    return db.query(PackVersion).order_by(PackVersion.id.desc()).first()


def osm_snapshots() -> dict:
    """Newest saved OpenStreetMap answer per kind (places / network / water) — the dataset's sources."""
    from .river_guard import water_dir

    out = {}
    d = water_dir()
    if os.path.isdir(d):
        for kind in ("places", "network", "water"):
            names = sorted(n for n in os.listdir(d) if n.startswith(f"{kind}-") and n.endswith(".json"))
            if names:
                out[f"osm_{kind}"] = names[-1]
    return out


def expire_blocks(db: Session) -> bool:
    """Reopen lanes whose timed block has ended; close stale visitor reports. True if any lane reopened."""
    now = datetime.utcnow()
    changed = reopened = False
    for e in (
        db.query(Edge)
        .filter(Edge.blocked.is_(True), Edge.blocked_until.isnot(None), Edge.blocked_until <= now)
        .all()
    ):
        e.blocked = False
        e.blocked_until = None
        e.obstacle_note = None
        changed = reopened = True
    for r in (
        db.query(BlockReport)
        .filter(BlockReport.status == "pending", BlockReport.expires_at <= now)
        .all()
    ):
        r.status = "expired"
        changed = True
    # Visitor reports hold hashed phone/network ids (for rate limits): delete
    # them a month after they were settled.
    old = (
        db.query(BlockReport)
        .filter(BlockReport.status != "pending", BlockReport.created_at < now - timedelta(days=REPORT_KEEP_DAYS))
        .delete(synchronize_session=False)
    )
    if changed or old:
        db.commit()
    # SOS alerts and closed lost-person cases past their retention time.
    from .retention import purge_expired

    purge_expired(db)
    return reopened


def ensure_current_pack(db: Session) -> PackVersion:
    """
    The pack for the current data. A new version (file + row) is written only
    when places or lanes changed since the latest one, so phones re-download
    only real changes. Comparing content (not a "dirty" flag) means no write
    path can be forgotten.
    """
    # A timed block ending is a data change: the first request after it gets a new pack.
    expire_blocks(db)
    nodes, edges = _collect(db)
    signature = content_signature(nodes, edges)
    row = _latest(db)
    if row and row.signature == signature and os.path.exists(row.file_path):
        return _remember(row)

    now = datetime.utcnow()
    version = now.strftime("v%Y%m%d%H%M%S%f")
    if db.query(PackVersion).filter(PackVersion.version == version).first():
        version = f"{version}_{os.getpid()}"
    payload = {
        "version": version,
        "generated_at": now.isoformat() + "Z",
        "signature": signature,
        # Where the data came from (the dataset version) — ODbL needs the credit.
        "sources": osm_snapshots(),
        "attribution": "Map data © OpenStreetMap contributors (ODbL); places and walks by Setu volunteers",
        "nodes": nodes,
        "edges": edges,
    }

    os.makedirs(settings.pack_dir, exist_ok=True)
    path = os.path.join(settings.pack_dir, f"setu_pack_{version}.json")
    # Write then rename, so a reader never gets a half-written file.
    tmp = f"{path}.{uuid4().hex[:8]}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, separators=(",", ":"))
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)

    row = PackVersion(
        version=version,
        file_path=path,
        signature=signature,
        node_count=len(nodes),
        edge_count=len(edges),
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        # Another request built the same moment — use its version.
        db.rollback()
        latest = _latest(db)
        if latest is None:
            raise
        # Same version name means the same file path: keep the winner's file.
        if latest.file_path != path and os.path.exists(path):
            os.remove(path)
        return _remember(latest)
    db.refresh(row)
    return _remember(row)
