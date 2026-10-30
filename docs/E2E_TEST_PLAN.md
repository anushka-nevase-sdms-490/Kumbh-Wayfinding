# End-to-end test plan (Phase 8b)

The 20 scenarios from the master prompt. Each says **how** it is tested,
what has **actually been run** (2026-10-30, development machine in Pune) and
what is still open. A simulated result is never described as field-verified.

**Kinds of test**
- **Auto:** an automated test in the repository, run on every change.
- **Sim:** the development-only Nashik simulation (a simulated walker moving the real navigation logic; never in production builds, refused by the production server).
- **Remote:** review of remote data (OpenStreetMap, satellite imagery, official lists) from Pune.
- **Device:** on a real phone (Android Chrome, iOS Safari, installed PWA).
- **Field:** on site in Nashik.

Suites: phone logic `npm run test:routing` (T1–T35) · API `run_api_checks.py` (SQLite and empty Postgres) · browser `smoke_browser.py` (headless Chrome, database copy, production CSP) · data `validate_graph.py` · migration `check_migration.py`.

| # | Scenario | Auto | Sim | Remote | Device | Field | Evidence today / still open |
|---|---|---|---|---|---|---|---|
| 1 | First-time installation | ✅ | — | — | ❌ | ❌ | Smoke: service worker active, places saved on first visit. **Open:** add to home screen on Android and iOS |
| 2 | Downloading offline data | ✅ | — | — | ❌ | ❌ | Smoke: map download saved; T22 new/same pack signature; T28 storage full. **Open:** 9 MB map on a slow mobile network, low-end phone |
| 3 | Airplane-mode operation | ✅ | — | — | ❌ | ❌ | Smoke: **both servers stopped + browser offline**: route Ramkund → Kalaram (413 m), board link, Ask Setu, SOS saved as "not sent yet". **Open:** real airplane mode on phones, iOS storage eviction after days |
| 4 | Searching locations | ✅ | — | — | ❌ | — | T31 search by English or local name, any case, several words; smoke "kala" → Kalaram Mandir with its Closed badge |
| 5 | Calculating walking routes | ✅ | ✅ | 🟡 | ❌ | ❌ | T1–T24 routing; T27 trust levels (unwalked parts dashed); Sim Ramkund → Kalaram with turns and arrival. Remote: OSM roads reviewed in the pilot zone. **Open:** walk the pilot lanes (0 field-verified) |
| 6 | River-crossing restrictions | ✅ | — | 🟡 | — | ❌ | `validate_graph.py`: 30 crossings on bridges, 0 unsafe; API check "street import refuses to run without river data"; Kapaleshwar → Sundar Narayan routes over the Ahilyabai Holkar Bridge. **Open:** the 5 unbridged crossings near Ramkund need an on-site decision |
| 7 | Poor GPS accuracy | ✅ | ✅ | — | ❌ | ❌ | T18 off-route limit widens with poor accuracy; T19 GPS filter; T20 no arrival with ±60 m; Sim noise and jumps. **Open:** crowds, near water, under tents |
| 8 | GPS signal loss | ✅ | ✅ | — | ❌ | ❌ | T26 lost signal; Sim "Lose signal" → "No GPS signal right now" after 30 s, "Signal back". **Open:** standing still 60 s on iOS/Android gives no false warning |
| 9 | QR scanning | ✅ | — | — | ❌ | ❌ | Smoke: board link `/?at=CODE` (also offline), typed code (case-insensitive, unknown code explained); T31 codes. **Open:** a printed board scanned with the phone's camera app in daylight; board durability |
| 10 | Volunteer reporting | ✅ | ✅ | — | ❌ | ❌ | API: register, walk, block/reopen, confirm/reject reports, accuracy rules; smoke: place + walk through the UI. **Open:** volunteers in the pilot |
| 11 | Offline queue synchronisation | ✅ | — | — | ❌ | ❌ | T29 kept, sent once in order, refusals shown; API idempotency; smoke: server stopped → saved → back online → sent once (places 1, walks 1). **Open:** a day of real patchy network |
| 12 | SOS delivery states | ✅ | — | — | ❌ | ❌ | T32 pending → sent → acknowledged, never duplicated; API idempotent resend, 5/hour limit, flood marking (never refused); smoke: no network → "not sent yet" → sent → operator acknowledges → visitor sees the message. **Open:** `tel:` links, vibration and sound on real phones; console staffing |
| 13 | Authorized case handling | ✅ | — | — | ❌ | — | API: operator-only, status workflow, notes required, version conflict 409, child contact masking, audit without details, retention, off by default; smoke: case from a "lost" SOS → reviewed → reunited → closed, report helper. **Open:** authority approval before switching on |
| 14 | Hindi and Marathi workflows | ✅ | — | — | ❌ | — | Type-checked key parity (en/hi/mr); T25/T30 texts; smoke Hindi start screen and a Hindi question; T33/T34 questions and reports in hi/mr. **Open:** native-speaker review |
| 15 | AI service failure | ✅ (n/a) | — | — | — | — | **No external AI service is used**, so there is nothing to fail: "Ask Setu" runs offline (smoke in airplane mode) and the report helper runs in the browser. If an AI service is added later, the rule-based answer must stay the fallback (`ASSISTANT_AND_OPERATIONS.md`) |
| 16 | Stale datasets | ✅ | — | — | ❌ | — | T35 + smoke: after 12 h without confirming the data, the home screen and guide warn; the warning clears once the server confirms. **While guiding, the phone checks for new data every 3 min**: smoke closes a lane on the active route → rerouted (413 m → 453 m) with "Route updated", and never before the data changed. T31/T33 an expired facility status is never shown as open. T22 a download that doesn't match the announced signature is rejected, and an empty server pack never replaces the phone's. **Open:** a phone offline for days in the pilot |
| 17 | Invalid data packs | ✅ | — | — | ❌ | — | T22 unusable packs refused (no places, no positions, no signature); T28 damaged saved copy detected, removed and downloaded again; API content-hash pack versions. **Open:** real storage corruption is rare and hard to reproduce on devices |
| 18 | Authentication failures | ✅ | — | — | — | — | API: wrong PIN, lock-out after 5 (atomic), **per-network limit 30 / 15 min**, expired and revoked tokens → 401, wrong role → 403 |
| 19 | Admin publishing and rollback | ✅ | — | — | — | ❌ | API: publish, rollback, closures and board codes stay live across versions; browser test in `ADMIN_WORKFLOW.md`. **Open:** a rollback during the pilot, checking phones follow |
| 20 | Backup and restore | ✅ (local) | — | — | — | — | `pg_dump -Fc` (as `deploy/backup.sh`) → `pg_restore` into an empty Postgres 16: all rows back, the same pack rebuilt; migration from an old database (9/9). **Open:** restore on the real server, off-server copies |

## Summary

| Kind | Scenarios covered |
|---|---|
| Automated | 20 / 20 (15 counted as not applicable, see row 15) |
| Simulated | 5, 7, 8, 10 |
| Remote data review | 5, 6 (partly) |
| **Real device** | **0 / 20 — not done** |
| **Field** | **0 / 20 — not done** |

## Device and field runs (for the pilot)

Run on at least: one low-end Android (Chrome), one recent Android, one iPhone (Safari, installed to the home screen).

1. Install, download the map, airplane mode, route to 5 places (rows 1–3, 5).
2. Search, board scan with the camera app, typed code (rows 4, 9).
3. Walk with guidance; stand still 60 s; walk under cover (rows 7, 8).
4. Volunteer: place + walk with no network, then reconnect (rows 10, 11).
5. SOS: send in airplane mode, reconnect, operator acknowledges; tap Call 112 (do not complete the call) (row 12).
6. Hindi and Marathi end to end, with a native speaker (row 14).
7. Leave a phone offline for a day; check the stale warning and that the data is still there (rows 16, 3).
8. Admin rolls back once during the pilot; phones follow (row 19).

Record each run: phone model, OS and browser version, date, place, result, and screenshots, in `TESTING_AND_QA.md`.
