# Why the navigation route did not appear

Investigated and fixed on 2026-10-30, on the development machine in Pune. The
fix is uncommitted on branch `kunal-offline-map-integration`.

## Summary

The router and the map worked. **The app never received any Nashik route data**,
so for every trip it correctly showed "No walked lane yet" and drew no line.
Two independent causes, either one enough:

1. **Port clash.** `start.sh` and the Vite dev proxy sent `/api` to port
   **8000**. On this machine port 8000 belongs to another project's Docker
   container (`dms-backend-1`). Every pack request got **HTTP 404** from that
   program. `start.sh` could not stop a Docker port (no visible process id), so
   our backend failed to bind; `start.sh` then stopped with "Backend did not
   start", and running only the frontend sent `/api` to the other program.
2. **Empty database.** The OpenStreetMap places and street network had only
   been imported into test databases. The real development database
   (`backend/setu_local.db`) did not exist, and `start.sh` never imported any
   data. A fresh backend serves `node_count: 0, edge_count: 0`.

In both cases the app kept its 5 built-in sample places, which have **no lanes**,
so no route could exist, and the app did not say why.

**Not the cause:** the device GPS being in Pune. With data loaded and a Pune
GPS position, Ramkund Ghat → Kalaram Mandir shows "410 m to go", "In 55 m: Turn
right", and the route line is drawn.

## Evidence (before the fix)

| Check | Result |
|---|---|
| `docker ps` | `dms-backend-1  0.0.0.0:8000->8000/tcp` |
| `curl 127.0.0.1:8000/api/pack/latest` | `404 {"detail":"Not Found"}` |
| App's own proxy: `curl 127.0.0.1:5174/api/pack/latest` (default settings) | `HTTP 404` |
| `ls backend/*.db` | no database file |
| Fresh backend `/api/pack/latest` | `"node_count":0,"edge_count":0` |
| `grep import_osm start.sh` | 0 matches |
| Chrome, default settings, real GPS | Home: "Sample places only — walked lanes not downloaded yet"; Ramkund Ghat → Civil Hospital: "No walked lane yet", no line |
| Chrome, Nashik data loaded, GPS simulated in Pune (±10 m) | Ramkund → Kalaram: 410 m, turn instructions, route line and dashed map-road parts rendered |

## The request path, step by step

| Step | Status before the fix |
|---|---|
| 1. Choose start and destination | OK |
| 2. Load places and lanes (`GET /api/pack/latest`, IndexedDB) | **Failed** — 404 from another program, or an empty pack |
| 3. Router (A*, `lib/router.ts`) | Correct: no lanes, so no route |
| 4. Route line (`lib/mapData.ts` → `OfflineMap` `route` source) | Correct: nothing to draw |
| 5. Screen | "No walked lane yet", with no reason given |

## Fix

| Change | Files |
|---|---|
| `start.sh` picks ports safely: 8000 if free or ours, else the next free port (8010–8020); it never stops a program that is not ours (checks `/health` says `"service":"setu"`, or the page title is the app's); readiness checks ask for *our* backend, not "anything answers" | `start.sh` |
| The Vite proxy follows the chosen port (`SETU_BACKEND_PORT`) | `frontend/vite.config.ts` |
| One command builds the Nashik dataset: `scripts/import_osm.py all` (places, then streets). It uses the newest saved Overpass answer in `backend/data/osm/` when Overpass is unreachable or with `--saved` | `backend/scripts/import_osm.py` |
| `start.sh` builds the dataset on the first run (database with no places). Skip with `SETU_SKIP_DATASET=1` | `start.sh` |
| The app says why routes are missing: server not reachable / wrong server (with the HTTP status) / server has no places. The no-route screen says "Walking routes are not downloaded yet" when only sample places are loaded. Text in English, Hindi and Marathi | `frontend/src/lib/packSync.ts`, `App.tsx`, `i18n/*.ts`, `index.css` |

Saved Overpass answers (`backend/data/osm/places-20261030.json`,
`network-20261030.json`) are git-ignored; map data © OpenStreetMap
contributors, ODbL.

## Verification (after the fix)

- `USE_HTTPS=0 USE_TUNNEL=0 ./start.sh` on this machine:
  - "Port 8000 is used by another program — backend will use 8010";
  - "Nashik dataset ready (2020 places, 2471 lanes)";
  - backend and frontend ready.
- Chrome on `localhost:5173` (storage cleared, real GPS in Pune): "Offline data … 156 places"; Ramkund → Kalaram "410 m to go", "In 55 m: Turn right"; the route line and dashed parts are rendered on the guide map.
- Frontend pointed at the wrong server (port 8000): the home screen says "The route server did not answer correctly (error 404) …", and the no-route screen says "Walking routes are not downloaded yet …".
- Ctrl+C / TERM on `start.sh` stopped only our two servers; `dms-backend-1` kept running.
- Automated:
  - `runRoutingTests.ts` T22: 404 → `wrong_server`, non-Setu answer → `wrong_server`, `node_count 0` → `empty`;
  - `run_api_checks.py`: `import_osm.py all --saved` builds places and lanes on an empty database, and a second run changes nothing;
  - all suites pass.

## Reproduce the old failure

```bash
cd frontend && SETU_HTTP=1 SETU_BACKEND_PORT=8000 npx vite --port 5174   # proxy to the other program
# open http://localhost:5174 → now shows the "error 404" message instead of failing quietly
```

## Still open (planned, not part of this fix)

- Simulation mode for testing from Pune (the guide shows "Live GPS ±10 m"
  even 150 km away, with no warning).
- River-crossing checks on place-to-street connectors.
- 44 city-wide places outside the pilot zone have no streets, so routes to
  them show "No walked lane yet" by design.
