"""Volunteer location registration — separate from visitor wayfinding."""

import json
from datetime import datetime, timedelta
from math import atan2, cos, degrees, radians, sin

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..audit import audit
from ..auth import require_volunteer
from ..config import publishing_manual, settings
from ..db import BlockReport, Edge, QrNode, Volunteer, get_db
from ..schemas import (
    QrNodeOut,
    VolunteerEdgeStatusRequest,
    VolunteerPathHeadingRequest,
    VolunteerRecordPathRequest,
    VolunteerRegisterRequest,
    VolunteerRegisterResponse,
)
from ..services.osm_import import confirmable_osm_place
from ..verification import OFFICIALLY_VERIFIED, REJECTED, REVIEWED, UNVERIFIED, VOLUNTEER_VERIFIED

SIMULATED_NOTE = "Simulated position (development test) — not on site"


def _refuse_simulated_in_production(simulated: bool) -> None:
    """Simulated GPS must never become real data (docs/NASHIK_SIMULATION_MODE.md)."""
    if simulated and settings.setu_env == "production":
        raise HTTPException(403, "Simulated positions are never saved on the live server")
from ..services.pack_builder import ensure_current_pack, haversine_m

router = APIRouter(prefix="/api/volunteer", tags=["volunteer"])

# Recorded walks at least this long take their heading from the GPS track.
MIN_TRACK_FOR_BEARING_M = 10.0
# A place is not saved from a GPS fix rougher than this.
MAX_REGISTER_ACCURACY_M = 50.0


def _norm_heading(deg: float) -> float:
    return ((deg % 360) + 360) % 360


def _bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = radians(lat1), radians(lat2)
    dlon = radians(lon2 - lon1)
    y = sin(dlon) * cos(phi2)
    x = cos(phi1) * sin(phi2) - sin(phi1) * cos(phi2) * cos(dlon)
    return _norm_heading(degrees(atan2(y, x)))


def _path_length_m(points: list[tuple[float, float]]) -> float:
    total = 0.0
    for i in range(1, len(points)):
        total += haversine_m(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1])
    return total


def _heading_from_path(
    points: list[tuple[float, float]],
    headings: list[float | None],
    *,
    from_start: bool,
) -> float:
    """
    Compass leaving the start (from_start=True) or leaving the end toward start
    (from_start=False) along the recorded walk.

    The GPS track is the walk itself, so it wins once it is long enough to
    trust. Compass samples only say where the phone pointed (and read 0 until
    the sensor is live), so they are a fallback for very short walks.
    """
    track_ok = len(points) >= 2 and _path_length_m(points) >= MIN_TRACK_FOR_BEARING_M
    if track_ok:
        if from_start:
            for i in range(1, len(points)):
                if (
                    haversine_m(points[0][0], points[0][1], points[i][0], points[i][1])
                    >= MIN_TRACK_FOR_BEARING_M
                ):
                    return _bearing_deg(points[0][0], points[0][1], points[i][0], points[i][1])
        else:
            for i in range(len(points) - 2, -1, -1):
                if (
                    haversine_m(points[-1][0], points[-1][1], points[i][0], points[i][1])
                    >= MIN_TRACK_FOR_BEARING_M
                ):
                    return _bearing_deg(points[-1][0], points[-1][1], points[i][0], points[i][1])

    if from_start:
        for h in headings:
            if h is not None:
                return _norm_heading(h)
        for i in range(1, len(points)):
            if haversine_m(points[0][0], points[0][1], points[i][0], points[i][1]) >= 3:
                return _bearing_deg(points[0][0], points[0][1], points[i][0], points[i][1])
        if len(points) >= 2:
            return _bearing_deg(
                points[0][0], points[0][1], points[-1][0], points[-1][1]
            )
        return 0.0

    # Leaving destination back toward start: reverse of last forward heading,
    # or GPS bearing from last point toward an earlier point.
    for h in reversed(headings):
        if h is not None:
            return _norm_heading(h + 180)
    n = len(points)
    for i in range(n - 2, -1, -1):
        if haversine_m(points[-1][0], points[-1][1], points[i][0], points[i][1]) >= 3:
            return _bearing_deg(
                points[-1][0], points[-1][1], points[i][0], points[i][1]
            )
    if n >= 2:
        return _bearing_deg(
            points[-1][0], points[-1][1], points[0][0], points[0][1]
        )
    return 0.0


def _next_location_code(db: Session) -> str:
    existing = {n.code.upper() for n in db.query(QrNode.code).all()}
    for i in range(1, 10000):
        code = f"KUMBH-A{i:02d}" if i < 100 else f"KUMBH-A{i}"
        if code not in existing:
            return code
    raise HTTPException(500, "Could not allocate a unique location code")


