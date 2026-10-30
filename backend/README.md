# Setu Backend

Python API for mela places, walkable paths, and offline pack files.

## Folder

```
backend/
  app/           # FastAPI code
  data/packs/    # Generated offline packs
  data/osm/      # Saved Overpass answers (import_osm.py)
  scripts/       # import_osm.py, run_api_checks.py
  requirements.txt
  run.sh         # Start server
  Dockerfile
```

## Run

```bash
cd backend
./run.sh
```

- Health: http://localhost:8000/health  
- Docs: http://localhost:8000/docs  

## Volunteer accounts (sign-in)

Every write needs a signed-in volunteer (phone number + 6-digit PIN); the
data-repair endpoints (`/api/nodes`, `/api/edges`, `/api/sync`, `/api/pack/build`)
need an **admin**. Reading the pack, places and lanes stays public.

```bash
cd backend
.venv/bin/python scripts/manage_volunteers.py add 9876543210 "Team Admin" --role admin   # first admin
.venv/bin/python scripts/manage_volunteers.py add 9123456780 "Asha Patil"
.venv/bin/python scripts/manage_volunteers.py list
.venv/bin/python scripts/manage_volunteers.py reset-pin 9123456780   # also signs out her phones
.venv/bin/python scripts/manage_volunteers.py disable 9123456780     # lost phone / left the team
```

- `POST /api/auth/login {phone, pin}` → a token for one shift (16 h), sent as
  `Authorization: Bearer …`. Only its sha256 is stored, so `revoke`/`disable`
  take effect at once. 5 wrong PINs lock the account for 15 minutes.
- PINs are hashed with scrypt; they are typed in, never put on the command line.

## Import places from OpenStreetMap

```bash
cd backend
.venv/bin/python scripts/import_osm.py places --dry-run   # see what would change
.venv/bin/python scripts/import_osm.py places             # write + rebuild the pack
```

- Ramkund–Panchavati pilot zone: ghats, temples, hospitals, toilets, water,
  parking, bus/rail, police. Whole map area: only transport, police and real
  hospitals (`healthcare=hospital` or `emergency=yes`).
- Codes are `OSM-N…`/`OSM-W…`/`OSM-R…`. Imported places are **unconfirmed** until
  a volunteer registers at the spot (same type, within 30 m) — that confirms the
  OSM place instead of adding a twin, and later imports never change it.
- The raw answer is saved in `data/osm/`; replay it with `--from-file`.
  `--prune` deletes unconfirmed, unused places that are gone from OSM.
- Map data © OpenStreetMap contributors (ODbL).

```bash
.venv/bin/python scripts/import_osm.py water               # rivers, weirs, water areas (needed first)
.venv/bin/python scripts/import_osm.py network --dry-run   # roads + footpaths, pilot zone
.venv/bin/python scripts/import_osm.py network
.venv/bin/python scripts/validate_graph.py                 # bridges, unsafe crossings, disconnected parts
```

- Roads and footpaths of the pilot zone become **map lanes** (`source="osm"`,
  `verified=false`), split where they meet; meeting points are hidden junction
  places (`OSM-J…`, never listed). Motorways, trunk roads, tracks and private
  roads are left out; busy main roads cost more.
- Every place within 60 m of a lane is joined to it by a short connector
  (preferring the main road network over unconnected fragments). Run `network`
  again after new places are registered or imported.
- **River safety:** a river or weir is crossed only on a mapped bridge (or an
  approved crossing in `config/approved_crossings.json`); unbridged crossings and
  fords are left out, and place links never cross water. Details:
  `docs/ROUTING_GRAPH_VALIDATION.md`.
- Walked volunteer lanes are preferred; a route that uses map lanes is drawn
  dashed with a warning in the app. Blocks volunteers set on map lanes survive
  a re-import. The pack is gzipped (~160 KB for the pilot zone); the script
  refuses a pack over 2 MB without `--force`.

## Main APIs

| Method | Path | Meaning |
|--------|------|---------|
| GET | `/api/nodes` | Place list |
| GET | `/api/edges` | Man-made path links |
| POST | `/api/sync` | Staff phone upload |
| POST | `/api/pack/build` | Make sure the pack matches the data (new version only if places/lanes changed) |
| GET | `/api/pack/latest` | Small version info (`signature`) so phones can check for updates |
| GET | `/api/pack/latest/json` | Current pack body (served from its file) |
| GET | `/api/pack/download/{version}` | One pack version (never changes, cached forever) |
| POST | `/api/reports` | Visitor "path blocked" (public, max 5/hour per phone) — only a suggestion |
| GET | `/api/reports?lat=&lon=` | Pending reports, nearest first (volunteer) |
| GET | `/api/admin/overview` | Admin map: all places (confirmed or not), all lanes incl. blocked, pending reports (admin) |
| POST | `/api/reports/{id}/confirm` · `/reject` | Volunteer checked the lane: timed block (`{"hours": 1}`, `null` = until reopened) or not blocked |
