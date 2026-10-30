"""
OpenStreetMap roads and footpaths as routable lanes (pilot zone only).

Ways are split where they meet; each meeting point becomes a hidden junction
(code OSM-J<node id>, node_type "junction", no name). Every place within
ATTACH_MAX_M of a lane is joined to it by a short connector, through a hidden
junction OSM-A<place id> on the lane. OSM lanes are `verified=False`,
`source="osm"` and cost more than walked volunteer lanes, so routes keep to
walked lanes and use map roads only where nobody has walked yet.

Re-running rebuilds all OSM lanes from the data; what volunteers set on them
(blocked, obstacle, not walkable, door) is kept.
"""
import json
import re
from collections import Counter
from dataclasses import dataclass, field
from math import atan2, cos, degrees, radians, sin

from sqlalchemy.orm import Session

from ..db import Edge, QrNode
from .osm_import import PILOT_BBOX
from .pack_builder import _collect, haversine_m
from ..verification import OSM_IMPORTED, REVIEWED
from .water import BARRIER_WATERWAYS, OVERPASS_WATER_QUERY, WaterIndex

EXCLUDED_HIGHWAYS = {
    "motorway",
    "motorway_link",
    "trunk",
    "trunk_link",
    "track",
    "construction",
    "proposed",
    "abandoned",
    "raceway",
    "bus_guideway",
    "busway",
    "escape",
    "platform",
    "services",
    "rest_area",
}
FOOT_ALLOWED = {"yes", "designated", "permissive"}
FOOT_WAYS = {"footway", "pedestrian", "path", "steps", "living_street"}
# Busy city roads: walkable, but only when nothing quieter goes there.
BUSY_ROADS = {"primary", "primary_link", "secondary", "secondary_link"}

# Map roads cost more than walked lanes (which also get ×0.85 in the router).
COST_FOOT_WAY = 1.2
COST_ROAD = 1.3
COST_BUSY_ROAD = 1.5
COST_CONNECTOR = 1.5

# Keep lanes a little past the pilot box so edge places still connect.
CLIP_MARGIN_M = 100.0
# A place farther than this from any lane is not joined (shows "No walked lane yet").
ATTACH_MAX_M = 60.0
# Joining this close to a lane end uses that junction instead of splitting.
SNAP_TO_END_M = 5.0
# Heading of a lane end: looks this far along it (ignores tiny kinks).
HEADING_LOOKAHEAD_M = 10.0
# The pack goes to every phone: refuse to grow it past this without --force.
MAX_PACK_BYTES = 2_000_000

OVERPASS_NETWORK_QUERY = """
[out:json][timeout:180];
way["highway"]({bbox});
out body geom;
""".strip()


def overpass_network_query(bbox=PILOT_BBOX) -> str:
    return OVERPASS_NETWORK_QUERY.replace("{bbox}", ",".join(str(v) for v in bbox))


def overpass_water_query(bbox=PILOT_BBOX) -> str:
    """Water around the pilot zone (a little wider than the street clip)."""
    s, w, n, e = _expanded(bbox, CLIP_MARGIN_M * 2)
    return OVERPASS_WATER_QUERY.replace("{bbox}", ",".join(f"{v:.5f}" for v in (s, w, n, e)))


_JUNCTION_CODE = re.compile(r"OSM-[JA]\d+")


def is_network_junction_code(code: str) -> bool:
    """OSM-J<node id> / OSM-A<place id> — not an official OSM-<name> place."""
    return bool(_JUNCTION_CODE.fullmatch(code))


def walkable_way(tags: dict) -> bool:
    hw = tags.get("highway")
    if not hw or hw in EXCLUDED_HIGHWAYS:
        return False
    if tags.get("foot") == "no":
        return False
    if tags.get("access") in ("private", "no") and tags.get("foot") not in FOOT_ALLOWED:
        return False
    return True


