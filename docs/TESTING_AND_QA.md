# Testing and QA

What is tested, how to run it, and what is **not** tested yet. Results are
from 2026-10-30 on the development machine (Pune). **Nothing has been tested
on site in Nashik or on real phones in the field.**

## Run everything

```bash
cd frontend
npx tsc -b && npm run lint            # types; lint (0 errors, 1 old warning: an effect's deps in App.tsx)
npm run test:routing                  # 140 checks: routing, guidance, offline, languages, simulation, queue
npm run build                         # production build

cd ../backend
.venv/bin/python scripts/run_api_checks.py                  # 151 API checks on a temporary SQLite database
SETU_TEST_DATABASE_URL=postgresql+psycopg2://…/empty_db \
  .venv/bin/python scripts/run_api_checks.py                # the same on an EMPTY Postgres database
.venv/bin/python scripts/validate_graph.py                  # data checks on the real database; must end with OK
.venv/bin/python scripts/check_migration.py                 # an old database (commit e6883e2) upgrades without loss
.venv/bin/python scripts/smoke_browser.py                   # real headless Chrome on a COPY of the database
```

**Browser smoke test** (`smoke_browser.py`, Phase 5):
- builds the app, then runs the API on a copy of `setu_local.db` with a throwaway account, plus `vite preview`;
- drives headless Chrome with a small built-in DevTools client (`cdp.py`, standard library only);
- checks: first visit, map download, **airplane mode with both servers stopped**, Hindi, scanned and typed board codes (also offline), search, the closed-facility warning, and the volunteer offline queue end to end;
- refuses to run if ports 8010 / 4173 are busy, and never touches the real database.

**The API checks never use the network:**
- they use saved fixtures (`backend/scripts/fixtures/`);
- they were run with `HTTPS_PROXY`/`HTTP_PROXY` pointing at a dead port, and pass;
- each run uses a fresh temporary database, never `setu_local.db`.

## Results (2026-10-30)

| Suite | Result |
|---|---|
| TypeScript (`tsc -b`) | Clean |
| ESLint | 0 errors, 1 old warning |
| Routing and phone logic (`test:routing`) | **140 / 140** |
| API checks, SQLite | **151 / 151**, about 16 s |
| API checks, Postgres 16 (empty database) | **151 / 151** |
| Production build | OK; no simulation code; no third-party URLs |
| `validate_graph.py` on the real Nashik database | OK: 30 river crossings on bridges, 0 unsafe; main network 1,903 points |
| `npm audit --omit=dev` (runtime packages) | 0 vulnerabilities (dev tools: see `SECURITY_AND_PRIVACY.md`) |
| Backup → restore (Postgres, `pg_dump -Fc` as `backup.sh`, `pg_restore` into an empty DB) | All rows back (2,028 points, 2,475 lanes, versions, audit, packs); the restored server rebuilt the same pack |

### Routing and phone logic (`frontend/scripts/runRoutingTests.ts`)

| Group | What it checks |
|---|---|
| T1–T15 | Router basics: routes around walls and desks, doors and glass, prefers wider paths, re-routes after a block, start = destination, unreachable places, dangling lanes ignored, real distances, turn detection, navigation states |
| T16–T21 | Nearest places, the forward line along a walk, progress along a lane, GPS filter (a coarse first fix is ignored), arrival (within about 20 m, not at 40 m or with ±60 m GPS), official places inside the map area |
| T22 | Offline pack sync: newer / same / wrong server (4xx, non-Setu answer) / **5xx = no connection** / empty / a download not matching its version |
| T23 | Built-in fallback places (OSM-matched only, no lanes) |
| T24 | Map roads: hidden junctions, preferences, directions; A* speed on about 3,000 junctions |
| T25, T30 | Hindi and Marathi: placeholders match English, exact key sets, no Hindi words in Marathi, Latin digits, wording samples; all 205 volunteer texts translated |
| T26 | Nashik simulation: the simulated walker follows the router, going off route and coming back, arrival, a GPS jump, losing the signal |
| T27 | Trust levels: field-verified lanes preferred, others dashed |
| T28 | Offline storage: checksum, damaged copy rejected, old copy accepted, "storage full" in each browser's form |
| T29 | Volunteer offline queue: kept offline, sent once in order, a walk waits for its place, refusals shown and not resent, a permanent 409 doesn't block the queue, "still saving" waits |

### API checks (`backend/scripts/run_api_checks.py`)

- **Sign-in:** PIN lock-out (including parallel guesses), sign-out, expired tokens.
- **Access:** every write needs sign-in, volunteers get 403 on admin endpoints, and the full database needs sign-in.
- **Places and lanes:** register from GPS (rough fixes refused), confirm a map place, record walks (jitter filtered, one-way respected), headings, edge status, sync.
- **Pack:** rebuilt only on change, gzip, never a dangling lane, attribution and sources, **no volunteer timestamps or notes in the public pack**.
- **Visitor reports:** limits per phone and per network address, confirm / reject, expiry.
- **OSM import:**
  - places: merging, confirmed places kept, prune;
  - streets: the first-run build;
  - **river safeguards**: a bridge kept, an unbridged crossing and a ford cut, banks stay usable, place links never cross water, an approved crossing kept, a straight link across the river kept out of the pack.
