"""
Import permanent places (ghats, temples, hospitals, toilets, bus stands,
parking) from OpenStreetMap into the place table.

Imported places are codes OSM-N<id> / OSM-W<id> / OSM-R<id> and stay
"unconfirmed" (gps_accuracy_m is null) until a volunteer stands there and
registers them — after that a re-import never touches them.
"""
import os
import re
from dataclasses import dataclass, field
from typing import Iterable

from sqlalchemy.orm import Session

from ..db import Edge, QrNode
from ..verification import OSM_IMPORTED, REJECTED, REVIEWED
from .pack_builder import haversine_m

# Whole offline-map area (lib/mapArea.ts KUMBH_BOUNDS) as south, west, north, east.
KUMBH_BBOX = (19.85, 73.4, 20.1, 73.95)
# Ramkund–Panchavati pilot zone: every mapped category is imported here.
PILOT_BBOX = (19.995, 73.780, 20.020, 73.815)

# Same type within this distance of a volunteer place = the same place.
DEDUPE_NODE_M = 30.0
# Ways/relations are imported at their centre, which can sit off the entrance.
DEDUPE_AREA_M = 60.0
# Same type and name within this distance = one place mapped twice in OSM.
MERGE_SAME_NAME_M = 100.0
# Official positions were copied from OSM features (officialPlaces.ts), so a
# feature this close to one is that place: it takes the official name…
OFFICIAL_MATCH_M = 15.0
# …as does a feature of the same type a little farther (an area's centre).
OFFICIAL_MATCH_SAME_TYPE_M = 60.0

TYPE_LABEL = {
    "medical": "Hospital",
    "toilet": "Toilet",
    "water": "Drinking water",
    "temple": "Temple",
    "transport": "Bus stand",
    "parking": "Parking",
    "help": "Police",
    "landmark": "Landmark",
    "ghat": "Ghat",
}
# Unnamed features worth listing anyway (a visitor looks for "a toilet").
KEEP_UNNAMED = {"toilet", "water", "parking"}

_DEVANAGARI = re.compile(r"[\u0900-\u097F]")
_LATIN = re.compile(r"[A-Za-z]")

OVERPASS_PLACES_QUERY = """
[out:json][timeout:120];
(
  nwr["amenity"~"^(hospital|clinic|doctors|toilets|bus_station|parking|police|drinking_water|place_of_worship)$"]({bbox});
  nwr["tourism"="attraction"]({bbox});
  nwr["leisure"="bathing_place"]({bbox});
  nwr["man_made"="ghat"]({bbox});
  nwr["railway"="station"]({bbox});
);
out center tags;
""".strip()


def overpass_places_query(bbox=KUMBH_BBOX) -> str:
    return OVERPASS_PLACES_QUERY.replace("{bbox}", ",".join(str(v) for v in bbox))


def node_type_for(tags: dict) -> str | None:
    amenity = tags.get("amenity")
    if amenity in ("hospital", "clinic", "doctors"):
        return "medical"
    if amenity == "toilets":
        return "toilet"
    if amenity == "drinking_water":
        return "water"
    if amenity == "place_of_worship":
        return "temple"
    if amenity == "bus_station" or tags.get("railway") == "station":
        return "transport"
    if amenity == "parking":
        return "parking"
    if amenity == "police":
        return "help"
    if tags.get("leisure") == "bathing_place" or tags.get("man_made") == "ghat":
        return "ghat"
    if tags.get("tourism") == "attraction":
        return "landmark"
    return None


def _in_bbox(lat: float, lon: float, bbox) -> bool:
    s, w, n, e = bbox
    return s <= lat <= n and w <= lon <= e


def _city_wide(node_type: str, tags: dict) -> bool:
    """Outside the pilot zone only places every visitor may need."""
    if node_type in ("transport", "help"):
        return True
    # Most OSM "hospitals" here are small private clinics: keep real hospitals.
    return node_type == "medical" and (
        tags.get("healthcare") == "hospital" or tags.get("emergency") == "yes"
    )


@dataclass
class OsmPlace:
    code: str
    name: str
    local_name: str | None
    lat: float
    lon: float
    node_type: str
    is_area: bool
    osm_ref: str


@dataclass
class OfficialPoint:
    name: str
    local_name: str
    node_type: str
    lat: float
    lon: float