def cost_for(highway: str) -> float:
    if highway in FOOT_WAYS:
        return COST_FOOT_WAY
    if highway in BUSY_ROADS:
        return COST_BUSY_ROAD
    return COST_ROAD


Point = tuple[float, float]  # (lat, lon)


@dataclass
class Seg:
    a: str
    b: str
    pts: list[Point]
    highway: str
    name: str | None = None
    # Mapped bridge over a river or weir (the only way across).
    bridge: bool = False

    def length_m(self) -> float:
        return sum(
            haversine_m(p[0], p[1], q[0], q[1]) for p, q in zip(self.pts, self.pts[1:])
        )


@dataclass
class Network:
    junctions: dict[str, Point] = field(default_factory=dict)
    segs: list[Seg] = field(default_factory=list)
    # River / weir crossings: on a mapped bridge (kept) or not (left out).
    bridges: list[dict] = field(default_factory=list)
    blocked_crossings: list[dict] = field(default_factory=list)
    # Roads over small streams, canals and drains (culverts) — allowed, counted.
    minor_crossings: int = 0


def _is_bridged(tags: dict) -> bool:
    return tags.get("bridge", "no") != "no" or tags.get("tunnel", "no") != "no"


APPROVED_STATUSES = {"remotely_reviewed", "volunteer_verified", "officially_verified"}


def load_approved_crossings(path: str | None = None) -> dict[int, dict]:
    """Unbridged crossings a person checked and approved (config/approved_crossings.json)."""
    import os

    # In backend/config/ (part of the code and the Docker image), not data/.
    path = path or os.path.normpath(
        os.path.join(os.path.dirname(__file__), "..", "..", "config", "approved_crossings.json")
    )
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        items = json.load(f).get("crossings", [])
    return {int(c["way"]): c for c in items if c.get("status") in APPROVED_STATUSES and "way" in c}


def _barrier_segments(pts: list[Point], water: WaterIndex | None) -> tuple[list[bool], bool]:
    """
    For each segment of a way, whether it crosses a river/weir/dam; and whether
    the way crosses any smaller channel (stream, canal, drain). `pts` are (lat, lon).
    """
    if water is None or water.empty:
        return [False] * max(0, len(pts) - 1), False
    flags, minor = [], False
    for (alat, alon), (blat, blon) in zip(pts, pts[1:]):
        lines = water.crossed_lines((alon, alat), (blon, blat))
        flags.append(any(c.kind in BARRIER_WATERWAYS for c in lines))
        minor = minor or any(c.kind not in BARRIER_WATERWAYS for c in lines)
    return flags, minor


def _expanded(bbox, margin_m: float):
    s, w, n, e = bbox
    dlat = margin_m / 111320.0
    dlon = margin_m / (111320.0 * cos(radians((s + n) / 2)))
    return (s - dlat, w - dlon, n + dlat, e + dlon)


