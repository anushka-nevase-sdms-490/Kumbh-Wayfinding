"""
Visitor "path blocked" reports. Anyone may report; a report changes nothing
for other visitors (it could be a mistake, or misuse to steer crowds) until a
volunteer confirms it on the spot, which blocks the lane for a few hours.
"""
import hashlib
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..auth import require_volunteer
from ..config import settings
from ..audit import audit
from ..db import BlockReport, Edge, QrNode, Volunteer, get_db
from ..schemas import BlockReportCreate, BlockReportOut, ConfirmReportRequest
from ..services.pack_builder import ensure_current_pack, expire_blocks, haversine_m

router = APIRouter(prefix="/api/reports", tags=["reports"])

# A report nobody acted on is stale after this long.
REPORT_TTL = timedelta(hours=2)
# Per phone per hour.
MAX_REPORTS_PER_HOUR = 5
# Per IP per hour: only against floods — many phones share one mobile-network IP.
MAX_REPORTS_PER_IP_HOUR = 60


def _reporter_hash(request: Request) -> str:
    # The real client IP: uvicorn takes it from X-Forwarded-For set by a trusted proxy.
    ip = request.client.host if request.client else "unknown"
    day = datetime.utcnow().strftime("%Y-%m-%d")
    return hashlib.sha256(f"{ip}|{settings.secret_key}|{day}".encode()).hexdigest()


def _device_hash(device: str | None, ip_hash: str) -> str:
    if not device:
        return ip_hash  # older app without a phone id
    return hashlib.sha256(f"{device}|{settings.secret_key}".encode()).hexdigest()


def _lane(db: Session, a: str, b: str) -> Edge | None:
    return (
        db.query(Edge)
        .filter(
            ((Edge.from_code == a) & (Edge.to_code == b))
            | ((Edge.from_code == b) & (Edge.to_code == a))
        )
        .first()
    )


@router.post("", status_code=201)
def create_report(body: BlockReportCreate, request: Request, db: Session = Depends(get_db)):
    a, b = body.from_code.strip().upper(), body.to_code.strip().upper()
    edge = _lane(db, a, b)
    if edge is None or not edge.walkable or edge.blocked or edge.door_state == "closed":
        raise HTTPException(404, "No open lane between those places")
    ip_hash = _reporter_hash(request)
    phone = _device_hash(body.device, ip_hash)
    now = datetime.utcnow()
    same = (
        db.query(BlockReport)
        .filter(
            BlockReport.edge_id == edge.id,
            BlockReport.device_hash == phone,
            BlockReport.status == "pending",
        )
        .first()
    )
    if same is not None:
        return {"success": True, "id": same.id, "duplicate": True}
    hour_ago = now - timedelta(hours=1)
    by_phone = (
        db.query(BlockReport)
        .filter(BlockReport.device_hash == phone, BlockReport.created_at > hour_ago)
        .count()
    )
    by_ip = (
        db.query(BlockReport)
        .filter(BlockReport.reporter_hash == ip_hash, BlockReport.created_at > hour_ago)
        .count()
    )
    if by_phone >= MAX_REPORTS_PER_HOUR or by_ip >= MAX_REPORTS_PER_IP_HOUR:
        raise HTTPException(429, "Too many reports from this phone — a volunteer will check")
    row = BlockReport(
        edge_id=edge.id,
        reporter_hash=ip_hash,
        device_hash=phone,
        created_at=now,
        expires_at=now + REPORT_TTL,
    )
    db.add(row)
    db.commit()
    return {"success": True, "id": row.id, "duplicate": False}


@router.get("", response_model=list[BlockReportOut])
def list_reports(
    status: str = "pending",
    lat: float | None = None,
    lon: float | None = None,
    db: Session = Depends(get_db),
    vol: Volunteer = Depends(require_volunteer),
):
    """One entry per lane (the newest report), nearest first when lat/lon are given."""
    expire_blocks(db)
    rows = (
        db.query(BlockReport)
        .filter(BlockReport.status == status)
        .order_by(BlockReport.created_at.desc())
        .all()
    )
    by_edge: dict[int, list[BlockReport]] = {}
    for r in rows:
        by_edge.setdefault(r.edge_id, []).append(r)
    names = {n.code: n for n in db.query(QrNode).all()}
    out = []
    for edge_id, reports in by_edge.items():
        edge = db.get(Edge, edge_id)
        if edge is None:
            continue
        a, b = names.get(edge.from_code), names.get(edge.to_code)
        if a is None or b is None:
            continue
        mid_lat, mid_lon = (a.lat + b.lat) / 2, (a.lon + b.lon) / 2
        newest = reports[0]
        out.append(
            BlockReportOut(
                id=newest.id,
                from_code=edge.from_code,
                to_code=edge.to_code,
                from_name=a.name or "road junction",
                to_name=b.name or "road junction",
                lat=mid_lat,
                lon=mid_lon,
                created_at=newest.created_at,
                expires_at=newest.expires_at,
                status=newest.status,
                reporters=len({r.device_hash or r.reporter_hash for r in reports}),
                distance_m=(
                    round(haversine_m(lat, lon, mid_lat, mid_lon)) if lat is not None and lon is not None else None
                ),
            )
        )
    out.sort(key=lambda r: (r.distance_m is None, r.distance_m or 0, -r.created_at.timestamp()))
    return out


def _resolve(db: Session, report_id: int, status: str, vol: Volunteer) -> tuple[BlockReport, Edge]:
    report = db.get(BlockReport, report_id)
    if report is None:
        raise HTTPException(404, "No such report")
    if report.status != "pending":
        raise HTTPException(409, f"This report is already {report.status}")
    edge = db.get(Edge, report.edge_id)
    now = datetime.utcnow()
    # Every pending report on the lane is settled together.
    for r in db.query(BlockReport).filter(
        BlockReport.edge_id == report.edge_id, BlockReport.status == "pending"
    ):
        r.status, r.resolved_by, r.resolved_at = status, vol.id, now
    return report, edge


@router.post("/{report_id}/confirm")
def confirm_report(
    report_id: int,
    body: ConfirmReportRequest,
    db: Session = Depends(get_db),
    vol: Volunteer = Depends(require_volunteer),
):
    _, edge = _resolve(db, report_id, "confirmed", vol)
    edge.blocked = True
    edge.blocked_until = datetime.utcnow() + timedelta(hours=body.hours) if body.hours else None
    edge.obstacle_note = edge.obstacle_note or "visitor_report"
    edge.updated_by = vol.id
    audit(db, vol, "lane.block", f"lane:{edge.id}",
          f"Confirmed a visitor report: {edge.from_code} ↔ {edge.to_code} blocked "
          + (f"for {body.hours} h" if body.hours else "until reopened"))
    db.commit()
    ensure_current_pack(db)
    return {"success": True, "blocked_until": edge.blocked_until}


@router.post("/{report_id}/reject")
def reject_report(
    report_id: int,
    db: Session = Depends(get_db),
    vol: Volunteer = Depends(require_volunteer),
):
    _, edge = _resolve(db, report_id, "rejected", vol)
    if edge is not None:
        audit(db, vol, "report.reject", f"lane:{edge.id}",
              f"Visitor report checked: {edge.from_code} ↔ {edge.to_code} is not blocked")
    db.commit()
    return {"success": True}
