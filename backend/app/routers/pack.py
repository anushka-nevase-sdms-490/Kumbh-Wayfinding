import os

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..db import PackVersion, get_db
from ..schemas import OfflinePack, PackMeta
from ..services.pack_builder import build_offline_pack

router = APIRouter(prefix="/api/pack", tags=["pack"])


@router.post("/build", response_model=OfflinePack)
def build_pack(db: Session = Depends(get_db)):
    pack, _ = build_offline_pack(db)
    return pack


@router.get("/latest", response_model=PackMeta)
def latest_pack(db: Session = Depends(get_db)):
    row = db.query(PackVersion).order_by(PackVersion.id.desc()).first()
    if not row:
        raise HTTPException(404, "No pack built yet. POST /api/pack/build first.")
    return PackMeta(
        version=row.version,
        signature=row.signature,
        node_count=row.node_count,
        edge_count=row.edge_count,
        created_at=row.created_at,
        download_url=f"/api/pack/download/{row.version}",
    )


@router.get("/download/{version}")
def download_pack(version: str, db: Session = Depends(get_db)):
    row = db.query(PackVersion).filter(PackVersion.version == version).first()
    if not row or not os.path.exists(row.file_path):
        raise HTTPException(404, "Pack file not found")
    return FileResponse(
        row.file_path,
        media_type="application/json",
        filename=f"setu_pack_{version}.json",
    )


@router.get("/latest/json", response_model=OfflinePack)
def latest_pack_json(db: Session = Depends(get_db)):
    """Convenience: rebuild-or-return latest pack body for the pilgrim app."""
    row = db.query(PackVersion).order_by(PackVersion.id.desc()).first()
    if not row:
        pack, _ = build_offline_pack(db)
        return pack
    pack, _ = build_offline_pack(db)
    return pack