def build_network(
    elements,
    bbox=PILOT_BBOX,
    water: WaterIndex | None = None,
    approved: dict[int, dict] | None = None,
) -> Network:
    """
    Overpass `out body geom` ways → junctions and lanes between them. The part
    of a way that crosses a river or weir without a mapped bridge is left out
    (a ford entirely): the router must never send anyone through the Godavari.
    """
    s, w, n, e = _expanded(bbox, CLIP_MARGIN_M)
    net = Network()
    runs = []  # (node ids, points, tags)
    for el in elements:
        if el.get("type") != "way":
            continue
        tags = el.get("tags") or {}
        ids, geom = el.get("nodes") or [], el.get("geometry") or []
        if not walkable_way(tags) or len(ids) != len(geom) or len(ids) < 2:
            continue
        if any(g is None for g in geom):
            continue
        info = {"way": el.get("id"), "name": tags.get("name"), "highway": tags.get("highway")}
        if tags.get("ford", "no") != "no":
            net.blocked_crossings.append({**info, "reason": "ford"})
            continue
        crossing, minor = _barrier_segments([(g["lat"], g["lon"]) for g in geom], water)
        net.minor_crossings += int(minor)
        bridged = _is_bridged(tags)
        review = (approved or {}).get(el.get("id"))
        if any(crossing):
            if bridged or review:
                # A mapped bridge, or an unbridged crossing a person approved.
                net.bridges.append({**info, **({"approved": review["status"]} if review and not bridged else {})})
                tags = {**tags, "_bridge": True}
                bridged = True
            else:
                # Leave out only the part over the water: the rest of the way
                # (e.g. the walk along the bank) stays usable.
                net.blocked_crossings.append({**info, "reason": "crosses water without a mapped bridge"})
        cur_ids, cur_pts = [], []
        for i, (nid, g) in enumerate(zip(ids, geom)):
            inside = s <= g["lat"] <= n and w <= g["lon"] <= e
            # The segment arriving here crosses the river without a bridge: break.
            cut = i > 0 and crossing[i - 1] and not bridged
            if cut or not inside:
                if len(cur_ids) >= 2:
                    runs.append((cur_ids, cur_pts, tags))
                cur_ids, cur_pts = [], []
            if inside:
                cur_ids.append(nid)
                cur_pts.append((g["lat"], g["lon"]))
        if len(cur_ids) >= 2:
            runs.append((cur_ids, cur_pts, tags))

    # A node used by two ways (or twice by one) is a junction; so are run ends.
    usage = Counter(nid for ids, _, _ in runs for nid in ids)
    is_junction = {nid for nid, k in usage.items() if k >= 2}
    for ids, _, _ in runs:
        is_junction.update((ids[0], ids[-1]))

    best: dict[frozenset, Seg] = {}

    def add(ids: list[int], pts: list[Point], tags: dict):
        if ids[0] == ids[-1]:
            # A loop back to one junction: split it in the middle.
            if len(ids) < 3:
                return
            mid = len(ids) // 2
            add(ids[: mid + 1], pts[: mid + 1], tags)
            add(ids[mid:], pts[mid:], tags)
            return
        for nid, p in ((ids[0], pts[0]), (ids[-1], pts[-1])):
            net.junctions[f"OSM-J{nid}"] = p
        seg = Seg(
            a=f"OSM-J{ids[0]}",
            b=f"OSM-J{ids[-1]}",
            pts=pts,
            highway=tags.get("highway", "road"),
            name=(tags.get("name") or None),
            bridge=bool(tags.get("_bridge")),
        )
        key = frozenset((seg.a, seg.b))
        # Two ways between the same two junctions: keep the shorter.
        if key not in best or seg.length_m() < best[key].length_m():
            best[key] = seg

    for ids, pts, tags in runs:
        start = 0
        for i in range(1, len(ids)):
            if ids[i] in is_junction:
                add(ids[start : i + 1], pts[start : i + 1], tags)
                start = i
    net.segs = list(best.values())
    used = {c for sg in net.segs for c in (sg.a, sg.b)}
    net.junctions = {c: p for c, p in net.junctions.items() if c in used}
    return net


def _project(p: Point, a: Point, b: Point) -> tuple[float, float, Point]:
    """(distance m, fraction along a→b, nearest point) in a local metric frame."""
    kx = 111320.0 * cos(radians(p[0]))
    ky = 111320.0
    ax, ay = (a[1] - p[1]) * kx, (a[0] - p[0]) * ky
    bx, by = (b[1] - p[1]) * kx, (b[0] - p[0]) * ky
    dx, dy = bx - ax, by - ay
    seg2 = dx * dx + dy * dy
    t = 0.0 if seg2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / seg2))
    x, y = ax + t * dx, ay + t * dy
    return (x * x + y * y) ** 0.5, t, (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))


# A connector is a straight line from a place to its street: it must not cross
# water. Skip this much at the place's end (a ghat point may sit on the water's edge).
CONNECTOR_WET_SKIP_M = 10.0


@dataclass
class Attachment:
    place_code: str
    junction: str
    point: Point