- **Trust levels:**
  - backfill on old databases; only admins set them;
  - re-imports never undo a review;
  - rejected rows are hidden but kept;
  - a volunteer's walk never lifts a rejection.
- **Offline queue:** the same Idempotency-Key is applied once, keys are tied to the volunteer, and refusals are replayed.
- **Simulation:** simulated positions are saved as `unverified`; production refuses them.
- **Admin:**
  - data checks and the audit log (who, from → to, no phone numbers);
  - **publishing**: new data waits, while closures, reopenings and rejections are live; publish, roll back, recreated lanes, pruning.
- **Limits:** 4 MB bodies (also chunked) → 413; an over-long note → 422.

## Browser tests (Chrome, development machine)

Each phase was tested in Chrome on real servers, on a **copy** of the database with throwaway test accounts where data was changed. Details are in each document.

| Area | Document | Highlights |
|---|---|---|
| Missing route | `MISSING_ROUTE_ROOT_CAUSE.md` | `start.sh` on a busy port 8000 with an empty database → routes work |
| Simulation | `NASHIK_SIMULATION_MODE.md` | Ramkund → Kalaram walked by the simulated visitor: off route → re-route, arrival, signal loss |
| River safeguards | `ROUTING_GRAPH_VALIDATION.md` | Kapaleshwar → Sundar Narayan routes over the Ahilyabai Holkar Bridge |
| Offline | `OFFLINE_ARCHITECTURE.md` | Damaged saved copy → removed and downloaded again; storage full during the map download; **production build with all servers stopped** still guides Ramkund → Kalaram |
| Volunteers | `VOLUNTEER_WORKFLOW.md` | Server stopped → place and simulated walk kept → sent once, in order, when back; Marathi and Hindi screens at 375 px |
| Admin | `ADMIN_WORKFLOW.md` | Data checks → open on the map; History; manual publishing: waiting → publish → roll back |
| Security | `SECURITY_AND_PRIVACY.md` | No third-party requests; fonts local; no position in URLs; `start.sh` serves only built files (dev-only paths return the app page) |

## Not tested yet

| What | Why it matters | When |
|---|---|---|
| **Real phones**: Android Chrome, iOS Safari, installed PWA | GPS, compass, permissions, storage eviction and the service worker behave differently on devices | Field pilot (ROADMAP 4.2) |
| **On site in Nashik** | GPS in crowds and near the river; whether OSM streets are really walkable; the 5 unbridged crossings | Field pilot |
| **Real ngrok tunnel with the new `start.sh`** | It now serves a built copy | Next owner run |
| **Load** (thousands of phones checking for updates) | The pack check is cached for 30 s and the pack is a static file, but no load test has been run | Before launch, on the real server |
| **Accessibility audit** (screen readers, contrast, large text) | Visitors include elderly pilgrims | Before launch |
| **Native-speaker review of Hindi and Marathi** | Written by the developer, checked only by automated rules | Before the pilot |
| **Production deployment on a real domain** | `deploy/` was tested locally (Postgres, migrate-once, startup checks, restore) but never on a server | When the server and domain exist |
| **Battery use** during long guidance | GPS is on the whole time | Field pilot |
| **Low-end phones and slow networks** | The map is 9 MB and the pack about 150 KB compressed | Field pilot |

## Field pilot checklist

To run with volunteers in the Ramkund–Panchavati zone (from ROADMAP 4.1–4.2, plus later findings):

1. **Each volunteer:** install the app (add to the home screen), download the map, sign in once with internet.
2. **Volunteers:** register the pilot places and walk each pilot lane (the lanes become field-verified).
3. **Visitor flow, offline:** with airplane mode on, go to 5 places and check the route, the turn prompts and arrival.
4. **GPS:**
   - drift in crowds and near the ghats;
   - standing still for 60 s gives no false "No GPS signal" (iOS and Android).
5. **Compass** direction on 3 phone models.
6. **The 5 unbridged crossings near Ramkund:** decide each one; approve real ones in `backend/config/approved_crossings.json`.
7. **Snan days:** which main roads close (police), and whether a block report or rejection covers them.
8. **Storage:** after a week, are the map and pack still on the phone (iOS clears sites not on the home screen)?
9. **Volunteer queue:** register a place with no network, then check it is sent once when back.
10. **Admin:** publish the pilot data, roll back once, check that phones follow.
11. **Duplicates:** resolve the 9 possible duplicates (Kalaram Mandir / Sri Kala Rama Swamy Temple is real).
