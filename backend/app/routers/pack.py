import os

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..auth import require_admin
from ..db import PackVersion, Volunteer, get_db
from ..schemas import PackMeta
from ..services.pack_builder import current_pack, ensure_current_pack

router = APIRouter(prefix="/api/pack", tags=["pack"])


def _meta(row: PackVersion) -> PackMeta:
    return PackMeta(
        version=row.version,
        signature=row.signature,
        node_count=row.node_count,
        edge_count=row.edge_count,
        created_at=row.created_at,
        download_url=f"/api/pack/download/{row.version}",
    )


@router.post("/build", response_model=PackMeta)
def build_pack(db: Session = Depends(get_db), admin: Volunteer = Depends(require_admin)):
    # Builds only when data changed: a forced build would make every phone
    # download the same pack again (and this has no login until step 5.1).
    return _meta(ensure_current_pack(db))


@router.get("/latest", response_model=PackMeta)
def latest_pack(db: Session = Depends(get_db)):
    """Small: phones compare `signature` with theirs before downloading."""
    return _meta(current_pack(db))


@router.get("/download/{version}")
def download_pack(version: str, db: Session = Depends(get_db)):
    row = db.query(PackVersion).filter(PackVersion.version == version).first()
    if not row or not os.path.exists(row.file_path):
        raise HTTPException(404, "Pack file not found")
    # A version's file never changes.
    return FileResponse(
        row.file_path,
        media_type="application/json",
        filename=f"setu_pack_{version}.json",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@router.get("/latest/json")
def latest_pack_json(db: Session = Depends(get_db)):
    """The current pack body, served from its file (rebuilt only on data change)."""
    row = current_pack(db)
    return FileResponse(
        row.file_path,
        media_type="application/json",
        headers={"Cache-Control": "no-cache"},
    )