def connector_crosses_water(water: WaterIndex | None, place: Point, q: Point) -> str | None:
    """Why a straight place→street connector is unsafe (None if fine). Points are (lat, lon)."""
    if water is None or water.empty:
        return None
    a, b = (place[1], place[0]), (q[1], q[0])
    lines = water.crossed_lines(a, b)
    if lines:
        return f"crosses {lines[0].kind} {lines[0].name or ''}".strip()
    area = water.wet_between(a, b, skip_ends_m=CONNECTOR_WET_SKIP_M)
    if area is not None:
        return f"goes through water {area.name or ''}".strip()
    return None


def attach_places(
    net: Network,
    places: list[tuple[str, int, float, float]],
    water: WaterIndex | None = None,
    rejected: list[dict] | None = None,
) -> list[Attachment]:
    """
    Join each place (code, id, lat, lon) to the nearest lane within
    ATTACH_MAX_M whose straight connector does not cross water — preferring
    the main road network over the nearest lane when that is a fragment OSM
    does not connect to anything (a ghat's own paths) — at a lane end, or at a
    new junction splitting the lane. Places that could only be joined across
    water are left unjoined (no route, said honestly) and listed in `rejected`.
    """
    parent: dict[str, str] = {}

    def root(c: str) -> str:
        parent.setdefault(c, c)
        while parent[c] != c:
            parent[c] = parent[parent[c]]
            c = parent[c]
        return c

    for sg in net.segs:
        parent[root(sg.a)] = root(sg.b)
    sizes = Counter(root(c) for c in net.junctions)
    main = sizes.most_common(1)[0][0] if sizes else None

    out = []
    pad = ATTACH_MAX_M / 111320.0 * 1.5
    for code, pid, lat, lon in sorted(places):
        p = (lat, lon)
        # The nearest point of every lane within reach: (dist, seg index, vertex index, t, point).
        candidates = []
        for si, sg in enumerate(net.segs):
            lats = [q[0] for q in sg.pts]
            lons = [q[1] for q in sg.pts]
            if not (min(lats) - pad <= lat <= max(lats) + pad and min(lons) - pad <= lon <= max(lons) + pad):
                continue
            best_here = None
            for vi in range(len(sg.pts) - 1):
                d, t, q = _project(p, sg.pts[vi], sg.pts[vi + 1])
                if best_here is None or d < best_here[0]:
                    best_here = (d, si, vi, t, q)
            if best_here is not None and best_here[0] <= ATTACH_MAX_M:
                candidates.append(best_here)
        candidates.sort(key=lambda c: c[0])

        def pick(cands):
            on_main = [c for c in cands if root(net.segs[c[1]].a) == main]
            return on_main[0] if on_main else (cands[0] if cands else None)

        reasons = {id(c): connector_crosses_water(water, p, c[4]) for c in candidates}
        best = pick([c for c in candidates if reasons[id(c)] is None])
        # Report only when water changed the choice (or left the place unjoined).
        unsafe_choice = pick(candidates)
        if unsafe_choice is not None and unsafe_choice is not best and rejected is not None:
            rejected.append(
                {"place": code, "reason": reasons[id(unsafe_choice)], "joined": best is not None}
            )
        if best is None:
            continue
        _, si, vi, t, q = best
        sg = net.segs[si]
        along = sum(
            haversine_m(a[0], a[1], b[0], b[1]) for a, b in zip(sg.pts[: vi + 1], sg.pts[1 : vi + 1])
        ) + haversine_m(sg.pts[vi][0], sg.pts[vi][1], q[0], q[1])
        total = sg.length_m()
        if along <= SNAP_TO_END_M:
            out.append(Attachment(code, sg.a, net.junctions[sg.a]))
            continue
        if total - along <= SNAP_TO_END_M:
            out.append(Attachment(code, sg.b, net.junctions[sg.b]))
            continue
        j = f"OSM-A{pid}"
        net.junctions[j] = q
        parent[j] = root(sg.a)
        first = Seg(sg.a, j, sg.pts[: vi + 1] + [q], sg.highway, sg.name, sg.bridge)
        second = Seg(j, sg.b, [q] + sg.pts[vi + 1 :], sg.highway, sg.name, sg.bridge)
        net.segs[si : si + 1] = [first, second]
        out.append(Attachment(code, j, q))
    return out


