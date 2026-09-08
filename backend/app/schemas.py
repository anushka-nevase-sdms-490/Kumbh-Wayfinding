from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class QrNodeCreate(BaseModel):
    code: str = Field(..., min_length=2, max_length=32)
    name: str
    lat: float
    lon: float
    node_type: str = "junction"
    icon: Optional[str] = None
    description: Optional[str] = None


class QrNodeOut(QrNodeCreate):
    id: int
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class EdgeCreate(BaseModel):
    from_code: str
    to_code: str
    distance_m: float
    surface: str = "paved"
    walkable: bool = True
    bidirectional: bool = True


class EdgeOut(EdgeCreate):
    id: int

    class Config:
        from_attributes = True


class SyncBatch(BaseModel):
    """Idempotent staff sync payload — replaying is safe."""

    client_batch_id: str
    nodes: List[QrNodeCreate] = []
    edges: List[EdgeCreate] = []


class SyncResult(BaseModel):
    client_batch_id: str
    nodes_upserted: int
    edges_upserted: int


class OfflinePack(BaseModel):
    version: str
    generated_at: datetime
    signature: str
    nodes: List[QrNodeOut]
    edges: List[EdgeOut]


class PackMeta(BaseModel):
    version: str
    signature: str
    node_count: int
    edge_count: int
    created_at: datetime
    download_url: str
