"""Volunteer location registration — separate from pilgrim wayfinding."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import Edge, QrNode, get_db
from ..schemas import (
    QrNodeOut,
    VolunteerRegisterRequest,
    VolunteerRegisterResponse,
)
from ..services.pack_builder import build_offline_pack, haversine_m

router = APIRouter(prefix="/api/volunteer", tags=["volunteer"])

# Special QR — opens registration form; is NOT a navigation node.
VOLUNTEER_REGISTER_CODE = "VOLUNTEER_REGISTER"


def _next_location_code(db: Session) -> str:
    """Generate unique KUMBH-A01, KUMBH-A02, …"""
    existing = {
        n.code.upper()
        for n in db.query(QrNode.code).all()
    }
    for i in range(1, 10000):
        code = f"KUMBH-A{i:02d}" if i < 100 else f"KUMBH-A{i}"
        if code not in existing:
            return code
    raise HTTPException(500, "Could not allocate a unique location code")


@router.get("/register-code")
def volunteer_register_code():
    """The one special QR payload volunteers must scan."""
    return {
        "code": VOLUNTEER_REGISTER_CODE,
        "hint": "Scan this QR to open location registration (not a place board).",
    }


def _link_volunteer_board(db: Session, node: QrNode) -> int:
    """
    Connect a new volunteer board to other KUMBH-A* boards by GPS distance.
    Without edges, User routing has no path and looked 'already arrived'.
    """
    others = (
        db.query(QrNode)
        .filter(QrNode.code.like("KUMBH-A%"), QrNode.code != node.code)
        .all()
    )
    added = 0
    for other in others:
        exists = (
            db.query(Edge)
            .filter(
                (
                    (Edge.from_code == node.code) & (Edge.to_code == other.code)
                )
                | (
                    (Edge.from_code == other.code) & (Edge.to_code == node.code)
                )
            )
            .first()
        )
        if exists:
            continue
        dist = round(haversine_m(node.lat, node.lon, other.lat, other.lon), 1)
        # Avoid zero-length edges if GPS duplicates
        if dist < 1:
            dist = 1.0
        db.add(
            Edge(
                from_code=node.code,
                to_code=other.code,
                distance_m=dist,
                surface="paved",
                walkable=True,
                bidirectional=True,
            )
        )
        added += 1
    if added:
        db.commit()
    return added


@router.post("/register", response_model=VolunteerRegisterResponse)
def register_location(body: VolunteerRegisterRequest, db: Session = Depends(get_db)):
    """
    Create a new QrNode from volunteer GPS + form.
    Rejects duplicate codes. Links walkable edges to other volunteer boards.
    Rebuilds offline pack so User wayfinding can route.
    """
    code = (body.code or _next_location_code(db)).strip().upper()
    if code == VOLUNTEER_REGISTER_CODE:
        raise HTTPException(
            400,
            "VOLUNTEER_REGISTER is not a location board code",
        )

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
        _link_volunteer_board(db, node)
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


@router.get("/nodes/{code}", response_model=QrNodeOut)
def get_registered(code: str, db: Session = Depends(get_db)):
    node = db.query(QrNode).filter(QrNode.code == code.upper()).first()
    if not node:
        raise HTTPException(404, f"Unknown QR code: {code}")
    return node
