# Nashik geographic data pipeline

How the Nashik pilot data is obtained remotely, checked, built into a routing
graph and sent to phones, and how far each piece can be trusted. Everything
runs from anywhere (no site visit needed). **Remote data is never presented as
field-verified.**

## Sources

| Data | Source | How |
|---|---|---|
| Places (ghats, temples, hospitals, toilets, water, parking, bus/rail, police) | OpenStreetMap via Overpass | `import_osm.py places` |
| Streets and footpaths (pilot zone) | OpenStreetMap via Overpass | `import_osm.py network` |
| Rivers, weirs, canals, water areas | OpenStreetMap via Overpass | `import_osm.py water` |
| Official place names, zones, how-to-get-there text | kumbhguidenashik.in (names only — its coordinates are 0.7–2 km off) | `frontend/src/lib/officialPlaces.ts` |
| Offline basemap tiles | Protomaps OpenStreetMap build 20261029 | `npm run map:fetch` |
| On-site positions and walked lanes | Volunteers (phone GPS) | volunteer app |

Geofabrik extracts and QGIS were considered. Overpass answers for the pilot
area are small (about 1 MB), so a full Geofabrik extract is not needed now.
QGIS is useful for a person reviewing data visually (load the saved JSON), but
it is not part of the automated pipeline.

**Licence:** OpenStreetMap data is ODbL. The map shows "© OpenStreetMap
contributors · Protomaps", and every pack carries `"attribution": "Map data ©
OpenStreetMap contributors (ODbL); …"`.

## Coordinates

WGS84 everywhere:
- the database, the pack and the API use `lat` / `lon` in degrees;
- MapLibre and GeoJSON use `[lon, lat]` (converted only in `lib/mapData.ts` / `OfflineMap.tsx`);
- distances use haversine (metres);
- small local checks (projection onto a lane, river crossings) use a flat frame around the point.

There are no other coordinate systems, so no reprojection is needed.

## Steps

```bash
cd backend
.venv/bin/python scripts/import_osm.py all        # 1-11, the first time (start.sh does this)
.venv/bin/python scripts/validate_graph.py        # checks; must end with OK
```

| # | Step | Where |
|---|---|---|
| 1 | Download the area (one Overpass query per kind, with retries; the answer is saved as `data/osm/<kind>-<date>.json`, and later runs can replay it offline with `--saved`) | `import_osm.py` |
| 2 | Extract relevant features (tag → kind of place; walkable highway types; water kinds) | `osm_import.node_type_for`, `osm_network.walkable_way`, `water.parse_water` |
| 3 | Normalise (names: English plus Marathi/Hindi local name; non-Latin names handled; official names for matching features) | `osm_import.parse_places` |
| 4 | Validate geometry (skip features without coordinates, ways with mismatched node lists, broken rings; clip to the pilot box plus 100 m) | `parse_places`, `build_network`, `water._join_rings` |
| 5 | Detect duplicate places (same name within 100 m merged at import; possible duplicates reported: same kind within 15 m, or same real name within 150 m) | `parse_places`, `validate_graph.py` |
| 6 | Detect disconnected streets (connected parts reported; places join the main network in preference to fragments) | `attach_places`, `validate_graph.py` |
| 7 | Detect suspicious connections (river/weir crossings without a bridge, fords, links through water, duplicate lanes, links over 60 m) | `build_network`, `river_guard`, `validate_graph.py` |
| 8 | Join places to footpaths (nearest safe lane within 60 m, never across water) | `attach_places` |
| 9 | Build the routing graph (split at shared nodes; junctions hidden; costs by road type and trust level) | `build_network`, `edge_specs` |
| 10 | Generate the offline dataset (pack: places plus lanes; rejected and unsafe lanes left out) | `pack_builder._collect` |
| 11 | Version it (content hash; a new version only when data changes; the pack lists its OSM source files in `sources`) | `ensure_current_pack` |
| 12 | Publish (production: an admin publishes new data; closures and rejections go live at once — `ADMIN_WORKFLOW.md`) | `pack_builder.publish`, admin map |
| 13 | Sync to phones (version check, then download only on change; kept in IndexedDB) | `lib/packSync.ts`, `lib/packStore.ts` |

## Trust levels

Every place and lane has a `verification` (`backend/app/verification.py`):

| Level | Meaning | Set by |
|---|---|---|
| `osm_imported` | From OpenStreetMap, nobody checked it | OSM import |
| `unverified` | Entered without evidence (e.g. a straight link nobody walked, a place saved without GPS) | volunteer/admin entry, sync |
| `remotely_reviewed` | A person checked it on maps or imagery, not on site | admin (admin map) |
| `volunteer_verified` | A volunteer stood there with GPS (place) or walked it with GPS (lane) | volunteer app |
| `officially_verified` | Confirmed by the Mela authority or another official source | admin |
| `rejected` | Wrong or unsafe: kept for the record, **never listed or routed** | admin |

**Rules:**
- **Nothing is promoted automatically.** Imports create `osm_imported` only.
- **Re-imports never undo a person's decision.** A place or lane that is reviewed, verified or rejected is not changed back by an OSM re-import, and a rejected place is never re-created.
- **Routing prefers checked lanes.** Cost factor: on-site verified ×0.85, reviewed on maps ×0.95, imported or unverified ×1 (plus the road-type costs).
- **What visitors see:** a route over anything not field-verified is **drawn dashed**, with the warning "Part of this route (dashed) uses map roads no volunteer has walked yet — follow police and signs."
- **Admin map:**
  - lanes: green = verified on site, blue dashed = reviewed on maps, grey dashed = imported/unverified, red = blocked/closed/rejected;
  - places are hollow until verified on site;
  - tapping a place or lane shows its trust level and lets an admin change it with a note. `verified_by` and `verification_note` are stored.

**Existing data** got its level from what is known, never more:
- OSM rows → `osm_imported`;
- a place saved from GPS → `volunteer_verified`;
- a walked lane → `volunteer_verified`;
- everything else → `unverified`.

Today the pilot dataset is 156 places and 2,475 lanes, **all `osm_imported`**.

## Current coverage (2026-10-30)

- Pilot zone 19.995–20.020 N, 73.780–73.815 E (Ramkund–Panchavati), plus city-wide transport, police and hospitals.
- 156 places; 2,363 street segments; 1,872 hidden junctions; 30 river crossings on bridges; 5 unbridged crossings left out (see `ROUTING_GRAPH_VALIDATION.md`).
- 9 possible duplicate places to review. One is real: "Kalaram Mandir" / "Sri Kala Rama Swamy Temple", 13 m apart.
- **0 field-verified places or lanes.** Field verification is Phase 8 (field pilot: volunteers on site).

## Not done (later phases)

- **Zone-based datasets** for areas beyond the pilot (the import is bounded by `PILOT_BBOX` today).
- **Trust levels for the volunteer screens' place list:** shown on the admin map only, for now.
