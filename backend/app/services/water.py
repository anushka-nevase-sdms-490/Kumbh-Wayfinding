"""
Rivers, canals, weirs and water areas from OpenStreetMap, for the routing
safety checks (osm_network.py): nobody may be routed through the Godavari
because two streets on opposite banks happen to be close.

Plain geometry in degrees (lon, lat) — the pilot zone is small, so straight
lines in degrees are close enough for "does this segment cross that one".
"""
from dataclasses import dataclass, field

Point = tuple[float, float]  # (lon, lat)

# Crossing these needs a mapped bridge (or tunnel); people cannot walk through.
BARRIER_WATERWAYS = {"river", "weir", "dam"}
# Small channels: roads cross them on culverts all the time.
MINOR_WATERWAYS = {"stream", "canal", "drain", "ditch"}

OVERPASS_WATER_QUERY = """
[out:json][timeout:180];
(
  way["natural"="water"]({bbox});
  relation["natural"="water"]({bbox});
  way["waterway"~"^(river|riverbank|canal|stream|drain|ditch|weir|dam)$"]({bbox});
  relation["waterway"="riverbank"]({bbox});
);
out geom;
""".strip()

_CELL = 0.002  # grid cell (degrees, ~200 m) for the segment index


def _orient(a: Point, b: Point, c: Point) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def segments_cross(p1: Point, p2: Point, q1: Point, q2: Point) -> bool:
    """True if segment p1-p2 properly crosses q1-q2."""
    d1, d2 = _orient(q1, q2, p1), _orient(q1, q2, p2)
    d3, d4 = _orient(p1, p2, q1), _orient(p1, p2, q2)
    return (d1 > 0) != (d2 > 0) and (d3 > 0) != (d4 > 0)


def point_in_ring(pt: Point, ring: list[Point]) -> bool:
    x, y = pt
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


@dataclass
class WaterLine:
    kind: str  # river | weir | canal | stream | …
    name: str | None
    segs: list[tuple[Point, Point]]


@dataclass
class WaterArea:
    name: str | None
    outer: list[Point]
    holes: list[list[Point]] = field(default_factory=list)
    bbox: tuple[float, float, float, float] = (0, 0, 0, 0)

    def contains(self, pt: Point) -> bool:
        x, y = pt
        w, s, e, n = self.bbox
        if not (w <= x <= e and s <= y <= n):
            return False
        return point_in_ring(pt, self.outer) and not any(point_in_ring(pt, h) for h in self.holes)


class WaterIndex:
    """Water lines (grid-indexed) and water areas of one region."""

    def __init__(self, lines: list[WaterLine], areas: list[WaterArea]):
        self.lines = lines
        self.areas = areas
        self._grid: dict[tuple[int, int], list[tuple[int, int]]] = {}
        for li, line in enumerate(lines):
            for si, (a, b) in enumerate(line.segs):
                for cell in self._cells(a, b):
                    self._grid.setdefault(cell, []).append((li, si))

    @staticmethod
    def _cells(a: Point, b: Point):
        x0, x1 = sorted((int(a[0] // _CELL), int(b[0] // _CELL)))
        y0, y1 = sorted((int(a[1] // _CELL), int(b[1] // _CELL)))
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                yield (x, y)

    @property
    def empty(self) -> bool:
        return not self.lines and not self.areas

    def crossed_lines(self, a: Point, b: Point) -> list[WaterLine]:
        """Water lines the segment a-b crosses."""
        seen, out = set(), []
        for cell in self._cells(a, b):
            for li, si in self._grid.get(cell, ()):
                if li in seen:
                    continue
                q1, q2 = self.lines[li].segs[si]
                if segments_cross(a, b, q1, q2):
                    seen.add(li)
                    out.append(self.lines[li])
        return out

    def area_at(self, pt: Point) -> WaterArea | None:
        return next((a for a in self.areas if a.contains(pt)), None)

    def wet_between(self, a: Point, b: Point, skip_ends_m: float = 0.0, step_m: float = 2.0) -> WaterArea | None:
        """A water area the segment passes through (samples every ~2 m, ends skipped)."""
        if not self.areas:
            return None
        from .pack_builder import haversine_m

        length = haversine_m(a[1], a[0], b[1], b[0])
        if length <= 2 * skip_ends_m:
            return None
        n = max(2, int(length / step_m))
        for i in range(1, n):
            along = length * i / n
            if along < skip_ends_m or along > length - skip_ends_m:
                continue
            f = i / n
            hit = self.area_at((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
            if hit is not None:
                return hit
        return None


def _bbox(ring: list[Point]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return (min(xs), min(ys), max(xs), max(ys))


def _ring(geom) -> list[Point]:
    return [(g["lon"], g["lat"]) for g in geom or [] if g]


def parse_water(elements) -> WaterIndex:
    """Overpass `out geom` water features → WaterIndex."""
    lines: list[WaterLine] = []
    areas: list[WaterArea] = []
    for el in elements:
        tags = el.get("tags") or {}
        if el.get("type") == "way":
            pts = _ring(el.get("geometry"))
            if len(pts) < 2:
                continue
            ww = tags.get("waterway")
            closed = len(pts) >= 4 and pts[0] == pts[-1]
            if ww in BARRIER_WATERWAYS | MINOR_WATERWAYS:
                lines.append(WaterLine(ww, tags.get("name"), list(zip(pts, pts[1:]))))
            if closed and (tags.get("natural") == "water" or ww == "riverbank"):
                areas.append(WaterArea(tags.get("name"), pts[:-1], [], _bbox(pts)))
        elif el.get("type") == "relation":
            outers, inners = [], []
            for m in el.get("members", []):
                ring = _ring(m.get("geometry"))
                if len(ring) >= 3:
                    (inners if m.get("role") == "inner" else outers).append(ring)
            # Multipolygon members are often split in pieces; join pieces end to end.
            for ring in _join_rings(outers):
                holes = [h for h in _join_rings(inners) if point_in_ring(h[0], ring)]
                areas.append(WaterArea(tags.get("name"), ring, holes, _bbox(ring)))
    return WaterIndex(lines, areas)


def _join_rings(parts: list[list[Point]]) -> list[list[Point]]:
    """Join open way pieces sharing end points into closed rings."""
    pieces = [list(p) for p in parts]
    rings = []
    while pieces:
        cur = pieces.pop(0)
        changed = True
        while cur[0] != cur[-1] and changed:
            changed = False
            for i, p in enumerate(pieces):
                if p[0] == cur[-1]:
                    cur += p[1:]
                elif p[-1] == cur[-1]:
                    cur += p[::-1][1:]
                elif p[-1] == cur[0]:
                    cur = p[:-1] + cur
                elif p[0] == cur[0]:
                    cur = p[::-1][:-1] + cur
                else:
                    continue
                pieces.pop(i)
                changed = True
                break
        if len(cur) >= 4:
            rings.append(cur[:-1] if cur[0] == cur[-1] else cur)
    return rings