def _apply_path_headings(edge: Edge, from_code: str, to_code: str, facing_to_from: float) -> None:
    """
    Volunteer stands at `to_code`, points phone toward `from_code` along the
    real walk. That heading is leaving to→from (heading on that direction).
    """
    facing = _norm_heading(facing_to_from)
    reverse = _norm_heading(facing + 180)

    # Edge row may be stored either orientation.
    if edge.from_code.upper() == from_code.upper() and edge.to_code.upper() == to_code.upper():
        # from→to is reverse of facing (facing is to→from)
        edge.heading_ab = reverse
        edge.heading_ba = facing
    elif edge.from_code.upper() == to_code.upper() and edge.to_code.upper() == from_code.upper():
        edge.heading_ab = facing
        edge.heading_ba = reverse
    else:
        raise HTTPException(400, "Edge does not match the given boards")


def _link_volunteer_board(
    db: Session,
    node: QrNode,
    target: QrNode,
    path_heading_deg: float | None,
    updated_by: int | None = None,
) -> None:
    """Add the lane target → node in the caller's transaction (no commit)."""
    edge = (
        db.query(Edge)
        .filter(
            ((Edge.from_code == node.code) & (Edge.to_code == target.code))
            | ((Edge.from_code == target.code) & (Edge.to_code == node.code))
        )
        .first()
    )

    dist = round(haversine_m(node.lat, node.lon, target.lat, target.lon), 1)
    if dist < 1:
        dist = 1.0

    if edge is None:
        # Store as previous(from) → new(to) for readability.
        edge = Edge(
            from_code=target.code,
            to_code=node.code,
            distance_m=dist,
            surface="paved",
            walkable=True,
            bidirectional=True,
        )
        db.add(edge)
        db.flush()
    else:
        edge.distance_m = dist
    edge.updated_by = updated_by

    if path_heading_deg is not None:
        # Standing at new node, facing previous along walk.
        _apply_path_headings(edge, target.code, node.code, path_heading_deg)


