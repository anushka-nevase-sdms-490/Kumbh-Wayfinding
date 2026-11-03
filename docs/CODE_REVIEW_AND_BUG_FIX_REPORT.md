# Code review and bug-fix report

**Date:** 3 November 2026 · **Branch:** `kunal-offline-map-integration` (starting point: commit `460443e`)
**Scope:** the whole repository: frontend, offline engine, routing, river safety, GPS, SOS, Ask Setu, volunteer/operator/admin tools, backend, database, security, deployment configuration.
**Companion:** [TEST_EXECUTION_REPORT.md](TEST_EXECUTION_REPORT.md) (every test case with its result).

> **What this report is and is not.** Everything here was tested on a
> developer computer: automated tests, a headless Chrome browser, SQLite and a
> throwaway PostgreSQL. **Nothing was tested on real phones or in Nashik.**
> This is not a professional penetration test, and not a legal review.

---

## 1. Executive summary

- **How the review was done.** Four independent reviews were run in parallel, each covering one area:
  1. routing and river safety;
  2. offline, SOS and Ask Setu;
  3. backend and security;
  4. screens and translations.

  Then the code was checked by hand, and the result of each finding was reproduced where possible. Only confirmed problems were fixed.
  A fifth, independent review then checked all the fixes. It found 5 problems in the fixes themselves and 1 older bug (section 4b). All 6 were fixed and re-tested.
- **Problems confirmed: 34. Fixed: 34.** Each fix has a regression test, apart from 6 small screen fixes (B-19, B-20, B-24, B-25, B-26, B-28), which were checked by type check, lint and the browser test.
  - **1 critical:** a "bridge" label could get a lane past the river check.
  - **11 high:** for example, an SOS shown as "sent" when it never reached the server, a reroute that could restart across the river, a late walk reopening a closed lane, and a map re-import reversing a one-way rule (that one came from an earlier fix in this review).
  - **11 medium** and **11 low**.
- **Open items: 14 at first. Then 5 were fixed and 1 partly fixed (section 4c).** 9 remain, listed in section 13 with the reason: data that needs the field pilot, decisions for the owner or the authority, the rest of the translation work, and things to confirm in the field.
- **Tests before → after:**

  | Suite | Before | After |
  |---|---|---|
  | Routing and logic tests | 198 | **217** (19 new) |
  | API checks, SQLite | 200 | **218** (18 new, 2 updated) |
  | API checks, PostgreSQL | not run at baseline | **216**, all OK |
  | Browser test (headless Chrome, production security policy) | 30/30 | **30/30** |
  | Type check, lint, build, migration, graph check | pass | pass |

- **Verdict:** ready for the next validation stage, the **field pilot**, from a code point of view. **Not ready for a public launch.** Real-phone tests, field verification of lanes, the lawyer's review, authority approvals and a professional security test are still open (section 14).

---

## 2. Architecture review

The code matches the intended architecture. It was confirmed from the code, not assumed:

| Part | What the code does | Verdict |
|---|---|---|
| Frontend | React 18 + TypeScript 5.6 + Vite 5. The PWA uses `vite-plugin-pwa`/Workbox with `registerType: "prompt"` | ✅ |
| Offline data | IndexedDB pack in one transaction, with an FNV-1a checksum. The map is in Cache Storage (`setu-map-<build>`), resumable | ✅ |
| Map | MapLibre GL 6, PMTiles + Protomaps basemap, local fonts including Devanagari | ✅ |
| Routing | A* on the phone (`lib/router.ts`). Closed, blocked and wall lanes are excluded. The heuristic (0.85 × straight-line distance) is admissible because multipliers are ≥ 1 | ✅ |
| Backend | FastAPI, SQLAlchemy 2, Pydantic 2. SQLite locally, PostgreSQL in production. `_ensure_columns` adds new columns to old databases | ✅ |
| Data pipeline | OSM via Overpass. River centrelines and areas from OSM water data. Approved crossings come from a config file (empty today) | ✅ |
| Deployment | Docker Compose (Postgres, API, Caddy). Caddy sets HTTPS, HSTS and a strict CSP. Uvicorn uses `--proxy-headers` | ✅ (not deployed) |
| Optional `mobile/` | Early Flutter prototypes, not part of the current product | Not reviewed further |

**Strengths:** the code was already careful about safety and honesty:

- trust levels on all data;
- SOS states that only the server can move forward;
- rejected data never reaches the published pack;
- simulation is compiled out of production builds;
- there are good test suites.