def load_official_points(path: str | None = None) -> list[OfficialPoint]:
    """
    The OSM-matched official places from the frontend's officialPlaces.ts, so
    a matching feature keeps the official name (it links the how-to-get-there
    text there). Approximate points are never matched.
    """
    path = path or os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "frontend", "src", "lib", "officialPlaces.ts"
    )
    if not os.path.exists(path):
        return []
    text = open(path, encoding="utf-8").read()
    out = []
    for block in re.findall(r"\{\s*id: \"[^\"]+\",(.*?)\n  \}", text, re.S):
        get = lambda k: re.search(rf"\b{k}: \"([^\"]*)\"", block)  # noqa: E731
        num = lambda k: re.search(rf"\b{k}: (-?[0-9.]+)", block)  # noqa: E731
        if not (get("name") and num("lat") and num("lon") and get("coordQuality")):
            continue
        if get("coordQuality").group(1) != "osm":
            continue
        out.append(
            OfficialPoint(
                name=get("name").group(1),
                local_name=get("local_name").group(1) if get("local_name") else "",
                node_type=get("node_type").group(1) if get("node_type") else "landmark",
                lat=float(num("lat").group(1)),
                lon=float(num("lon").group(1)),
            )
        )
    return out


def _match_official(usable, official) -> dict:
    """
    One feature per official place: the nearest of the same type within 60 m,
    else the nearest of any type within 15 m. Every other feature nearby keeps
    its own name (a shrine next to Ramkund is not Ramkund).
    """
    out = {}
    for op in official:
        best = None
        for same_type, radius in ((True, OFFICIAL_MATCH_SAME_TYPE_M), (False, OFFICIAL_MATCH_M)):
            near = [
                (haversine_m(lat, lon, op.lat, op.lon), el)
                for el, node_type, lat, lon in usable
                if (node_type == op.node_type) == same_type and id(el) not in out
            ]
            near = [(d, el) for d, el in near if d <= radius]
            if near:
                best = min(near, key=lambda x: x[0])[1]
                break
        if best is not None:
            out[id(best)] = op
    return out


def parse_places(
    elements: Iterable[dict],
    *,
    pilot_bbox=PILOT_BBOX,
    official: list[OfficialPoint] = (),
) -> list[OsmPlace]:
    """Overpass `out center tags` elements → places to import (merged, scoped)."""
    usable = []
    for el in sorted(elements, key=lambda e: (e.get("type", ""), e.get("id", 0))):
        node_type = node_type_for(el.get("tags") or {})
        lat = el.get("lat", (el.get("center") or {}).get("lat"))
        lon = el.get("lon", (el.get("center") or {}).get("lon"))
        if node_type is not None and lat is not None and lon is not None:
            usable.append((el, node_type, float(lat), float(lon)))
    official_for = _match_official(usable, official)

    places: list[OsmPlace] = []
    for el, node_type, lat, lon in usable:
        tags = el.get("tags") or {}
        match = official_for.get(id(el))
        if match is None and not _in_bbox(lat, lon, pilot_bbox) and not _city_wide(node_type, tags):
            continue

        label = "Railway station" if tags.get("railway") == "station" else TYPE_LABEL[node_type]
        name = (tags.get("name") or "").strip()
        local = (tags.get("name:mr") or tags.get("name:hi") or "").strip() or None
        # OSM's main name is sometimes Marathi (or another script): keep a
        # Devanagari one as the local name, and show the English name.
        if name and not _LATIN.search(name):
            if _DEVANAGARI.search(name):
                local = local or name
            name = (tags.get("name:en") or "").strip()
            if not name and local:
                name = label
        if not name:
            if node_type not in KEEP_UNNAMED and match is None:
                continue
            name = label

        if match is not None:
            name, node_type = match.name, match.node_type
            local = local or match.local_name or None

        kind = {"node": "N", "way": "W", "relation": "R"}.get(el.get("type"), "N")
        place = OsmPlace(
            code=f"OSM-{kind}{el['id']}",
            name=name[:128],
            local_name=local[:128] if local else None,
            lat=float(lat),
            lon=float(lon),
            node_type=node_type,
            is_area=kind != "N",
            osm_ref=f"{el.get('type', 'node')} {el['id']}",
        )
        twin = next(
            (
                p
                for p in places
                if p.node_type == place.node_type
                and p.name.lower() == place.name.lower()
                # Two unnamed "Toilet"s near each other are two toilets.
                and place.name not in (TYPE_LABEL.get(place.node_type), "Railway station")
                and haversine_m(p.lat, p.lon, place.lat, place.lon) <= MERGE_SAME_NAME_M
            ),
            None,
        )
        if twin is None:
            places.append(place)
    return places


