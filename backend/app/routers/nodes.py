import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import require_admin, require_volunteer
from ..audit import audit
from ..db import Edge, QrNode, Volunteer, get_db
from ..schemas import EdgeCreate, EdgeOut, QrNodeCreate, QrNodeOut, SyncBatch, SyncResult

router = APIRouter(prefix="/api", tags=["nodes"])


@router.get("/nodes", response_model=list[QrNodeOut])
def list_nodes(db: Session = Depends(get_db), vol: Volunteer = Depends(require_volunteer)):
    # Everything in the database (unpublished and rejected rows too): staff
    # only. Visitors get the published pack.
    return db.query(QrNode).order_by(QrNode.code).all()


@router.post("/nodes", response_model=QrNodeOut)
def create_node(
    body: QrNodeCreate,
    db: Session = Depends(get_db),
    admin: Volunteer = Depends(require_admin),
):
    """Create a node. Duplicate code → 409 (no silent overwrite)."""
    body.code = body.code.upper()
    existing = db.query(QrNode).filter(QrNode.code == body.code).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail={
                "success": False,
                "message": "Place is already registered",
                "existing_name": existing.name,
                "code": existing.code,
            },
        )
    node = QrNode(**body.model_dump(), updated_by=admin.id, source="admin")
    db.add(node)
    audit(db, admin, "place.add", f"place:{node.code}", f"Added place {node.name}")
    db.commit()
    db.refresh(node)
    return node


@router.get("/nodes/{code}", response_model=QrNodeOut)
def get_node(code: str, db: Session = Depends(get_db), vol: Volunteer = Depends(require_volunteer)):
    node = db.query(QrNode).filter(QrNode.code == code.upper()).first()
    if not node:
        raise HTTPException(404, f"Unknown QR code: {code}")
    return node


@router.get("/edges", response_model=list[EdgeOut])
def list_edges(db: Session = Depends(get_db), vol: Volunteer = Depends(require_volunteer)):
    return db.query(Edge).all()


def _edge_either_way(db: Session, a: str, b: str) -> Edge | None:
    return (
        db.query(Edge)
        .filter(
            ((Edge.from_code == a) & (Edge.to_code == b))
            | ((Edge.from_code == b) & (Edge.to_code == a))
        )
        .first()
    )


def _check_edge_ends(db: Session, a: str, b: str) -> None:
    """An edge to a missing place would crash routing for every visitor."""
    if a == b:
        raise HTTPException(400, "An edge must join two different places")
    found = {
        c for (c,) in db.query(QrNode.code).filter(QrNode.code.in_([a, b])).all()
    }
    missing = [c for c in (a, b) if c not in found]
    if missing:
        raise HTTPException(404, f"Unknown place code(s): {', '.join(missing)}")


@router.post("/edges", response_model=EdgeOut)
def create_edge(
    body: EdgeCreate,
    db: Session = Depends(get_db),
    admin: Volunteer = Depends(require_admin),
):
    body.from_code = body.from_code.upper()
    body.to_code = body.to_code.upper()
    _check_edge_ends(db, body.from_code, body.to_code)
    if _edge_either_way(db, body.from_code, body.to_code):
        raise HTTPException(409, "These places are already linked")
    edge = Edge(**body.model_dump(), updated_by=admin.id)
    db.add(edge)
    db.flush()
    audit(db, admin, "lane.add", f"lane:{edge.id}", f"Added lane {edge.from_code} ↔ {edge.to_code}")
    db.commit()
    db.refresh(edge)
    return edge


@router.post("/sync", response_model=SyncResult)
def sync_batch(
    body: SyncBatch,
    db: Session = Depends(get_db),
    admin: Volunteer = Depends(require_admin),
):
    """Idempotent batch upsert from ground-staff phones."""
    nodes_n = 0
    edges_n = 0
    seen_codes: set[str] = set()
    for n in body.nodes:
        n.code = n.code.upper()
        if n.code in seen_codes:
            continue
        seen_codes.add(n.code)
        existing = db.query(QrNode).filter(QrNode.code == n.code).first()
        if existing:
            # Only overwrite fields the phone actually sent.
            for k, v in n.model_dump(exclude_unset=True).items():
                setattr(existing, k, v)
        else:
            db.add(QrNode(**n.model_dump()))
        nodes_n += 1
    db.flush()

    for e in body.edges:
        e.from_code = e.from_code.upper()
        e.to_code = e.to_code.upper()
        _check_edge_ends(db, e.from_code, e.to_code)
        existing = _edge_either_way(db, e.from_code, e.to_code)
        if existing:
            # Re-orient the stored row to the incoming direction; when it
            # flips, swap the stored headings so heading_ab still means
            # from→to (incoming values below override them if sent).
            if existing.from_code != e.from_code:
                if (
                    existing.bidirectional is False
                    and "bidirectional" not in e.model_fields_set
                ):
                    # Flipping would silently reverse a one-way lane.
                    raise HTTPException(
                        409,
                        f"Lane {existing.from_code}→{existing.to_code} is one-way; "
                        "send bidirectional explicitly to change it",
                    )
                existing.heading_ab, existing.heading_ba = (
                    existing.heading_ba,
                    existing.heading_ab,
                )
                if existing.path_json:
                    existing.path_json = json.dumps(
                        list(reversed(json.loads(existing.path_json)))
                    )
            existing.from_code = e.from_code
            existing.to_code = e.to_code
            for k, v in e.model_dump(exclude_unset=True).items():
                setattr(existing, k, v)
        else:
            db.add(Edge(**e.model_dump()))
        db.flush()
        edges_n += 1

    audit(db, admin, "sync", "sync", f"Synced {nodes_n} places and {edges_n} lanes")
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Sync conflicted with existing data — retry")
    return SyncResult(
        client_batch_id=body.client_batch_id,
        nodes_upserted=nodes_n,
        edges_upserted=edges_n,
    )
