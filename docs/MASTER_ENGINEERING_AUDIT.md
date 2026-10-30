# Master engineering audit (start of Phase 2)

Audit date: 2026-10-30. Branch: `kunal-offline-map-integration`, last commit
`e6883e2`. All work from Phase 1 onwards is **uncommitted**: 41 modified, 14 deleted and
37 untracked files at audit time. This file reflects the code as it is, not
plans.

## 1. What the project is

**Setu / Kumbh Wayfinding** is an offline-first web app (PWA) that guides
pilgrims on foot in the Nashik Kumbh Mela pilot zone (Ramkund–Panchavati) in
English, Hindi and Marathi. Volunteers improve the data on site; admins manage
it. See `README.md`, `HOW_TO_USE.md` and `ROADMAP.md`.

## 2. Verified features (checked in code and by tests or browser runs)

| Area | Status | Evidence |
|---|---|---|
| Visitor flow: GPS / list start, destination with filters, guide with route line, "In X m: Turn …", auto-advance, arrival (~20 m along the final lane), off-route reroute, GPS smoothing and jump filter | Works | `runRoutingTests.ts` (98 checks), Chrome GPS-walk runs |
| Offline: installable PWA, app shell precache, map download (resumable), places and lanes in IndexedDB, update check by signature, built-in sample places | Works in browser tests | Chrome airplane-mode style test with servers stopped (Phase 2) |
| Geographic data: OSM places import (156), pilot street network (2,359 segments), place-to-street joining with main-network preference | Works | API checks, `import_osm.py` |
| Languages: visitor screens, directions and map labels in en/hi/mr | Works | T25 tests, Chrome |
| Volunteer: phone + PIN sign-in, 16 h revocable sessions, lockout (parallel-safe), place registration from live GPS with accuracy, explicit "This is <map place>" confirmation, lane recording, block / reopen with timed expiry | Works | API checks, Chrome |
| Visitor block reports → volunteer confirmation (never automatic), per-phone identity, flood limits | Works | API checks, Chrome |
| Admin map: places (confirmed or not), all lanes by state, reports, lane and report actions | Works | API checks, Chrome |
| Security: scrypt PINs, hashed tokens, `updated_by` audit field, restricted CORS, production settings guard | Works | API checks |
| Deployment package: Caddy HTTPS, Postgres, migrate-once, backups, README | Config validated; **not run on a server** | `docker compose config`, local Postgres runs |

## 3. Problems found in this audit

| # | Problem | Severity | Status |
|---|---|---|---|
| 1 | **Route never shown on this machine**: `/api` reached another program on port 8000 (404), and the real database was empty | Critical | **Fixed**, see `MISSING_ROUTE_ROOT_CAUSE.md` |
| 2 | `start.sh` would stop *any* program on its ports (`kill_port`) | High | **Fixed**: stops only our own servers |
| 3 | No simulation mode for testing from Pune; the guide shows "Live GPS ±10 m" while 150 km away | High | **Done (Phase 2)**: `?sim=1` in development builds, see `NASHIK_SIMULATION_MODE.md` |
| 3b | GPS signal loss went unnoticed ("Live GPS" with a frozen position) — found with the simulation | Medium | **Fixed (Phase 2)**: "No GPS signal" note after 30 s without reports (position kept: some phones report rarely when still) |
| 4 | River safety unverified: place-to-street connectors are straight lines up to 60 m with no water-crossing check | High | **Done (Phase 2)**: bridges only, water-safe place links, pack guard, `validate_graph.py`; 5 unbridged crossings found and left out — see `ROUTING_GRAPH_VALIDATION.md` |
| 5 | Only two trust levels (OSM-imported vs volunteer-confirmed); no `remotely_reviewed` / `officially_verified` / `rejected` | Medium | **Done (Phase 2)**: six levels, admin review on the admin map, re-imports keep reviews, rejected data hidden; see `NASHIK_GEO_DATA_PIPELINE.md` |
| 6 | No dataset publish / rollback: every data change goes live at once | Medium | **Fixed (Phase 3)** — manual publishing in production, closures always live, rollback, audit log (`ADMIN_WORKFLOW.md`) |
| 6b | Offline gaps: saved data not checked for damage, storage-full silent, broken IndexedDB not recovered, map download not stopping on full storage, data version not visible, server-down shown as "wrong server" | Medium | **Fixed (Phase 2)** — see `OFFLINE_ARCHITECTURE.md` |
| 6c | Public endpoints returned the whole database (unpublished, rejected rows, volunteer walk timestamps); public pack carried volunteer timestamps and notes; Google Fonts; position in a URL; no request size limits; API docs public in production; test suite downloaded from Overpass | High | **Fixed (Phase 4)** — see `SECURITY_AND_PRIVACY.md` |
| 7 | No offline queue for volunteer saves | Medium | Planned |
| 8 | Volunteer and admin screens English only | Medium | Planned |
| 9 | 44 city-wide places have no streets (outside the pilot zone) | Low (by design) | Documented |
| 10 | One old lint warning (`App.tsx` effect dependencies) | Low | Open |

## 4. Not tested at all

- Real phones: Android Chrome / installed PWA, iPhone Safari / Add to Home
  Screen, GPS permissions, battery.
- Production server, real domain, Let's Encrypt, the CSP in a real browser.
- Any physical verification in Nashik. All street and place data is
  **OSM-imported (remote)**; no route is field-verified.

## 5. Test baseline (after the missing-route fix)

- `npx tsc -b`: pass.
- `npm run lint`: 0 errors, 1 old warning.
- `npm run test:routing`: all checks pass.
- `npm run build`: pass.
- `backend/scripts/run_api_checks.py`: ALL OK (SQLite; earlier also on Postgres 16).

## 6. What happened next

The work proposed here was done in Phases 2–4 (simulation, trust levels,
river safeguards, offline hardening, the volunteer offline queue, admin
publishing, multilingual volunteer screens, security and QA documents).
The remaining work is in phases 5–8: see `REMAINING_WORK_ROADMAP.md`.