@router.post("/register", response_model=VolunteerRegisterResponse)
def register_location(
    body: VolunteerRegisterRequest,
    db: Session = Depends(get_db),
    vol: Volunteer = Depends(require_volunteer),
):
    if body.gps_accuracy_m is not None and body.gps_accuracy_m > MAX_REGISTER_ACCURACY_M:
        raise HTTPException(
            400,
            f"GPS is only accurate to ±{round(body.gps_accuracy_m)} m — "
            f"need ±{int(MAX_REGISTER_ACCURACY_M)} m or better. Step into open sky and retry.",
        )
    _refuse_simulated_in_production(body.simulated)
    node_type = body.node_type or "landmark"
    # The volunteer said "This is <map place>": confirm that OpenStreetMap
    # place (same code, so links to it stay) instead of adding a twin. Only on
    # an explicit choice — nearby places are often different places.
    takeover = None
    if body.confirm_code:
        if body.gps_accuracy_m is None:
            raise HTTPException(400, "Confirming a map place needs your live GPS accuracy")
        takeover, why = confirmable_osm_place(
            db, body.confirm_code, lat=body.lat, lon=body.lon, node_type=node_type
        )
        if takeover is None:
            raise HTTPException(400, why)
    if not takeover and body.code and body.code.strip().upper().startswith("OSM-"):
        # OSM-… codes belong to the map import (OSM-J… would even hide the
        # place from admins as a "map junction"). Map places are confirmed
        # with confirm_code instead.
        raise HTTPException(400, "Codes starting with OSM- are reserved for map places")
    code = (takeover.code if takeover else (body.code or _next_location_code(db))).strip().upper()

    # Resolve the lane's other end before saving anything, so a bad code
    # cannot leave an orphan place behind. No connection → no lane: a lane
    # is only created from a place the volunteer actually walked from.
    target = None
    if body.connect_to_code and body.connect_to_code.strip():
        target_code = body.connect_to_code.strip().upper()
        target = db.query(QrNode).filter(QrNode.code == target_code).first()
        if target is None:
            raise HTTPException(
                400, f"Unknown place to connect to: {body.connect_to_code}"
            )
        if target_code == code:
            raise HTTPException(400, "A place cannot connect to itself")

    if takeover is not None:
        takeover.name = body.location_name
        takeover.local_name = body.local_name or takeover.local_name
        takeover.lat = body.lat
        takeover.lon = body.lon
        takeover.gps_accuracy_m = body.gps_accuracy_m
        takeover.description = body.local_name
        takeover.updated_by = vol.id
        if body.simulated:
            if takeover.verification not in REVIEWED:
                takeover.verification_note = SIMULATED_NOTE  # not promoted: nobody was there
        elif takeover.verification != OFFICIALLY_VERIFIED:
            takeover.verification = VOLUNTEER_VERIFIED  # stood there with GPS (accuracy required)
            takeover.verified_at = datetime.utcnow()
        db.flush()
        if target is not None:
            _link_volunteer_board(db, takeover, target, body.path_heading_deg, vol.id)
        audit(db, vol, "place.confirm", f"place:{takeover.code}",
              f"Confirmed map place {takeover.name} at its GPS position (±{round(body.gps_accuracy_m or 0)} m)"
              + (" — simulated" if body.simulated else ""))
        db.commit()
        db.refresh(takeover)
        try:
            ensure_current_pack(db)
        except Exception as exc:  # noqa: BLE001
            print(f"Pack rebuild note: {exc}")
        return VolunteerRegisterResponse(
            success=True,
            message="Confirmed the map place at this spot",
            node=QrNodeOut.model_validate(takeover),
            live=not publishing_manual(settings),
        )

    existing = db.query(QrNode).filter(QrNode.code == code).first()
    if existing:
        return VolunteerRegisterResponse(
            success=False,
            message="Place is already registered",
            existing_name=existing.name,
            node=QrNodeOut.model_validate(existing),
        )

    node = QrNode(
        code=code,
        name=body.location_name,
        local_name=body.local_name,
        lat=body.lat,
        lon=body.lon,
        gps_accuracy_m=body.gps_accuracy_m,
        node_type=node_type,
        icon="landmark",
        description=body.local_name,
        updated_by=vol.id,
        # Saved from the volunteer's on-site GPS — or, from an old app or the
        # simulation, without proof.
        verification=VOLUNTEER_VERIFIED if body.gps_accuracy_m is not None and not body.simulated else UNVERIFIED,
        verification_note=SIMULATED_NOTE if body.simulated else None,
        verified_at=datetime.utcnow() if body.gps_accuracy_m is not None and not body.simulated else None,
    )
    db.add(node)
    try:
        db.flush()
        if target is not None:
            _link_volunteer_board(db, node, target, body.path_heading_deg, vol.id)
        audit(db, vol, "place.register", f"place:{node.code}",
              f"Registered {node.name}" + (f" (±{round(body.gps_accuracy_m)} m)" if body.gps_accuracy_m is not None else "")
              + (" — simulated" if body.simulated else ""))
        db.commit()
    except IntegrityError:
        db.rollback()
        again = db.query(QrNode).filter(QrNode.code == code).first()
        return VolunteerRegisterResponse(
            success=False,
            message="Place is already registered",
            existing_name=again.name if again else None,
            node=QrNodeOut.model_validate(again) if again else None,
        )

    db.refresh(node)
    try:
        ensure_current_pack(db)
    except Exception as exc:  # noqa: BLE001
        print(f"Pack rebuild note: {exc}")

    return VolunteerRegisterResponse(
        success=True,
        message="Location registered successfully",
        node=QrNodeOut.model_validate(node),
        live=not publishing_manual(settings),
    )


@router.post("/path-heading")
def set_path_heading(
    body: VolunteerPathHeadingRequest,
    db: Session = Depends(get_db),
    vol: Volunteer = Depends(require_volunteer),
):
    """Update walk direction on an existing board link (around obstacles)."""
    a = body.from_code.strip().upper()
    b = body.to_code.strip().upper()
    edge = (
        db.query(Edge)
        .filter(
            ((Edge.from_code == a) & (Edge.to_code == b))
            | ((Edge.from_code == b) & (Edge.to_code == a))
        )
        .first()
    )
    if not edge:
        raise HTTPException(404, "No walkable link between those boards")

    # Body: standing at to_code, facing from_code along walk.
    _apply_path_headings(edge, a, b, body.path_heading_deg)
    edge.updated_by = vol.id
    audit(db, vol, "lane.heading", f"lane:{edge.id}",
          f"Walk direction {b} → {a} set to {round(body.path_heading_deg)}°")
    db.commit()
    try:
        ensure_current_pack(db)
    except Exception as exc:  # noqa: BLE001
        print(f"Pack rebuild note: {exc}")

    return {
        "success": True,
        "from_code": edge.from_code,
        "to_code": edge.to_code,
        "heading_ab": edge.heading_ab,
        "heading_ba": edge.heading_ba,
    }