def _bearing(p: Point, q: Point) -> float:
    phi1, phi2 = radians(p[0]), radians(q[0])
    dlon = radians(q[1] - p[1])
    y = sin(dlon) * cos(phi2)
    x = cos(phi1) * sin(phi2) - sin(phi1) * cos(phi2) * cos(dlon)
    return (degrees(atan2(y, x)) + 360) % 360


def _end_heading(pts: list[Point]) -> float:
    walked = 0.0
    for i in range(1, len(pts)):
        walked += haversine_m(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])
        if walked >= HEADING_LOOKAHEAD_M:
            return _bearing(pts[0], pts[i])
    return _bearing(pts[0], pts[-1])


def edge_specs(net: Network, attachments: list[Attachment], places: dict[str, Point]) -> list[dict]:
    specs = []
    for sg in net.segs:
        kind = "bridge" if sg.bridge else "corridor"
        specs.append(_spec(sg.a, sg.b, sg.pts, sg.highway, sg.name, cost_for(sg.highway), kind))
    for at in attachments:
        pts = [places[at.place_code], at.point]
        specs.append(_spec(at.place_code, at.junction, pts, "connector", None, COST_CONNECTOR, "connector"))
    return specs


def _spec(a, b, pts, highway, name, cost, kind) -> dict:
    length = sum(haversine_m(p[0], p[1], q[0], q[1]) for p, q in zip(pts, pts[1:]))
    return {
        "from_code": a,
        "to_code": b,
        "distance_m": round(max(1.0, length), 1),
        "surface": "steps" if highway == "steps" else "paved",
        "bidirectional": True,
        "heading_ab": round(_end_heading(pts), 1),
        "heading_ba": round(_end_heading(pts[::-1]), 1),
        "passage_kind": kind,
        "cost_mult": cost,
        "verified": False,
        "source": "osm",
        "name": name[:128] if name else None,
        "path_json": json.dumps(
            [{"lat": round(p[0], 6), "lon": round(p[1], 6)} for p in pts], separators=(",", ":")
        ),
    }


def _volunteer_edited(e: Edge) -> bool:
    """Something a person set on this lane (kept when OSM changes)."""
    return bool(
        e.blocked
        or e.obstacle_note
        or not e.walkable
        or (e.door_state or "none") != "none"
        or (e.verification or OSM_IMPORTED) in REVIEWED
    )


@dataclass
class NetworkReport:
    junctions: int = 0
    lanes: int = 0
    connectors: int = 0
    places_not_joined: list[str] = field(default_factory=list)
    inserted: int = 0
    updated: int = 0
    removed: int = 0
    kept_edited: int = 0
    pack_bytes: int = 0
    # River safety (see docs/ROUTING_GRAPH_VALIDATION.md).
    water_checked: bool = False
    bridges: list[dict] = field(default_factory=list)
    blocked_crossings: list[dict] = field(default_factory=list)
    minor_crossings: int = 0
    connectors_rejected: list[dict] = field(default_factory=list)

    def summary(self) -> str:
        only_wet = [r["place"] for r in self.connectors_rejected if not r["joined"]]
        water = (
            f"river checks: {len(self.bridges)} bridged crossings kept, "
            f"{len(self.blocked_crossings)} unbridged crossings left out, "
            f"{len(self.connectors_rejected)} place links re-chosen to avoid water "
            f"({len(only_wet)} places only reachable across water, not joined)"
            if self.water_checked
            else "river checks: SKIPPED (no water data)"
        )
        return (
            f"{self.lanes} map lanes, {self.junctions} junctions, {self.connectors} places joined "
            f"({len(self.places_not_joined)} not joined); lanes inserted {self.inserted}, "
            f"updated {self.updated}, removed {self.removed}, kept (volunteer-edited) {self.kept_edited}; "
            f"pack ≈ {self.pack_bytes / 1e6:.2f} MB\n{water}"
        )