**Weak spots found** (all fixed, section 4):

- **The river safety net trusted labels instead of who set them.** It also did not check what the app actually draws.
- **Answers that did not come from the Setu server were trusted.** A Wi-Fi login page counted as a server reply.
- **Some server inputs were not range-checked.** NaN coordinates and bad lane paths got through.

---

## 3. Module-wise findings

Each line below names the problem IDs from section 4.

| Module | Inspected | Problems found | State |
|---|---|---|---|
| A. Frontend screens | `App.tsx`, all components, `lib/auth.ts`, i18n | B-19, B-20, B-24, B-25, B-26, B-28. Then fixed: O-02, O-05, O-07, and part of O-06 (section 4c) | Fixed / documented |
| B. Offline | `vite.config.ts`, `main.tsx`, `packStore`, `packSync`, `mapDownload`, `mapCache`, `network` | No new bugs in pack storage, sync, checksum or the service worker (re-verified). Not fixed: O-08 (map cache name on app update) | OK |
| C. Map and navigation | `router.ts`, `navigation.ts`, `progress.ts`, `nearest.ts`, `gpsFilter.ts`, `OfflineMap` | B-05 (reroute across the river). Not fixed: O-09 | Fixed |
| D. River safety and trust | `river_guard.py`, `water.py`, `osm_network.py`, `pack_builder.py`, `verification.py` | B-01, B-02, B-03, B-04, B-15. Not fixed: O-14 | Fixed |
| E. GPS and location | `location/*`, `useLivePosition`, `gpsFilter`, `nearest` | No bugs found. Real GPS and simulation are separate, there is no simulation in the production build, and position is never in a request during navigation | OK |
| F. SOS | `sos.ts`, `SosScreen`, `OpsSos`, `routers/sos.py`, `retention.py` | B-07, B-09, B-10, B-16, B-17, B-22 | Fixed |
| G. Ask Setu | `assistant.ts`, `AssistantScreen`, `reportParser.ts` | B-18, B-21. No outside service is used (confirmed) | Fixed |
| H. Volunteer, operator, admin | `outbox.ts`, volunteer components, `routers/volunteer.py`, `admin.py`, `reports.py`, `cases.py` | B-06, B-08, B-13, B-23. Then fixed: O-01, O-03 (section 4c) | Fixed |
| I. Backend and database | `main.py`, `schemas.py`, `db.py`, `idempotency.py`, `nodes.py`, migrations | B-11, B-12, B-27. Not fixed: O-10 | Fixed |
| J. Security and privacy | `auth.py`, CORS, Caddyfile, Dockerfiles, `.dockerignore`, dependencies | B-14. Not fixed: O-04, O-12, O-13 | Fixed / documented |

**Endpoint permissions** were extracted from the code and tested at API level. No endpoint is under-protected, and no API route creates accounts or changes roles.

- **Public:** sign-in, sign-out, the pack (latest, JSON, download), visitor reports, SOS send and SOS status, health.
- **Volunteer:** `/me`, reading places and lanes, register, path heading, lane status, record walk, reading and confirming reports.
- **Operator:** facility status, the SOS inbox with acknowledge and resolve, the operations summary, cases.
- **Admin:** everything else under `/api/admin/*`, plus `POST /api/nodes`, `POST /api/edges`, `POST /api/sync` and `POST /api/pack/build`.

---

## 4. Problems found and fixed

**Severity** follows the brief:

- **Critical:** unsafe routes, a river-safety failure, an authentication bypass, or lost/wrongly delivered SOS alerts.
- **High:** offline, GPS or reroute failure, data corruption, or a publishing/sync failure.
- **Medium:** wrong behaviour, translation or validation problems.
- **Low:** minor issues.

### Critical

**B-01 · A "bridge" label let a lane cross the river.**

- **Where:** `backend/app/services/river_guard.py`, `backend/app/schemas.py`.
- **Root cause:**
  - `crossing_problem()` accepted any lane whose `passage_kind` was `"bridge"`.
  - `POST /api/volunteer/edge-status` accepted any `passage_kind` string.
  - So any volunteer could relabel a straight link across the Godavari as a "bridge", and it was published and routable.