@router.post("/edge-status")
def set_edge_status(
    body: VolunteerEdgeStatusRequest,
    db: Session = Depends(get_db),
    vol: Volunteer = Depends(require_volunteer),
):
    """Mark a corridor blocked, closed door, glass barrier, etc. Pack rebuilds offline."""
    a = body.from_code.strip().upper()
    b = body.to_code.strip().upper()
    edge = (
        db.query(Edge)
        .filter(
            ((Edge.from_code == a) & (Edge.to_code == b))
            | ((Edge.from_code == b) & (Edge.to_code == a))
        )
        .first()
    )
    if not edge:
        raise HTTPException(404, "No link between those boards")

    if body.blocked is not None:
        edge.blocked = body.blocked
        edge.blocked_until = (
            datetime.utcnow() + timedelta(hours=body.hours) if body.blocked and body.hours else None
        )
        if body.blocked:
            # Someone on the spot decided: visitor reports on this lane are settled.
            for r in db.query(BlockReport).filter(
                BlockReport.edge_id == edge.id, BlockReport.status == "pending"
            ):
                r.status, r.resolved_by, r.resolved_at = "confirmed", vol.id, datetime.utcnow()
    if body.door_state is not None:
        edge.door_state = body.door_state
    if body.passage_kind is not None and not (edge.source == "osm" and edge.passage_kind in ("bridge", "connector")):
        # A map bridge or place link keeps its kind (the obstacle screen always
        # sends one): closing it is `blocked`, so reopening brings the bridge back.
        edge.passage_kind = body.passage_kind.strip().lower()
    if body.obstacle_note is not None:
        edge.obstacle_note = body.obstacle_note.strip() or None
    if body.clearance_m is not None:
        edge.clearance_m = body.clearance_m
        # Low clearance → higher cost (safety buffer preference).
        if body.clearance_m < 0.8:
            edge.cost_mult = max(edge.cost_mult or 1.0, 1.8)
        elif body.clearance_m < 1.2:
            edge.cost_mult = max(edge.cost_mult or 1.0, 1.3)
    if body.walkable is not None:
        edge.walkable = body.walkable
    edge.updated_by = vol.id
    what = []
    if body.blocked is not None:
        what.append(("blocked " + (f"for {body.hours} h" if body.hours else "until reopened")) if body.blocked else "reopened")
    if body.door_state is not None:
        what.append(f"gate {body.door_state}")
    if body.walkable is not None and body.blocked is None:
        what.append("walkable" if body.walkable else "not walkable")
    if body.obstacle_note:
        what.append(f"note: {body.obstacle_note.strip()}")
    audit(db, vol, "lane.status", f"lane:{edge.id}",
          f"{edge.from_code} ↔ {edge.to_code}: {', '.join(what) or 'updated'}")

    db.commit()
    try:
        ensure_current_pack(db)
    except Exception as exc:  # noqa: BLE001
        print(f"Pack rebuild note: {exc}")

    return {
        "success": True,
        "from_code": edge.from_code,
        "to_code": edge.to_code,
        "walkable": edge.walkable,
        "blocked": edge.blocked,
        "blocked_until": edge.blocked_until,
        "door_state": edge.door_state,
        "passage_kind": edge.passage_kind,
        "obstacle_note": edge.obstacle_note,
        "clearance_m": edge.clearance_m,
        "cost_mult": edge.cost_mult,
    }


def _walk_crosses_water(edge: Edge, na: QrNode, nb: QrNode) -> bool:
    from ..services.river_guard import load_water_index, river_crossings

    water = load_water_index()
    if water is None or water.empty:
        return False
    nodes = {n.code: {"lat": n.lat, "lon": n.lon} for n in (na, nb)}
    lane = {"from_code": edge.from_code, "to_code": edge.to_code, "path_json": edge.path_json, "source": edge.source}
    return bool(river_crossings(lane, nodes, water))