@dataclass
class ImportReport:
    inserted: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    unchanged: int = 0
    confirmed_kept: list[str] = field(default_factory=list)
    skipped_near_volunteer: list[str] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)
    pruned: list[str] = field(default_factory=list)

    def summary(self) -> str:
        return (
            f"inserted {len(self.inserted)}, updated {len(self.updated)}, "
            f"unchanged {self.unchanged}, volunteer-confirmed kept {len(self.confirmed_kept)}, "
            f"skipped (volunteer place nearby) {len(self.skipped_near_volunteer)}, "
            f"gone from OSM {len(self.missing)}, pruned {len(self.pruned)}"
        )


def is_osm_place_code(code: str) -> bool:
    return bool(re.fullmatch(r"OSM-[NWR]\d+", code))


def import_places(db: Session, places: list[OsmPlace], *, prune: bool = False) -> ImportReport:
    """Upsert places by code. Does not commit — the caller decides (dry run)."""
    report = ImportReport()
    all_nodes = db.query(QrNode).all()
    by_code = {n.code: n for n in all_nodes}
    volunteer = [n for n in all_nodes if not is_osm_place_code(n.code)]
    seen = set()

    for p in places:
        seen.add(p.code)
        row = by_code.get(p.code)
        # Confirmed on site, reviewed or rejected by a person: never changed back.
        if row is not None and (row.gps_accuracy_m is not None or row.verification in REVIEWED):
            report.confirmed_kept.append(p.code)
            continue
        if row is None:
            radius = DEDUPE_AREA_M if p.is_area else DEDUPE_NODE_M
            if any(
                v.node_type == p.node_type
                and haversine_m(v.lat, v.lon, p.lat, p.lon) <= radius
                for v in volunteer
            ):
                report.skipped_near_volunteer.append(p.code)
                continue
            db.add(
                QrNode(
                    code=p.code,
                    name=p.name,
                    local_name=p.local_name,
                    lat=p.lat,
                    lon=p.lon,
                    node_type=p.node_type,
                    icon=p.node_type,
                    description=f"From OpenStreetMap ({p.osm_ref}) — not yet confirmed on site.",
                    verification=OSM_IMPORTED,
                )
            )
            report.inserted.append(p.code)
            continue
        new = {
            "name": p.name,
            "local_name": p.local_name or row.local_name,
            "lat": p.lat,
            "lon": p.lon,
            "node_type": p.node_type,
            "icon": p.node_type,
        }
        if all(getattr(row, k) == v for k, v in new.items()):
            report.unchanged += 1
            continue
        for k, v in new.items():
            setattr(row, k, v)
        report.updated.append(p.code)

    for code, row in by_code.items():
        if not is_osm_place_code(code) or code in seen:
            continue
        report.missing.append(code)
        if not prune or row.gps_accuracy_m is not None or row.verification in REVIEWED:
            continue
        lanes = (
            db.query(Edge)
            .filter((Edge.from_code == code) | (Edge.to_code == code))
            .all()
        )
        # Its own map connector (osm_network) goes with it; any other lane keeps it.
        if all(e.passage_kind == "connector" and e.source == "osm" for e in lanes):
            for e in lanes:
                db.delete(e)
            db.delete(row)
            report.pruned.append(code)
    db.flush()
    return report


def osm_confirm_radius_m(code: str) -> float:
    """How far a volunteer may stand from an OSM place to confirm it."""
    return DEDUPE_NODE_M if code.startswith("OSM-N") else DEDUPE_AREA_M


def confirmable_osm_place(
    db: Session, code: str, *, lat: float, lon: float, node_type: str
) -> tuple[QrNode | None, str | None]:
    """The OSM place a volunteer chose to confirm, or why it can't be."""
    code = code.strip().upper()
    if not is_osm_place_code(code):
        return None, "Only places imported from OpenStreetMap can be confirmed"
    row = db.query(QrNode).filter(QrNode.code == code).first()
    if row is None:
        return None, f"Unknown map place: {code}"
    if row.gps_accuracy_m is not None:
        return None, f"{row.name} is already confirmed by a volunteer"
    if row.verification == REJECTED:
        return None, f"{row.name} was rejected by an admin — register a new place instead"
    if row.node_type != node_type:
        return None, f"{row.name} is a different kind of place"
    if haversine_m(lat, lon, row.lat, row.lon) > osm_confirm_radius_m(code):
        return None, f"You are too far from {row.name} to confirm it — walk to it first"
    return row, None