- **Fix:**
  - "Bridge" is trusted only on lanes from the OSM import, which marks only mapped bridges and crossings listed in `config/approved_crossings.json`.
  - Any other lane over water stays out of the pack. The only exception is a recorded volunteer walk that an admin then approved with a trust level only an admin can set (`remotely_reviewed` or `officially_verified`); this was narrowed in B-30.
  - Volunteers may only set the lane kinds `corridor`, `passage`, `door`, `glass_door`, `steps`, `wall` and `glass_wall`.
- **Test:** API checks "a lane people added across the river stays out of the pack even when labelled 'bridge'", "a volunteer cannot label a lane 'bridge'" and "an admin's trust level does not approve a straight line nobody walked across the river".

### High

**B-02 · The river check ignored a lane's end stretches.**

- **Where:** `river_guard.py`.
- **Root cause:** `lane_points()` used only the stored path. The app draws and routes `[from place, …path, to place]` (`mapData.ts`). So a path kept on one bank, with a place on the other bank, passed the check. This happens after a volunteer confirms an OSM place and moves it up to 60 m.
- **Fix:** the check now uses the same points the app draws.
- **Test:** "a lane whose drawn end stretch crosses the river is kept out".

**B-03 · Water areas were not checked for lanes people added.**

- **Where:** `river_guard.py`.
- **Root cause:** only river centrelines were checked. A chord between two ghats on a curving bank could cross the riverbank area without crossing the centreline.
- **Fix:** lanes added by volunteers and admins are also sampled every ~2 m against water areas. The first and last 10 m are skipped, because ghats sit at the water's edge.
- **Not covered:** OSM lanes. The import checks connectors against water areas, and street lanes are not re-checked (O-14).

**B-04 · A volunteer walk across the river was only a warning, and was still published.**

- **Where:** `river_guard.py`, `pack_builder.py`, `graph_report.py`.
- **Root cause:** a GPS gap on a bridge leaves a straight jump over the water, with a too-short length, marked `volunteer_verified`. The router then prefers it (×0.85).
- **Fix:** such walks stay **out of the pack** until an admin approves them. They are still listed as "recorded walks to review".
- **Test:** "a recorded walk across the river stays out of the pack until an admin checks it".

**B-05 · Leaving the route could restart the route across the river.**

- **Where:** `frontend/src/App.tsx`, `frontend/src/lib/nearest.ts`.
- **Root cause:**
  - The reroute restarted from the nearest *named* place by straight-line distance, with no distance limit.
  - Map junctions were left out, despite a comment saying they counted.
  - The phone has no river data, so it picked "West ghat", 80 m away across the water, and guided the person "straight" towards it.
- **Fix:** new `rerouteStart()`. It considers junctions and named places, but only within **50 m** of the walker. If nothing near can reach the destination, the person is told to head back to the route line.
- **Test:** T38 (3 checks).

**B-06 · A walk sent late from the offline queue reopened a closed lane.**

- **Where:** `backend/app/routers/volunteer.py`.
- **Root cause:** `record-path` set `blocked=False`, `walkable=True` and opened closed doors. A walk recorded before a closure, and sent after it, undid the closure. Closures go live at once, so phones received the reopened lane.
- **Fix:**
  - A walk never changes a closure. Reopening stays an explicit action through `edge-status`.
  - The answer now says `still_closed: true`, with a clear message.
- **Test:** "a recorded walk does not reopen a closed lane" and "reopening the lane explicitly puts it back in the pack".

**B-07 · An SOS was shown as "sent" when it had not reached the server.**

- **Where:** `frontend/src/lib/sos.ts`.
- **Root cause:**
  - Any 200/201 counted as delivered. A Wi-Fi login page (captive portal) answers 200 with HTML, so the alert became "sent" with no server id and was **never retried**.
  - A 403 page from a proxy was treated as a final "refused".
- **Fix:**
  - "Sent" requires a real Setu answer: a numeric `id` and a `status`.
  - "Refused" requires a Setu error (`detail`).
  - Anything else keeps the alert **pending** and it is retried. Status refreshes are checked the same way.
- **Test:** T36 "a 200 login page is NOT 'sent'" and "a 403 page from the network is not a final refusal".

**B-08 · The volunteer outbox lost changes on a non-Setu answer.**

- **Where:** `frontend/src/lib/outbox.ts`.
- **Root cause:** a 200 HTML page counted as saved, and the change was removed from the queue.
- **Fix:** only a JSON object from the server counts as an answer. Anything else keeps the change waiting.
- **Test:** T36 (2 checks).