@router.post("/record-path")
def record_verified_path(
    body: VolunteerRecordPathRequest,
    db: Session = Depends(get_db),
    vol: Volunteer = Depends(require_volunteer),
):
    """
    Volunteer walks the real corridor once (around desks/glass).
    We store waypoints + headings as a verified walkable edge for offline A*.
    """
    _refuse_simulated_in_production(body.simulated)
    a = body.from_code.strip().upper()
    b = body.to_code.strip().upper()
    if a == b:
        raise HTTPException(400, "Start and end boards must be different")

    na = db.query(QrNode).filter(QrNode.code == a).first()
    nb = db.query(QrNode).filter(QrNode.code == b).first()
    if not na or not nb:
        raise HTTPException(404, "Both boards must be registered first")

    points = [(w.lat, w.lon) for w in body.waypoints]
    headings = [w.heading_deg for w in body.waypoints]
    path_m = _path_length_m(points)
    if path_m < 1:
        path_m = max(1.0, haversine_m(na.lat, na.lon, nb.lat, nb.lon))

    heading_ab = _heading_from_path(points, headings, from_start=True)
    heading_ba = _heading_from_path(points, headings, from_start=False)

    payload = [
        {
            "lat": w.lat,
            "lon": w.lon,
            "heading_deg": w.heading_deg,
            "t_ms": w.t_ms,
        }
        for w in body.waypoints
    ]

    edge = (
        db.query(Edge)
        .filter(
            ((Edge.from_code == a) & (Edge.to_code == b))
            | ((Edge.from_code == b) & (Edge.to_code == a))
        )
        .first()
    )
    if edge is None:
        edge = Edge(
            from_code=a,
            to_code=b,
            distance_m=round(path_m, 1),
            surface="paved",
            walkable=True,
            bidirectional=True,
            passage_kind="corridor",
            door_state="none",
            blocked=False,
        )
        db.add(edge)
    else:
        if edge.bidirectional is False and edge.from_code.upper() != a:
            # One-way lanes (crowd-control rules) only open the stored way.
            raise HTTPException(
                409,
                f"Lane {edge.from_code}→{edge.to_code} is one-way; "
                f"it cannot be walked {a}→{b}",
            )
        # Normalize storage orientation to from→to as submitted.
        edge.from_code = a
        edge.to_code = b
        edge.distance_m = round(path_m, 1)
        # A walk never reopens a closed lane: it may have been recorded before
        # the closure and sent later from the offline queue. Reopening is its
        # own decision (edge-status), and an admin's rejection stands.

    edge.heading_ab = heading_ab
    edge.heading_ba = heading_ba
    rejected = edge.verification == REJECTED
    still_closed = bool(edge.blocked or edge.door_state == "closed" or edge.walkable is False)
    edge.verified_at = datetime.utcnow()
    edge.updated_by = vol.id
    if body.simulated:
        # A simulated walk is kept (for testing the app) but proves nothing.
        if edge.verification not in REVIEWED:
            edge.verification = UNVERIFIED
            edge.verification_note = SIMULATED_NOTE
            edge.verified = False
    else:
        edge.verified = not rejected
        if edge.verification not in (OFFICIALLY_VERIFIED, REJECTED):
            edge.verification = VOLUNTEER_VERIFIED  # walked with GPS
    edge.path_json = json.dumps(payload)
    if not rejected and edge.verification == OFFICIALLY_VERIFIED and _walk_crosses_water(edge, na, nb):
        # An admin approved an earlier shape; this walk crosses water (a GPS
        # gap on a bridge looks like a jump over the river): review it again.
        edge.verification = VOLUNTEER_VERIFIED
    if not rejected:
        edge.obstacle_note = None
    db.flush()
    audit(db, vol, "lane.walk", f"lane:{edge.id}",
          f"Walked {a} → {b} ({round(path_m)} m, {len(payload)} GPS points)"
          + (" — simulated" if body.simulated else "")
          + (" — lane is rejected, walk kept for review" if rejected else "")
          + (" — lane stays closed" if still_closed and not rejected else ""))

    db.commit()
    db.refresh(edge)
    try:
        ensure_current_pack(db)
    except Exception as exc:  # noqa: BLE001
        print(f"Pack rebuild note: {exc}")

    return {
        "success": True,
        "message": (
            "This lane was rejected by an admin — your walk is saved for review"
            if rejected
            else "Walk recorded. The lane is still closed — reopen it separately if it is open now"
            if still_closed
            else "Verified walkable path recorded"
        ),
        "still_closed": still_closed,
        "from_code": edge.from_code,
        "to_code": edge.to_code,
        "distance_m": edge.distance_m,
        "heading_ab": edge.heading_ab,
        "heading_ba": edge.heading_ba,
        "verified": not rejected,
        "verification": edge.verification,
        "waypoint_count": len(payload),
    }


@router.get("/nodes/{code}", response_model=QrNodeOut)
def get_registered(code: str, db: Session = Depends(get_db), vol: Volunteer = Depends(require_volunteer)):
    node = db.query(QrNode).filter(QrNode.code == code.upper()).first()
    if not node:
        raise HTTPException(404, f"Unknown QR code: {code}")
    return node
