from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import Edge, QrNode, get_db
from ..schemas import EdgeCreate, EdgeOut, QrNodeCreate, QrNodeOut, SyncBatch, SyncResult

router = APIRouter(prefix="/api", tags=["nodes"])


@router.get("/nodes", response_model=list[QrNodeOut])
def list_nodes(db: Session = Depends(get_db)):
    return db.query(QrNode).order_by(QrNode.code).all()


@router.post("/nodes", response_model=QrNodeOut)
def create_node(body: QrNodeCreate, db: Session = Depends(get_db)):
    """Create a node. Duplicate code → 409 (no silent overwrite)."""
    body.code = body.code.upper()
    existing = db.query(QrNode).filter(QrNode.code == body.code).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail={
                "success": False,
                "message": "QR is already registered",
                "existing_name": existing.name,
                "code": existing.code,
            },
        )
    node = QrNode(**body.model_dump())
    db.add(node)
    db.commit()
    db.refresh(node)
    return node


@router.get("/nodes/{code}", response_model=QrNodeOut)
def get_node(code: str, db: Session = Depends(get_db)):
    node = db.query(QrNode).filter(QrNode.code == code.upper()).first()
    if not node:
        raise HTTPException(404, f"Unknown QR code: {code}")
    return node


@router.get("/edges", response_model=list[EdgeOut])
def list_edges(db: Session = Depends(get_db)):
    return db.query(Edge).all()


@router.post("/edges", response_model=EdgeOut)
def create_edge(body: EdgeCreate, db: Session = Depends(get_db)):
    edge = Edge(**body.model_dump())
    db.add(edge)
    db.commit()
    db.refresh(edge)
    return edge


@router.post("/sync", response_model=SyncResult)
def sync_batch(body: SyncBatch, db: Session = Depends(get_db)):
    """Idempotent batch upsert from ground-staff phones."""
    nodes_n = 0
    edges_n = 0
    for n in body.nodes:
        n.code = n.code.upper()
        existing = db.query(QrNode).filter(QrNode.code == n.code).first()
        if existing:
            for k, v in n.model_dump().items():
                setattr(existing, k, v)
        else:
            db.add(QrNode(**n.model_dump()))
        nodes_n += 1

    for e in body.edges:
        e.from_code = e.from_code.upper()
        e.to_code = e.to_code.upper()
        existing = (
            db.query(Edge)
            .filter(Edge.from_code == e.from_code, Edge.to_code == e.to_code)
            .first()
        )
        if existing:
            for k, v in e.model_dump().items():
                setattr(existing, k, v)
        else:
            db.add(Edge(**e.model_dump()))
        edges_n += 1

    db.commit()
    return SyncResult(
        client_batch_id=body.client_batch_id,
        nodes_upserted=nodes_n,
        edges_upserted=edges_n,
    )
