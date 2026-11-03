"""
Last line of defence against routes through water, for lanes that did not
come through the OSM import checks (osm_network.py): a lane whose drawn line
crosses a river or weir must be a bridge from the OSM import (mapped, or in
config/approved_crossings.json), or approved by an admin. A walk a volunteer
recorded across the water is kept out of the pack until an admin has looked
at it (a GPS gap on a bridge draws a straight jump over the river).

Uses the newest saved water data (data/osm/water-*.json, from
`scripts/import_osm.py water`). Without it, nothing is filtered — and the
validation report says so.
"""
import json
import os

from ..config import settings
from ..verification import OFFICIALLY_VERIFIED, REMOTELY_REVIEWED
from .water import BARRIER_WATERWAYS, WaterIndex, parse_water

# Trust levels only an admin can set (/api/admin/verify): a person decided.
ADMIN_APPROVED = {REMOTELY_REVIEWED, OFFICIALLY_VERIFIED}
# Lanes added by people are also checked against water areas (riverbanks),
# except the first and last metres: ghats and bank places sit at the edge.
WET_SKIP_M = 10.0

_cache: dict = {"path": None, "mtime": None, "index": None}


def water_dir() -> str:
    """Where scripts/import_osm.py saves OSM answers (OSM_DIR, else backend/data/osm)."""
    return settings.osm_dir or os.path.normpath(
        os.path.join(os.path.dirname(__file__), "..", "..", "data", "osm")
    )


def load_water_index(directory: str | None = None) -> WaterIndex | None:
    """The newest saved water data, parsed once per file change."""
    directory = directory or water_dir()
    if not os.path.isdir(directory):
        return None
    names = sorted(n for n in os.listdir(directory) if n.startswith("water-") and n.endswith(".json"))
    if not names:
        return None
    path = os.path.join(directory, names[-1])
    mtime = os.path.getmtime(path)
    if _cache["path"] != path or _cache["mtime"] != mtime:
        with open(path, encoding="utf-8") as f:
            _cache.update(path=path, mtime=mtime, index=parse_water(json.load(f).get("elements", [])))
    return _cache["index"]


def lane_points(edge: dict, nodes: dict) -> list[tuple[float, float]]:
    """
    The lane as drawn and routed in the app (mapData.ts): from place, its
    recorded/mapped path, to place — the end stretches count too. (lon, lat)
    """
    pts = []
    raw = edge.get("path_json")
    if raw:
        try:
            pts = [
                (float(p["lon"]), float(p["lat"]))
                for p in json.loads(raw)
                if isinstance(p, dict) and "lat" in p and "lon" in p
            ]
        except (ValueError, TypeError):
            pts = []
    a, b = nodes.get(edge["from_code"]), nodes.get(edge["to_code"])
    ends_a = [(a["lon"], a["lat"])] if a is not None else []
    ends_b = [(b["lon"], b["lat"])] if b is not None else []
    if len(pts) < 2:
        if a is None or b is None:
            return []
        return ends_a + ends_b
    return ends_a + pts + ends_b


def wet_area(pts: list[tuple[float, float]], water: WaterIndex) -> str | None:
    """A water area the drawn lane goes through (sampled every ~2 m, lane ends skipped)."""
    if not water.areas or len(pts) < 2:
        return None
    from .pack_builder import haversine_m

    lengths = [haversine_m(a[1], a[0], b[1], b[0]) for a, b in zip(pts, pts[1:])]
    total = sum(lengths)
    if total <= 2 * WET_SKIP_M:
        return None
    along = 0.0
    for (a, b), length in zip(zip(pts, pts[1:]), lengths):
        n = max(1, int(length / 2.0))
        for i in range(n + 1):
            d = along + length * i / n
            if WET_SKIP_M <= d <= total - WET_SKIP_M:
                f = i / n
                hit = water.area_at((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
                if hit is not None:
                    return f"water {hit.name or ''}".strip()
        along += length
    return None


def river_crossings(edge: dict, nodes: dict, water: WaterIndex) -> list[str]:
    """Names of rivers / weirs the drawn lane crosses."""
    pts = lane_points(edge, nodes)
    out = []
    for a, b in zip(pts, pts[1:]):
        for line in water.crossed_lines(a, b):
            if line.kind in BARRIER_WATERWAYS:
                out.append(f"{line.kind} {line.name or ''}".strip())
    # OSM lanes were checked against water areas by the import (connectors);
    # lanes people added (straight links, walks) are checked here.
    if edge.get("source", "volunteer") != "osm":
        wet = wet_area(pts, water)
        if wet:
            out.append(wet)
    return sorted(set(out))


def crossing_problem(edge: dict, nodes: dict, water: WaterIndex | None) -> str | None:
    """
    "error" — the lane crosses a river/weir (or, for lanes people added, goes
    through water) and nothing approved it; "warning" — a recorded volunteer
    walk does (an admin must check it was on a bridge); None — fine.
    Both "error" and "warning" lanes are left out of the pack.

    Approved means: a bridge from the OSM import (a mapped bridge, or a way in
    config/approved_crossings.json), or a recorded volunteer walk that an admin
    then approved (a trust level only an admin can set; a new walk that crosses
    water takes it back, volunteer.py). A "bridge" label on a lane people added
    is not enough, and a straight line nobody walked is never approved.
    """
    if water is None or water.empty:
        return None
    if not river_crossings(edge, nodes, water):
        return None
    if edge.get("source") == "osm" and edge.get("passage_kind") == "bridge":
        return None
    walk = edge.get("source", "volunteer") != "osm" and edge.get("verified") and edge.get("path_json")
    if walk and edge.get("verification") in ADMIN_APPROVED:
        return None
    if walk:
        return "warning"
    return "error"
