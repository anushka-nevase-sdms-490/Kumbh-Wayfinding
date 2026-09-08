from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


class QrNodeCreate(BaseModel):
    code: str = Field(..., min_length=2, max_length=32)
    name: str
    lat: float
    lon: float
    node_type: str = "junction"
    icon: Optional[str] = None
    description: Optional[str] = None
    local_name: Optional[str] = None


class QrNodeOut(QrNodeCreate):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

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


class VolunteerRegisterRequest(BaseModel):
    """Volunteer registers a physical board location (GPS from device)."""

    location_name: str = Field(..., min_length=1, max_length=128)
    local_name: str = Field(..., min_length=1, max_length=128)
    lat: float
    lon: float
    node_type: str = "landmark"
    # Optional override; normally server assigns KUMBH-A## 
    code: Optional[str] = Field(None, min_length=2, max_length=32)

    @field_validator("lat")
    @classmethod
    def lat_range(cls, v: float) -> float:
        if v < -90 or v > 90:
            raise ValueError("Latitude must be between -90 and 90")
        return v

    @field_validator("lon")
    @classmethod
    def lon_range(cls, v: float) -> float:
        if v < -180 or v > 180:
            raise ValueError("Longitude must be between -180 and 180")
        return v

    @field_validator("location_name", "local_name")
    @classmethod
    def strip_nonempty(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("Field cannot be empty")
        return s


class VolunteerRegisterResponse(BaseModel):
    success: bool
    message: str
    node: Optional[QrNodeOut] = None
    existing_name: Optional[str] = None