**B-09 · The SOS was not sent if the phone could not save it, and nothing was shown.**

- **Where:** `sos.ts`, `components/SosScreen.tsx`.
- **Root cause:** the alert was saved to IndexedDB *before* sending. If that save failed (private mode, storage full), nothing was sent and no message was shown.
- **Fix:**
  - The alert is sent anyway.
  - The screen says "Sent, but this phone could not save it…", or "Could not save or send — call 112", in en/hi/mr.
  - Any unexpected error also shows the "call 112" message.
- **Test:** T36 "phone storage failing does not stop the alert being sent".

**B-10 · A flood of alerts, or a busy day, hid the oldest SOS alerts from operators.**

- **Where:** `backend/app/routers/sos.py`.
- **Root cause:** the operator list showed only the newest 200 open alerts. The per-phone limit can be avoided by changing the device id, so 240 fake alerts pushed a real one out of view.
- **Fix:** all open alerts are listed (safety limit 5,000). Possible-flood alerts are still sorted last.
- **Test:** "all open alerts are listed: the oldest is not pushed out by 220 newer ones".
- **Still open:** fake alerts can still bury real ones in a long list (O-12).

**B-11 · NaN or Infinity coordinates were accepted.**

- **Where:** `backend/app/schemas.py`, `backend/app/main.py`.
- **Root cause:**
  - NaN passes `>=`/`<=` range checks. Walk points, clearance and heading had no checks at all.
  - On PostgreSQL a NaN is stored, and the pack is written with a bare `NaN`. Phones cannot parse that, so **no phone could load the data**.
  - A rejected value also caused a 500, because the 422 answer echoed it and NaN can't be written as JSON.
- **Fix:**
  - Every schema refuses NaN and Infinity (`allow_inf_nan=False`).
  - Walk points, heading, clearance, admin place coordinates, lane length and cost now have ranges.
  - The 422 answer no longer repeats the input, which also avoids echoing personal data.
- **Test:** "NaN coordinates are refused with 422, not saved or a 500".

### Medium

**B-12 · One damaged lane path broke the pack for every phone.**

- **Where:** `schemas.py`, `pack_builder.py`, `routers/nodes.py`.
- **Root cause:** `path_json` was never checked to be a list. `"5"` made pack building fail with a 500 for every visitor.
- **Fix:** paths must be a JSON list of `{lat, lon}`. The pack builder and sync also tolerate damaged stored paths: such a lane is drawn straight.
- **Test:** "a lane path that is not a list of points is refused (the pack keeps working)".

**B-13 · A volunteer could create a place admins could not see or reject.**

- **Where:** `volunteer.py`.
- **Root cause:** choosing the code `OSM-J…` made the place look like a hidden map junction. It was published by name, but missing from admin lists, and verify/close answered 404.
- **Fix:** `OSM-…` codes are reserved for the map import. Map places are confirmed with `confirm_code`, as before.
- **Test:** "a volunteer cannot pick an OSM-… code".

**B-14 · The sign-in lock revealed which phone numbers are staff accounts.**

- **Where:** `backend/app/auth.py`, `frontend/src/lib/auth.ts`, `i18n/vol-*.ts`.
- **Root cause:** a locked account answered 423, while an unknown number always answered 401.
- **Fix:**
  - One identical 401 answer for an unknown number, a wrong PIN and a locked account, with the same timing.
  - The app shows a translated message that explains the 15-minute pause.
- **Test:** the lock check now compares the locked answer with the unknown-number answer, and the parallel-guess check counts real PIN checks (at most 5).
- **Still open:** someone can still lock a staff account for 15 minutes (O-04).

**B-15 · Re-importing OSM data undid lane settings made by people.**

- **Where:** `backend/app/services/osm_network.py`.
- **Root cause:** a re-import overwrote every field of an existing OSM lane. That brought back two-way on one-way crowd-control lanes, made a "wall" lane walkable again, and restored the OSM shape on lanes a volunteer had walked.
- **Fix:** a re-import keeps one-way rules, kinds the import does not write (wall, door, steps…), and the walked shape, length and headings.
- **Test:** "re-import keeps an admin's one-way rule, a lane marked as a wall and a volunteer's walked shape".

**B-16 · Operators could not tell that an SOS had waited hours offline.**

