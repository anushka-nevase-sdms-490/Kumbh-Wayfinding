"""Volunteer location registration — separate from visitor wayfinding."""

import json
from datetime import datetime
from math import atan2, cos, degrees, radians, sin

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import Edge, QrNode, get_db
from ..schemas import (
    QrNodeOut,
    VolunteerEdgeStatusRequest,
    VolunteerPathHeadingRequest,
    VolunteerRecordPathRequest,
    VolunteerRegisterRequest,
    VolunteerRegisterResponse,
)
from ..services.pack_builder import build_offline_pack, haversine_m

router = APIRouter(prefix="/api/volunteer", tags=["volunteer"])

VOLUNTEER_REGISTER_CODE = "VOLUNTEER_REGISTER"


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
    """
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


@router.get("/register-code")
def volunteer_register_code():
    return {
        "code": VOLUNTEER_REGISTER_CODE,
        "hint": "Scan this QR to open location registration (not a place board).",
    }


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
    connect_to_code: str | None,
    path_heading_deg: float | None,
) -> int:
    others = (
        db.query(QrNode)
        .filter(QrNode.code.like("KUMBH-A%"), QrNode.code != node.code)
        .all()
    )
    if not others:
        return 0

    if connect_to_code:
        code = connect_to_code.strip().upper()
        target = next((o for o in others if o.code.upper() == code), None)
        if target is None:
            raise HTTPException(400, f"Unknown board to connect to: {connect_to_code}")
    else:
        target = min(
            others, key=lambda o: haversine_m(node.lat, node.lon, o.lat, o.lon)
        )

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

    if path_heading_deg is not None:
        # Standing at new node, facing previous along walk.
        _apply_path_headings(edge, target.code, node.code, path_heading_deg)

    db.commit()
    return 1


@router.post("/register", response_model=VolunteerRegisterResponse)
def register_location(body: VolunteerRegisterRequest, db: Session = Depends(get_db)):
    code = (body.code or _next_location_code(db)).strip().upper()
    if code == VOLUNTEER_REGISTER_CODE:
        raise HTTPException(400, "VOLUNTEER_REGISTER is not a location board code")

    existing = db.query(QrNode).filter(QrNode.code == code).first()
    if existing:
        return VolunteerRegisterResponse(
            success=False,
            message="QR is already registered",
            existing_name=existing.name,
            node=QrNodeOut.model_validate(existing),
        )

    node = QrNode(
        code=code,
        name=body.location_name,
        local_name=body.local_name,
        lat=body.lat,
        lon=body.lon,
        node_type=body.node_type or "landmark",
        icon="landmark",
        description=body.local_name,
    )
    db.add(node)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        again = db.query(QrNode).filter(QrNode.code == code).first()
        return VolunteerRegisterResponse(
            success=False,
            message="QR is already registered",
            existing_name=again.name if again else None,
            node=QrNodeOut.model_validate(again) if again else None,
        )

    db.refresh(node)
    try:
        _link_volunteer_board(
            db, node, body.connect_to_code, body.path_heading_deg
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        print(f"Volunteer edge link note: {exc}")

    try:
        build_offline_pack(db)
    except Exception as exc:  # noqa: BLE001
        print(f"Pack rebuild note: {exc}")

    return VolunteerRegisterResponse(
        success=True,
        message="Location registered successfully",
        node=QrNodeOut.model_validate(node),
    )


@router.post("/path-heading")
def set_path_heading(body: VolunteerPathHeadingRequest, db: Session = Depends(get_db)):
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
    db.commit()
    try:
        build_offline_pack(db)
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
def set_edge_status(body: VolunteerEdgeStatusRequest, db: Session = Depends(get_db)):
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
    if body.door_state is not None:
        edge.door_state = body.door_state
    if body.passage_kind is not None:
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

    db.commit()
    try:
        build_offline_pack(db)
    except Exception as exc:  # noqa: BLE001
        print(f"Pack rebuild note: {exc}")

    return {
        "success": True,
        "from_code": edge.from_code,
        "to_code": edge.to_code,
        "walkable": edge.walkable,
        "blocked": edge.blocked,
        "door_state": edge.door_state,
        "passage_kind": edge.passage_kind,
        "obstacle_note": edge.obstacle_note,
        "clearance_m": edge.clearance_m,
        "cost_mult": edge.cost_mult,
    }


@router.post("/record-path")
def record_verified_path(body: VolunteerRecordPathRequest, db: Session = Depends(get_db)):
    """
    Volunteer walks the real corridor once (around desks/glass).
    We store waypoints + headings as a verified walkable edge for offline A*.
    """
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
        # Normalize storage orientation to from→to as submitted.
        edge.from_code = a
        edge.to_code = b
        edge.distance_m = round(path_m, 1)
        edge.walkable = True
        edge.blocked = False
        if edge.door_state == "closed":
            edge.door_state = "open"

    edge.heading_ab = heading_ab
    edge.heading_ba = heading_ba
    edge.verified = True
    edge.verified_at = datetime.utcnow()
    edge.path_json = json.dumps(payload)
    edge.obstacle_note = None

    db.commit()
    db.refresh(edge)
    try:
        build_offline_pack(db)
    except Exception as exc:  # noqa: BLE001
        print(f"Pack rebuild note: {exc}")

    return {
        "success": True,
        "message": "Verified walkable path recorded",
        "from_code": edge.from_code,
        "to_code": edge.to_code,
        "distance_m": edge.distance_m,
        "heading_ab": edge.heading_ab,
        "heading_ba": edge.heading_ba,
        "verified": True,
        "waypoint_count": len(payload),
    }


@router.get("/nodes/{code}", response_model=QrNodeOut)
def get_registered(code: str, db: Session = Depends(get_db)):
    node = db.query(QrNode).filter(QrNode.code == code.upper()).first()
    if not node:
        raise HTTPException(404, f"Unknown QR code: {code}")
    return node
