from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


class QrNodeCreate(BaseModel):
    code: str = Field(..., min_length=2, max_length=32)
    name: str = Field(..., max_length=128)
    lat: float
    lon: float
    node_type: str = Field("junction", max_length=32)
    icon: Optional[str] = Field(None, max_length=32)
    description: Optional[str] = Field(None, max_length=1000)
    local_name: Optional[str] = Field(None, max_length=128)
    # Accuracy (m) of the GPS fix the place was saved from, when known.
    gps_accuracy_m: Optional[float] = None


class QrNodeOut(QrNodeCreate):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    # Trust level (app/verification.py) — set by the server only.
    verification: str = "unverified"

    class Config:
        from_attributes = True


class EdgeCreate(BaseModel):
    from_code: str = Field(..., min_length=1, max_length=32)
    to_code: str = Field(..., min_length=1, max_length=32)
    distance_m: float
    surface: str = Field("paved", max_length=32)
    walkable: bool = True
    bidirectional: bool = True
    heading_ab: Optional[float] = None
    heading_ba: Optional[float] = None
    passage_kind: str = Field("corridor", max_length=32)  # corridor | door | glass_door | passage
    door_state: str = Field("none", max_length=16)  # none | open | closed | unknown
    blocked: bool = False
    obstacle_note: Optional[str] = Field(None, max_length=64)
    clearance_m: Optional[float] = None
    cost_mult: float = 1.0
    verified: bool = False
    path_json: Optional[str] = Field(None, max_length=500_000)


class EdgeOut(EdgeCreate):
    id: int
    # volunteer | osm (map road nobody has walked yet) — set by the server only.
    source: str = "volunteer"
    name: Optional[str] = None
    verified_at: Optional[datetime] = None
    # Trust level (app/verification.py) — set by the server only.
    verification: str = "unverified"

    class Config:
        from_attributes = True


class SyncBatch(BaseModel):
    """Idempotent staff sync payload — replaying is safe."""

    client_batch_id: str = Field(..., max_length=64)
    nodes: List[QrNodeCreate] = Field(default_factory=list, max_length=5000)
    edges: List[EdgeCreate] = Field(default_factory=list, max_length=10000)


class SyncResult(BaseModel):
    client_batch_id: str
    nodes_upserted: int
    edges_upserted: int


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
    # Accuracy of the volunteer's live GPS fix; places are saved from on-site GPS.
    gps_accuracy_m: Optional[float] = Field(None, ge=0)
    node_type: str = Field("landmark", max_length=32)
    # Optional override; normally server assigns KUMBH-A##
    code: Optional[str] = Field(None, min_length=2, max_length=32)
    # "This is <map place>": confirm this unconfirmed OpenStreetMap place
    # (keeps its code) instead of adding a new one. Never inferred.
    confirm_code: Optional[str] = Field(None, min_length=2, max_length=32)
    # Walkable neighbor — previous board on the real path.
    connect_to_code: Optional[str] = Field(None, min_length=2, max_length=32)
    # Compass heading while standing at the NEW board, pointing along the
    # walkable path toward the previous board (around desks/glass).
    path_heading_deg: Optional[float] = None
    # Sent from the development simulation (positions not from a phone on
    # site): saved as unverified in development, refused in production.
    simulated: bool = False

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
    door_state: Optional[str] = Field(None, max_length=16)  # none | open | closed | unknown
    passage_kind: Optional[str] = Field(None, max_length=32)
    obstacle_note: Optional[str] = Field(None, max_length=64)
    clearance_m: Optional[float] = None
    walkable: Optional[bool] = None
    # With blocked=true: reopen by itself after this many hours (null: until reopened).
    hours: Optional[float] = Field(None, gt=0, le=72)

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
    # False when an admin must publish before visitors see the place (PUBLISH_MODE=manual).
    live: bool = True


class PathWaypoint(BaseModel):
    lat: float
    lon: float
    heading_deg: Optional[float] = None
    t_ms: Optional[int] = None


class VolunteerRecordPathRequest(BaseModel):
    """Volunteer walks from → to once; we store that as a verified walkable path."""

    from_code: str = Field(..., min_length=2, max_length=32)
    to_code: str = Field(..., min_length=2, max_length=32)
    # About an hour of walking at one point per second.
    waypoints: List[PathWaypoint] = Field(..., min_length=2, max_length=5000)
    # Sent from the development simulation (positions not from a phone on
    # site): saved as unverified in development, refused in production.
    simulated: bool = False


class LoginRequest(BaseModel):
    phone: str = Field(..., min_length=10, max_length=20)
    pin: str = Field(..., pattern=r"^\d{6}$")


class VolunteerOut(BaseModel):
    id: int
    phone: str
    name: str
    role: str

    class Config:
        from_attributes = True


class LoginResponse(BaseModel):
    token: str
    expires_at: datetime
    volunteer: VolunteerOut


class BlockReportCreate(BaseModel):
    """A visitor's "path blocked" on the lane between two places."""

    from_code: str = Field(..., min_length=2, max_length=32)
    to_code: str = Field(..., min_length=2, max_length=32)
    # Random id the phone keeps (localStorage), so each phone counts once.
    device: Optional[str] = Field(None, min_length=8, max_length=64)


class BlockReportOut(BaseModel):
    id: int
    from_code: str
    to_code: str
    from_name: str
    to_name: str
    lat: float
    lon: float
    created_at: datetime
    expires_at: datetime
    status: str
    # Different visitors who reported this lane while it is pending.
    reporters: int
    distance_m: Optional[float] = None


class ConfirmReportRequest(BaseModel):
    # Hours until the lane reopens by itself; null keeps it closed until reopened.
    hours: Optional[float] = Field(1, gt=0, le=72)


class AdminPlace(BaseModel):
    code: str
    name: str
    lat: float
    lon: float
    node_type: str
    # A volunteer saved it from on-site GPS (OSM imports are unconfirmed).
    confirmed: bool
    verification: str = "unverified"
    verification_note: Optional[str] = None


class AdminLane(BaseModel):
    id: int
    from_code: str
    to_code: str
    source: str
    verified: bool
    walkable: bool
    blocked: bool
    blocked_until: Optional[datetime] = None
    door_state: str
    obstacle_note: Optional[str] = None
    name: Optional[str] = None
    distance_m: float
    path_json: Optional[str] = None
    verification: str = "unverified"
    verification_note: Optional[str] = None


class AdminOverview(BaseModel):
    places: List[AdminPlace]
    junctions: dict[str, tuple[float, float]]
    lanes: List[AdminLane]
    reports: List[BlockReportOut]


class PublishRequest(BaseModel):
    note: Optional[str] = Field(None, max_length=256)


class RollbackRequest(BaseModel):
    release_id: int


class VerifyRequest(BaseModel):
    """Admin sets how far a place or a lane can be trusted (app/verification.py)."""

    target: str = Field(..., pattern=r"^(place|lane)$")
    code: Optional[str] = Field(None, max_length=32)  # place
    lane_id: Optional[int] = None  # lane
    status: str
    note: Optional[str] = Field(None, max_length=256)

    @field_validator("status")
    @classmethod
    def status_ok(cls, v: str) -> str:
        from .verification import STATUSES

        if v not in STATUSES:
            raise ValueError(f"status must be one of {', '.join(STATUSES)}")
        return v