- **Where:** `db.py`, `schemas.py`, `routers/sos.py`, `sos.ts`, `OpsSos.tsx`.
- **Root cause:** the server only knew when the alert arrived, so an alert made at 10:00 and delivered at 18:00 looked new, with an 8-hour-old position.
- **Fix:**
  - The phone sends the time "Send" was pressed. It is stored as `asked_at`; a future time from a wrong clock is ignored.
  - The operator card warns when an alert was delivered more than 2 minutes after it was sent.
  - The new column is added to old databases automatically.
- **Test:** "an alert sent late from the phone shows when 'Send' was pressed; a time in the future (wrong clock) is ignored".

**B-17 · The phone never learned that an alert expired or was resolved after 24 hours.**

- **Where:** `sos.ts`.
- **Root cause:** the phone stopped refreshing after 24 h, but the server closes alerts at 48 h.
- **Fix:** the phone refreshes for 72 h.
- **Test:** T36 "an alert older than 24 h still learns that the server expired it".

**B-18 · Ask Setu missed common emergency phrasings.**

- **Where:** `frontend/src/lib/assistant.ts`.
- **Root cause:**
  - Marathi forms of fire and drowning: आगीत, बुडाला.
  - Curly apostrophes, as in "can’t breathe".
  - Snake bites (साप चावला, सांप ने काटा), हार्ट अटैक, danger (खतरा, धोका), stabbing, and Hinglish "bachao" / "aag lagi".
- **Fix:**
  - These words were added.
  - Smart apostrophes are treated as plain ones.
  - Marathi साप alone is not used, because it would also match सापडत ("found").
- **Test:** T37 (13 phrasings recognised). "घाट सापडत नाही", "aage…", "आगे मंदिर है" and "help desk" are not emergencies.

**B-19 · The path-heading screen could save 0° when there was no compass.**

- **Where:** `components/VolunteerPathHeading.tsx`.
- **Root cause:** Capture worked before any sensor reading arrived. 0° (north) was saved, and visitors' turn directions are built from it.
- **Fix:** Capture is disabled until there is a live compass reading. The register form already did this.

**B-20 · Errors on the operator SOS screen vanished at once.**

- **Where:** `components/OpsSos.tsx`.
- **Root cause:** the error was cleared by the reload that followed, and a network failure was not caught.
- **Fix:** the error is shown after the reload, and a no-connection message is added.

### Low

| ID | Problem | Where | Fix | Test |
|---|---|---|---|---|
| B-21 | The report helper read "about 8 years old" as a time, Marathi नाव ("boat") as a name, and missed Devanagari digits | `reportParser.ts` | A time is not taken from an age. नाव needs चं/चे/ची/चा before it or a colon after it. Devanagari digits are converted | T37 (3) |
| B-22 | A flush running while an SOS was being created could set it back to "pending" | `sos.ts` | Alerts being sent are skipped by the flush | Race traced in code; T32 and T36 still pass (no dedicated race test) |
| B-23 | A queued change the volunteer removed could come back | `outbox.ts` | The attempt is written only if the item still exists | T36 |
| B-24 | Lanes a visitor reported blocked were forgotten when they picked a new destination | `App.tsx` | Kept for the visit; "Clear temporary blocks" still lifts them | Type check / lint (no dedicated test) |
| B-25 | The volunteer reports list never showed its load error | `VisitorReports.tsx` | The error is shown, including for 403/500 | Type check / browser test |
| B-26 | An old "unknown board code" warning, and an old success message on the obstacle screen, stayed on screen | `App.tsx`, `VolunteerObstacle.tsx` | Cleared when the start changes or a new action begins | Type check / browser test |
| B-27 | Admin inputs were not range-checked (lat 999, negative length or cost) | `schemas.py` | Ranges added. All existing data was checked to be inside them | API check "admin inputs out of range … are refused" |
| B-28 | The server's English sign-in error replaced the translated one | `lib/auth.ts` | A 401 shows the translated text | Type check |

---

## 4b. Found by the independent review of the fixes

All the changes were reviewed again by a reviewer who had not seen this report. These problems were found and fixed. B-29 to B-33 were **introduced by fixes earlier in this review**. B-34 is older.

