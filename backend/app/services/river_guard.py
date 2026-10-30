"""
Last line of defence against routes through water, for lanes that did not
come through the OSM import checks (osm_network.py): a lane whose drawn line
crosses a river or weir must be a mapped bridge, or a walk a volunteer
actually recorded (they crossed on whatever bridge is there).

Uses the newest saved water data (data/osm/water-*.json, from
`scripts/import_osm.py water`). Without it, nothing is filtered — and the
validation report says so.
"""
import json
import os

from ..config import settings
from .water import BARRIER_WATERWAYS, WaterIndex, parse_water

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
    """The lane as drawn in the app: its recorded/mapped path, else a straight line. (lon, lat)."""
    pts = []
    raw = edge.get("path_json")
    if raw:
        try:
            pts = [(p["lon"], p["lat"]) for p in json.loads(raw) if "lat" in p and "lon" in p]
        except (ValueError, TypeError):
            pts = []
    if len(pts) < 2:
        a, b = nodes.get(edge["from_code"]), nodes.get(edge["to_code"])
        if a is None or b is None:
            return []
        pts = [(a["lon"], a["lat"]), (b["lon"], b["lat"])]
    return pts


def river_crossings(edge: dict, nodes: dict, water: WaterIndex) -> list[str]:
    """Names of rivers / weirs the drawn lane crosses."""
    pts = lane_points(edge, nodes)
    out = []
    for a, b in zip(pts, pts[1:]):
        for line in water.crossed_lines(a, b):
            if line.kind in BARRIER_WATERWAYS:
                out.append(f"{line.kind} {line.name or ''}".strip())
    return sorted(set(out))


def crossing_problem(edge: dict, nodes: dict, water: WaterIndex | None) -> str | None:
    """
    "error" — the lane crosses a river/weir and nothing says it is a bridge or
    a real walk (left out of routing); "warning" — a recorded volunteer walk
    crosses one (it should be on a bridge: worth a look); None — fine.
    """
    if water is None or water.empty:
        return None
    if not river_crossings(edge, nodes, water):
        return None
    if edge.get("passage_kind") == "bridge":
        return None
    if edge.get("source", "volunteer") != "osm" and edge.get("verified") and edge.get("path_json"):
        return "warning"
    return "error"
