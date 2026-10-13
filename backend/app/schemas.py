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
    heading_ab: Optional[float] = None
    heading_ba: Optional[float] = None
    passage_kind: str = "corridor"  # corridor | door | glass_door | passage
    door_state: str = "none"  # none | open | closed | unknown
    blocked: bool = False
    obstacle_note: Optional[str] = None
    clearance_m: Optional[float] = None
    cost_mult: float = 1.0
    verified: bool = False
    path_json: Optional[str] = None


class EdgeOut(EdgeCreate):
    id: int
    verified_at: Optional[datetime] = None

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
    # Walkable neighbor — previous board on the real path.
    connect_to_code: Optional[str] = Field(None, min_length=2, max_length=32)
    # Compass heading while standing at the NEW board, pointing along the
    # walkable path toward the previous board (around desks/glass).
    path_heading_deg: Optional[float] = None

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


class VolunteerPathHeadingRequest(BaseModel):
    """Set real walk direction on an existing edge (fixes straight-through-desk arrows)."""

    from_code: str = Field(..., min_length=2, max_length=32)
    to_code: str = Field(..., min_length=2, max_length=32)
    # Standing at `to_code`, phone pointed along walk toward `from_code`.
    path_heading_deg: float

    @field_validator("path_heading_deg")
    @classmethod
    def heading_range(cls, v: float) -> float:
        return ((v % 360) + 360) % 360


class VolunteerEdgeStatusRequest(BaseModel):
    """Block a path or set door state so A* never routes through it."""

    from_code: str = Field(..., min_length=2, max_length=32)
    to_code: str = Field(..., min_length=2, max_length=32)
    blocked: Optional[bool] = None
    door_state: Optional[str] = None  # none | open | closed | unknown
    passage_kind: Optional[str] = None
    obstacle_note: Optional[str] = None
    clearance_m: Optional[float] = None
    walkable: Optional[bool] = None

    @field_validator("door_state")
    @classmethod
    def door_ok(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        s = v.strip().lower()
        if s not in {"none", "open", "closed", "unknown"}:
            raise ValueError("door_state must be none|open|closed|unknown")
        return s


class VolunteerRegisterResponse(BaseModel):
    success: bool
    message: str
    node: Optional[QrNodeOut] = None
    existing_name: Optional[str] = None


class PathWaypoint(BaseModel):
    lat: float
    lon: float
    heading_deg: Optional[float] = None
    t_ms: Optional[int] = None


class VolunteerRecordPathRequest(BaseModel):
    """Volunteer walks from → to once; we store that as a verified walkable path."""

    from_code: str = Field(..., min_length=2, max_length=32)
    to_code: str = Field(..., min_length=2, max_length=32)
    waypoints: List[PathWaypoint] = Field(..., min_length=2)