| ID | Severity | Problem | Root cause | Fix | Test |
|---|---|---|---|---|---|
| B-29 | High | A map re-import could **reverse a one-way lane** | Introduced by the B-15 fix. Lanes are matched regardless of direction, from/to were overwritten from the map, but the one-way rule, walked path and headings were kept. A lane stored the other way round (sync and walks re-orient lanes) flipped direction | The import compares each lane in its stored direction (`_reversed_spec`), so a kept one-way rule or walked path is never turned around | "re-import keeps the stored direction of a lane" |
| B-30 | Medium | An admin's general trust level also approved a **straight line nobody walked** across the river, and the approval survived a new walk | Introduced by the B-01 fix: any `remotely_reviewed` or `officially_verified` lane passed the river check | Admin approval counts only for a **recorded volunteer walk**. A new walk that crosses water takes an `officially_verified` approval back (`remotely_reviewed` was already downgraded by a new walk) | "an admin's trust level does not approve a straight line nobody walked", "the walk goes into the pack once an admin approved it", "a new walk across the river takes the approval back" |
| B-31 | Low | One old database row outside the new input limits could break the pack for everyone | Introduced by the B-11/B-12/B-27 fixes: the output models inherited the input limits | Output models read stored rows as they are; the limits apply to input only. A damaged path is drawn straight | API checks; schema check by hand |
| B-32 | Low | "Is it dangerous to bathe at night?", "snake charmers" and "धोका आहे का" got the emergency box | Introduced by the B-18 fix: "danger", खतरा, धोका and a bare "snake" were too broad | Removed; snake-bite phrases kept | T37 (ordinary questions) |
| B-33 | Low | A phone clock set years back showed operators "sent N days ago" | `asked_at` only dropped future times | Times more than 3 days back are ignored too; the alert is still accepted | API check "a clearly wrong clock … is ignored" |
| B-34 | Medium | Closing and reopening an **OSM bridge** from the obstacle screen turned it into a "corridor", which the river check then dropped. Routes across the river were cut after any bridge closure | Older bug: the screen always sends a lane kind (default "corridor"), and the server overwrote the kind | `edge-status` never changes the kind of an OSM bridge or place link; closing uses `blocked` | "a map bridge closed and reopened stays a bridge and back in the pack" |

---

## 4c. Open items fixed afterwards

| Was | Severity | Fix | Where | Test |
|---|---|---|---|---|
| O-01 | Medium | The volunteer obstacle screen now also lists every **closed map-road lane** (named "<street> · map road #id"), so a visitor-confirmed block can be reopened by a volunteer, not only by an admin. The server already allowed it | `VolunteerObstacle.tsx`, `vol-*.ts` | Type check; the API path is covered by the existing map-lane block checks |
| O-02 | Medium | The operator's quick replies are shown to the visitor **in their language** (`SOS_PRESETS`, `presetOf`); typed messages are shown as typed. Older phones still see the English text | `sos.ts`, `OpsSos.tsx`, `SosScreen.tsx`, `en/hi/mr.ts` | T39 (4 checks) |
| O-03 | Medium | The register form cannot save until the saved places have loaded. If they cannot load (offline with no saved copy), it says so. Before, an empty list was taken as "first place" and the place was saved with no lane | `VolunteerRegisterForm.tsx`, `vol-*.ts` | Type check + browser test (offline register step) |
| O-05 | Low | Operator case search shows only the newest answer. Opening a case offline or failing says so. A 409 conflict shows the latest case and keeps what the operator typed | `OpsCases.tsx` | Type check (cases are off in production) |
| O-06 (part) | Low | Translated: the volunteer home "SOS alerts" / "Lost persons" cards and the destination filter labels | `App.tsx`, `en/hi/mr.ts`, `vol-*.ts` | Type check (key parity in all three languages) |
| O-07 | Low | Chips are at least 44 px tall (SOS kinds, language picker). "Send SOS" has a bigger touch area. The next turn instruction is announced by screen readers (`aria-live`). The sign-in dialog is labelled, takes focus, and its error is announced | `index.css`, `App.tsx`, `VolunteerLogin.tsx` | Type check, lint, browser test |

---

## 5. Files changed