class PackTooBig(Exception):
    pass


class MissingWaterData(Exception):
    pass


def import_network(
    db: Session,
    elements,
    *,
    water: WaterIndex | None = None,
    bbox=PILOT_BBOX,
    force: bool = False,
    allow_without_water: bool = False,
) -> NetworkReport:
    """
    Rebuild OSM lanes from Overpass ways. Does not commit (dry runs roll back).
    Without water data the river safety checks cannot run, so this refuses
    unless `allow_without_water` (tests, or a deliberate override).
    """
    if (water is None or water.empty) and not allow_without_water:
        raise MissingWaterData(
            "No river/water data: cannot check for routes through the Godavari. "
            "Run `import_osm.py water` first (or --no-water-check to override)."
        )
    report = NetworkReport()
    net = build_network(elements, bbox, water, load_approved_crossings())
    report.water_checked = water is not None and not water.empty
    report.bridges = net.bridges
    report.blocked_crossings = net.blocked_crossings
    report.minor_crossings = net.minor_crossings
    rows = db.query(QrNode).all()
    places = [
        (n.code, n.id, n.lat, n.lon) for n in rows if not is_network_junction_code(n.code)
    ]
    attachments = attach_places(net, places, water, report.connectors_rejected)
    joined = {a.place_code for a in attachments}
    report.places_not_joined = sorted(c for c, *_ in places if c not in joined)
    report.junctions = len(net.junctions)
    report.lanes = len(net.segs)
    report.connectors = len(attachments)
    specs = edge_specs(net, attachments, {c: (lat, lon) for c, _, lat, lon in places})

    # Junction places first (lanes reference them).
    by_code = {n.code: n for n in rows}
    for code, (lat, lon) in net.junctions.items():
        row = by_code.get(code)
        if row is None:
            db.add(QrNode(code=code, name="", lat=lat, lon=lon, node_type="junction", verification=OSM_IMPORTED))
        elif (row.lat, row.lon) != (lat, lon):
            row.lat, row.lon = lat, lon
    db.flush()

    existing = {frozenset((e.from_code, e.to_code)): e for e in db.query(Edge).filter(Edge.source == "osm")}
    wanted = set()
    for spec in specs:
        key = frozenset((spec["from_code"], spec["to_code"]))
        wanted.add(key)
        row = existing.get(key)
        if row is None:
            db.add(Edge(**spec, verification=OSM_IMPORTED))
            report.inserted += 1
            continue
        # Keep what people set (blocked, obstacle, walkable, door, trust level).
        changed = False
        for k, v in spec.items():
            if getattr(row, k) != v:
                setattr(row, k, v)
                changed = True
        report.updated += int(changed)
    for key, row in existing.items():
        if key in wanted:
            continue
        if _volunteer_edited(row):
            report.kept_edited += 1
            continue
        db.delete(row)
        report.removed += 1
    db.flush()

    # Junctions no lane uses any more.
    used = {c for e in db.query(Edge).all() for c in (e.from_code, e.to_code)}
    for row in db.query(QrNode).all():
        if is_network_junction_code(row.code) and row.code not in used:
            db.delete(row)
    db.flush()

    nodes, edges = _collect(db)
    report.pack_bytes = len(json.dumps({"nodes": nodes, "edges": edges}, separators=(",", ":")))
    if report.pack_bytes > MAX_PACK_BYTES and not force:
        raise PackTooBig(
            f"Pack would be {report.pack_bytes / 1e6:.2f} MB (limit {MAX_PACK_BYTES / 1e6:.0f} MB). "
            "Use a smaller area, or --force."
        )
    return report
