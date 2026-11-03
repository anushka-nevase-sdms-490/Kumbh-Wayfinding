# Routing graph validation and Godavari river safeguards (Phase 2)

**Rule:** nobody may be routed through the Godavari (or any river or weir)
because two streets on opposite banks are close. Banks connect only over a
mapped **bridge**, or over a crossing a person has checked and approved. If no
safe route exists, the app says so: "No walked lane yet — There is no safe
walking route to this place yet." It never draws a guessed line.

All of this works from OpenStreetMap data (remote). **Nothing here is field
verified.**

## Data

`scripts/import_osm.py water` saves the rivers, weirs, dams, canals, streams,
drains and water areas around the pilot zone to
`backend/data/osm/water-<date>.json`. In the pilot zone this is 32 features:

- river lines for the Godavari, Waghadi and Kapila;
- 4 weirs;
- 6 water areas, including Ram Kund.

`import_osm.py all` runs places → water → network. `network` **refuses to run
without water data**; `--no-water-check` overrides that, and is not for real use.

| Water kind | Treatment |
|---|---|
| river, weir, dam (`BARRIER_WATERWAYS`) | Crossing needs a mapped `bridge=*` / `tunnel=*`, or an approved crossing |
| stream, canal, drain, ditch | Roads cross them on culverts: allowed, counted |
| `ford=*` on a way | The whole way is left out |

## Three safeguards

| # | Where | What |
|---|---|---|
| 1 | Street import (`osm_network.build_network`) | Each segment of each way is tested against the river and weir lines. On a mapped bridge (or an approved crossing) the way is kept and its lanes are marked `passage_kind = "bridge"`. Otherwise **only the part over the water** is cut out; the rest of the way, such as the walk along the bank, stays usable. |
| 2 | Place links (`attach_places`) | The straight link from a place to its street must not cross a water line or pass through a water area (the first 10 m at the place's end are ignored, for ghats on the water's edge). If the nearest street is across the water, the next one on the same bank within 60 m is used; if none, the place is not joined and gets no route. |
| 3 | Pack builder (`river_guard`, every pack) | Any lane whose drawn line (end places included) crosses a river or weir is left out of the phones' data, unless it is a `bridge` lane **from the OSM import**, or a recorded volunteer walk that an admin approved (trust level `remotely_reviewed` / `officially_verified`; a new walk across water takes the approval back; a straight line nobody walked is never approved). Lanes people added are also checked against water areas (first and last 10 m ignored). A walk a volunteer recorded across the water is also left out and listed for review until an admin approves it (since 2026-11-03: a GPS gap on a bridge draws a straight jump over the river). A "bridge" label typed by a person is not enough, and volunteers cannot set it. This catches lanes that did not come through the import, such as a straight volunteer link. |

### Approved crossings (manual review)

`backend/config/approved_crossings.json` (in git and in the Docker image, **empty by default**) lists
unbridged crossings that a person has checked, each with an OSM way id and a
status (`remotely_reviewed` / `volunteer_verified` / `officially_verified`).
Only listed ways are kept, marked as bridges, with the status recorded. Never
add an entry without checking the crossing (satellite imagery, a volunteer
visit, or the Mela authority).

## Results on the real pilot data (2026-10-30)

| | Before the safeguards | After |
|---|---|---|
| Street lanes crossing a river or weir | 34, none marked: 29 real bridges plus **5 unbridged** | 34 lanes marked as bridges (30 crossings), **0 unsafe** |
| Unbridged crossings the router could use | **5** | 0 (cut out, reported) |
| Place links crossing water | 0 | 0 (checked on every import) |
| Main connected network | 1,897 junctions | 1,903 junctions (cutting only the water part keeps the banks' paths) |

**The 5 unbridged crossings left out.** These are candidates for review, not
proof that the paths are unsafe:

| OSM way | Kind | Near | Crosses |
|---|---|---|---|
| 1470352108 | pedestrian | 20.00762, 73.79063 (Ramkund) | weir on the Godavari |
| 1470352110 | footway | 20.00822, 73.79023 (Ramkund) | weir |
| 1469207348 | pedestrian area | 20.00728, 73.79168 (Ramkund) | weir and drain |
| 1470252662 | footway | 20.00836, 73.79216 | Godavari (no bridge tag) |
| 116833045 | tertiary road | 20.00501, 73.79361 | Waghadi (no bridge tag) |

**Routes after the change** (the app's router on the real data):

| Trip | Distance | River crossing |
|---|---|---|
| Ramkund Ghat → Kalaram Mandir | 413 m | none (same bank), unchanged |
| Ramkund Ghat → Sita Gufa | 546 m | none |
| Ramkund Ghat → Panchavati | 169 m | none |
| Kalaram Mandir → Ram Kund Boating | 485 m | over a mapped footbridge |
| Kapaleshwar Mahadev Mandir → Sundar Narayan Mandir | 920 m | **Ahilyabai Holkar Bridge** |

A first attempt removed whole ways and pushed Ramkund → Kalaram to 1,220 m
over the Gadge Maharaj Bridge. Cutting only the crossing segment fixed that.

## Validation report

```bash
cd backend && .venv/bin/python scripts/validate_graph.py [--json report.json]
```

It reports:

- lanes by source and kind;
- bridges;
- river crossings: **unsafe** (left out of the pack) and **review** (recorded volunteer walks);
- connected parts (largest first);
- places with no lane, and places stuck in a small separate part;
- duplicate lanes;
- place links over 60 m.

Exit code 1 if any lane in the pack still crosses water unsafely.

Current output (your database):

```
Places 156, junctions 1872, lanes 2475 (osm:bridge 34, osm:connector 112, osm:corridor 2329); in the pack 2475
River/weir crossings: 30 on bridges, 0 unsafe (left out of the pack), 0 recorded walks to review
Connected parts (largest first): [1903, 8, 6, 6, 6, 5, 5, 4, 4, 3]
Places with no lane: 44; in a small separate part: 1
Duplicate lanes: 0; place links over 60 m: 0
OK: no lane in the pack crosses water except on an approved bridge
```

The 44 places with no lane are the city-wide places outside the pilot zone.
The small separate parts are OSM fragments not connected to the street network.

## Existing databases

Streets imported before the safeguards (Phase 2) have no lanes marked as bridges, so safeguard
3 would leave out real bridges too. `start.sh` detects this (OSM lanes with no
bridge lanes) and re-imports the street network once, with the checks.

## Tests

- `run_api_checks.py` uses a river fixture (`scripts/fixtures/osm_river_*.json`):
  - the import refuses to run without water data;
  - the mapped footbridge is kept as a bridge;
  - an unbridged footway is left out and reported;
  - a ford is left out;
  - the bank street next to a cut stays usable;
  - a riverside place joins its own bank;
  - a place with only a cross-river street is not joined;
  - the only lane across the river is the bridge;
  - an approved crossing is kept with its status;
  - a straight volunteer link across the river is kept out of the pack;
  - `validate_graph.py` reports it.
- Browser (simulation mode): Kapaleshwar → Sundar Narayan routes 918 m over the bridge, with the route drawn.

## Limits

- **Only as good as OSM.** A river mapped only as an area (no centre line) is checked for place links (safeguard 2), not for streets. A bridge missing from OSM means a missing route, never an unsafe one.
- **Weirs and ghat walkways near Ramkund need a human decision.** They are left out until someone reviews and approves them in `approved_crossings.json`.
- **Seasonal water** (monsoon levels, Snan-day closures) is not modelled; closures are handled by volunteer blocks.
- **Recorded volunteer walks** across a river are kept, flagged "review": they should be on a bridge.