| Area | Files |
|---|---|
| Backend | `app/auth.py`, `app/db.py`, `app/main.py`, `app/schemas.py`, `app/routers/nodes.py`, `app/routers/sos.py`, `app/routers/volunteer.py`, `app/services/graph_report.py`, `app/services/osm_network.py`, `app/services/pack_builder.py`, `app/services/river_guard.py` |
| Frontend | `src/App.tsx`, `src/lib/assistant.ts`, `src/lib/auth.ts`, `src/lib/nearest.ts`, `src/lib/outbox.ts`, `src/lib/reportParser.ts`, `src/lib/sos.ts`, `src/components/OpsSos.tsx`, `src/components/SosScreen.tsx`, `src/components/VisitorReports.tsx`, `src/components/VolunteerObstacle.tsx`, `src/components/VolunteerPathHeading.tsx`, `src/components/VolunteerRegisterForm.tsx`, `src/components/VolunteerLogin.tsx`, `src/components/OpsCases.tsx`, `src/index.css`, `src/i18n/en.ts`, `hi.ts`, `mr.ts`, `vol-en.ts`, `vol-hi.ts`, `vol-mr.ts` |
| Tests | `frontend/scripts/runRoutingTests.ts` (T36–T39, 19 new checks), `backend/scripts/run_api_checks.py` (18 new checks, 2 updated), `backend/scripts/validate_graph.py` (its OK line now says "approved bridge") |
| Docs | this report, `TEST_EXECUTION_REPORT.md`, plus updates to `KNOWN_LIMITATIONS.md`, `SECURITY_AND_PRIVACY.md`, `TESTING_AND_QA.md`, `DEPLOYMENT_READINESS.md`, `LAUNCH_READINESS.md`, `ROUTING_GRAPH_VALIDATION.md`, `PROJECT_DEEP_DIVE.md`, `README.md` |

No dependency was added. No working feature was removed. The real database was never written; every data-changing test ran on a copy or a temporary database.

---

## 6–10. Tests executed and results

See [TEST_EXECUTION_REPORT.md](TEST_EXECUTION_REPORT.md) for the full matrix. In short:

| Suite | Result |
|---|---|
| TypeScript type check (`tsc -b`) | 0 errors |
| ESLint | 0 errors, 0 warnings |
| Production build | OK. No simulation code in the production bundle |
| Routing and logic tests (`npm run test:routing`) | **217 passed, 0 failed** |
| API checks, temporary SQLite | **218 passed, 0 failed** |
| API checks, empty PostgreSQL 16 | **216 passed, 0 failed** (2 dataset-build checks run on SQLite only) |
| Old database upgrade (`check_migration.py`) | All OK |
| Graph check on a copy of the real database | OK. 0 lanes cross the river except on bridges; the new end-stretch check changes nothing in the real data |
| Headless Chrome browser test (production CSP) | **30 / 30**: first visit, map download, airplane-mode route, languages, Ask Setu, stale data, boards, search, closure during guidance, SOS offline → online → acknowledged, cases, report helper, volunteer offline queue |

---

## 11. Security findings

| Topic | Finding |
|---|---|
| PIN storage | scrypt with salt (n=2¹⁴, ~50 ms). PINs are never stored or logged in plain text. ✅ |
| Sessions | Random 32-byte tokens, stored as sha256, valid 16 h. Expiry, sign-out and disabled accounts take effect on the next request (tested). ✅ |
| Authorisation | Roles are checked on the server for every endpoint (tested at API level: anonymous 401, volunteer 403). ✅ |
| Account probing | **Fixed (B-14):** the same answer for unknown, wrong and locked |
| Lock-out abuse | **Open (O-04):** 5 wrong PINs pause any account for 15 min. The per-network limit (30 per 15 min) slows this; `manage_volunteers.py enable` lifts a lock |
| Input validation | **Fixed (B-11, B-12, B-27):** NaN/Infinity, ranges, lane paths |
| SQL injection | All database access goes through SQLAlchemy with bound parameters. The only raw SQL is fixed DDL in migrations. ✅ |
| XSS | No `dangerouslySetInnerHTML`; server text is rendered as text. CSP `script-src 'self'`. ✅ |
| CSRF | Not applicable: sign-in uses a Bearer token, never cookies. CORS sends no credentials, and production refuses `*`. ✅ |
| Headers | Caddy: HSTS, nosniff, Referrer-Policy, Permissions-Policy, strict CSP (`connect-src 'self'`). The browser test runs under the exact production CSP. ✅ |
| Forwarded addresses | Caddy replaces a client's X-Forwarded-For, and the API port is not published. Locally only loopback is trusted. ✅ |
| Secrets | Production refuses to start with a default secret or CORS `*`. `.env` and `*.db` are in `.dockerignore`. No secret was printed during this review. ✅ |
| Privacy | Navigation sends no position (checked again). An SOS sends a position only after the screen says so. The public pack has no volunteer data. Simulation is not in the production build (checked in `dist/`). ✅ |
| SOS flooding | **Partly fixed (B-10).** **Open (O-12):** device ids can be changed, so per-phone limits can be avoided |
| Dependencies | **0** known problems in packages that ship to phones (`npm audit --omit=dev`). 24 advisories in build and development tools only (O-13). Python: see [TESTING_AND_QA.md](TESTING_AND_QA.md) |

**Not done:** a professional penetration test.

---

## 12. Performance findings

Measured on the developer laptop. Phones will be slower.

| What | Result | Note |
|---|---|---|
| Route finding, real pilot data (156 places, 2,028 points, 2,475 lanes) | Over 3,565 place pairs: median 0.4 ms, 95% within 4.5 ms, slowest 15 ms, first route 35 ms | Ample margin even if a phone is 10× slower |
| Places with no route between them | 47% of place pairs | A data issue, not a code issue: 44 places have no lane and some small parts are not connected. The app says so honestly ("No walked lane yet") |
| Pack download (`/api/pack/latest/json`) | ~2 MB of JSON, sent gzipped. Median 127 ms after the first build (first ~950 ms) | Fine for one download per phone |
| Pack version check | Median 18 ms | Used for the 3-minute check during guidance |
| JS bundle | Main 360 KB (119 KB gzipped). The map chunk is 1.09 MB (294 KB gzipped) and loads only on map screens | The map library is the largest part. No optimisation was needed |
| Service worker precache | 24 files, 2.3 MB | The offline map (~9 MB) is downloaded separately, on request |

No optimisation was made: nothing measured was slow enough to justify one.

---

## 13. Remaining limitations (not fixed)

| ID | Severity | Item | Why not fixed / what is needed |
|---|---|---|---|
| O-04 | Medium | Lock-out can be used to pause a staff account for 15 min | A trade-off of lock-outs. Mitigated by the per-network limit. Watch in the pilot |
| O-06 | Low | English left: the official "how to get there" tips on the no-route screen (official place data is English), the compass sensor notes, and the operator and admin screens (English only) | Translation of content and staff screens, best done with the native-speaker review |
| O-08 | Low | After an app update with a new basemap build, the offline map must be downloaded again (~9 MB) | By design, so that old and new tiles never mix. Communicate to volunteers |
| O-09 | Low (suspected) | "Path blocked" right after leaving a place blocks only the short connector | Field test |
| O-10 | Low (suspected) | A signed-in POST to a URL path longer than 128 characters may give a 500 on PostgreSQL | No real client does this |
| O-11 | Data | 44 places have no lane, 9 possible duplicate places, **0 field-verified lanes** | Field pilot and volunteer walks |
| O-12 | Medium | SOS flooding with changing device ids still makes a long list | Needs an operational decision with the authority (e.g. verification at help desks) |
| O-13 | Low | 24 dependency advisories in build tools (esbuild, glob…) | Not in the deployed app. Production serves built files only. Upgrade Vite at the next planned upgrade |
| O-14 | Low | The water-area check is not applied to OSM street lanes (only to OSM connectors at import, and to lanes people add) | Applying it to streets along ghats could remove real paths. Review with the field pilot |

---

## 14. Deployment readiness

| Acceptance criterion | State |
|---|---|
| Frontend builds | ✅ |
| Backend starts | ✅ (the browser test starts it; production settings are checked at start-up) |
| Existing tests pass | ✅ (all suites above) |
| No known critical bugs | ✅ (B-01 fixed) |
| No high bugs left unaddressed | ✅ (all 10 fixed) |
| Offline navigation verified | ✅ in Chrome with the servers stopped (browser test). ❌ **not on real phones** |
| River safety rules verified | ✅ in tests and on the real data (copy). ❌ **no lane verified in the field** |
| SOS workflows verified | ✅ API, logic and browser tests. ❌ **no real operators, no real phones** |
| Role permissions verified | ✅ API level |
| Database integrity checks | ✅ migration and graph checks |
| Regression tests pass | ✅ |
| Security checks completed | ✅ code-level review. ❌ **no professional penetration test** |

**Conclusion:** the code is ready for the **field pilot with volunteers**. It is **not production-ready**. Before a public launch, the items in [LAUNCH_READINESS.md](LAUNCH_READINESS.md) are still needed:

- real-device tests;
- field verification of lanes;
- a native-language review;
- the privacy notice and a lawyer's review;
- authority approvals (SOS staffing, cases, QR boards);
- a server with monitoring;
- a professional security test.
