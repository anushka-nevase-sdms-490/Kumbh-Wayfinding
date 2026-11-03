# Test execution report

**Date:** 3 November 2026 · **Branch:** `kunal-offline-map-integration` (code review on top of `460443e`)
**Where:** the developer laptop. It used:

- a headless Chrome driven by `backend/scripts/smoke_browser.py`, under the exact production Content-Security-Policy;
- a temporary SQLite database;
- a throwaway PostgreSQL 16;
- a copy of the real Nashik database.

**Network:** API and browser tests ran with outside network access blocked.

**Status values:**

- **PASS** means the test ran and gave the expected result.
- **FAIL** means it ran and did not.
- **BLOCKED** means it can't run here (it needs a device, the field or a person).
- **NOT TESTED** means it could run here but was not run in this cycle.

> No test in this report ran on a real phone or in Nashik. "Offline" in the
> browser test means the app's servers were stopped and Chrome continued from
> what it had saved. That is the closest equivalent to airplane mode on a
> computer, not a field test.

## 1. Suite totals

| Suite | Command | Before the review | After the review | Status |
|---|---|---|---|---|
| Type check | `cd frontend && npx tsc -b` | 0 errors | 0 errors | PASS |
| Lint | `npm run lint` | 0 errors | 0 errors, 0 warnings | PASS |
| Production build | `npm run build` | OK | OK. No simulation code in `dist/` | PASS |
| Routing and phone logic | `npm run test:routing` | 198 / 198 | **217 / 217** | PASS |
| API checks, SQLite | `cd backend && .venv/bin/python scripts/run_api_checks.py` | 200 / 200 | **218 / 218** | PASS |
| API checks, PostgreSQL 16 (empty DB) | same, with `SETU_TEST_DATABASE_URL` | not run at baseline | **216 / 216** (2 dataset-build checks run on SQLite only) | PASS |
| Old database upgrade | `scripts/check_migration.py` | All OK | All OK | PASS |
| Graph check, copy of the real database | `scripts/validate_graph.py` (copy) | OK | OK (0 unsafe river crossings) | PASS |
| Browser test, headless Chrome | `scripts/smoke_browser.py` | 30 / 30 | **30 / 30** | PASS |
| Runtime dependency audit | `npm audit --omit=dev` | 0 | 0 | PASS |

## 2. Test execution matrix

### Offline (Module B)

| Test Case | Module | Expected Result | Actual Result | Status |
|---|---|---|---|---|
| First visit online: app cached, data pack saved | Offline | Service worker active, pack in IndexedDB | "Offline data from 3 Nov, 12:16 · 156 places" | PASS |
| Download the offline map | Offline | Map files saved in Cache Storage | Map saved on the phone (browser test) | PASS |
| Servers stopped, reload the app | Offline | App opens from the service worker | Opened; places loaded from IndexedDB | PASS |
| Map tiles draw offline | Offline | Map drawn from saved tiles | Route drawn on the map (browser test) | PASS |
| Search places offline | Offline | Results from the saved data | "kala" → Kalaram Mandir first, with its Closed badge | PASS |
| Walking route offline | Offline | Route found on the phone | Ramkund → Kalaram "413 m · about 6 min" | PASS |
| Ask Setu offline | Offline | Nearest medical help from the saved data | Answered; Hindi question answered; honest "cannot answer" | PASS |
| Reconnect: sync | Offline | Waiting changes and SOS sent; stale warning cleared | Queue emptied; place and walk saved once; SOS → SENT; stale warning cleared | PASS |
| Damaged saved pack detected | Offline | Removed, visitor told | T28 | PASS |
| Interrupted map download resumes | Offline | Continues from where it stopped | Covered in Phase 1 browser tests (`OFFLINE_ARCHITECTURE.md`); not re-run | NOT TESTED |
| Stale data (no confirmation for 12 h) | Offline | Warning shown offline, cleared when the server confirms | Browser test step 4c | PASS |
| Offline on Android Chrome / iOS Safari / installed PWA | Offline | Same as above | Needs real devices | BLOCKED |

### Map, navigation and GPS (Modules C, E)

| Test Case | Module | Expected Result | Actual Result | Status |
|---|---|---|---|---|
| Ramkund → Kalaram Mandir | Navigation | Connected route, distance, time, turns | 413 m, about 6 min, "In 58 m: Turn right" | PASS |
| Many start/destination pairs (real data) | Navigation | Valid routes or honest "no route" | 3,565 pairs: 1,870 routes, 1,695 "no route" (data gaps) | PASS |
| Unreachable destination | Navigation | "No walked lane yet", no invented route | T1–T15 (unreachable places) + screen text checked | PASS |
| Blocked / closed / wall lanes avoided | Navigation | Never in a route | T1–T15 | PASS |
| Rejected lanes never in the pack | River/trust | Excluded on the server | API checks (rejected lane stays out, also after a walk) | PASS |
| Lane closed during guidance | Navigation | Rerouted on the next data check, "Route updated" only then | 413 m → 453 m, message only after the change | PASS |
| Wrong turn → reroute | Navigation | New route from a point near the walker | T26 (simulation) + T38 | PASS |
| Reroute never restarts across the river | Navigation | Restart within 50 m (junction allowed); else head back | T38 (3 checks) | PASS |
| GPS jump ignored | GPS | A jump over 35 m is not taken | T16–T21 (GPS filter), T26 | PASS |
| Poor GPS accuracy | GPS | No start suggested from a fix worse than ±30 m | T16–T21 (nearest places) | PASS |
| GPS lost during guidance, then back | GPS | Guidance waits and resumes | T26 (simulation) | PASS |
| GPS permission denied / unavailable | GPS | Start picked by hand, message shown | Code reviewed; not run in a browser this cycle | NOT TESTED |
| Navigation sends no position to the server | Privacy | No position in any request or URL | Code review (no request carries position) + CSP run | PASS |
| Simulation not in the production build | GPS | No simulation code in `dist/` | 0 matches in the production bundle | PASS |
| Arrival detection | Navigation | Within about 20 m, not at 40 m or with ±60 m GPS | T16–T21 (arrival) | PASS |
| Route finding speed | Performance | Fast enough for a phone | Median 0.4 ms, slowest 15 ms (laptop) | PASS |
| Guidance on real phones in Nashik | Navigation | — | Needs the field pilot | BLOCKED |

### River safety and trust levels (Module D)

| Test Case | Module | Expected Result | Actual Result | Status |
|---|---|---|---|---|
| Unbridged OSM footway across the river | River | Left out, reported | API check | PASS |
| Mapped footbridge | River | Kept, marked bridge | API check | PASS |
| Approved unbridged crossing (config) | River | Kept, with its review status | API check | PASS |
| Straight link across the river | River | Kept out of the pack | API check | PASS |
| Lane people added labelled "bridge" | River | Still kept out until an admin approves | API check (new) | PASS |
| Volunteer sets passage_kind "bridge" | River | Refused (422) | API check (new) | PASS |
| Admin approval of a straight line nobody walked | River | Still kept out | API check (new) | PASS |
| Admin approves a recorded walk across the river | River | Then included | API check (new) | PASS |
| A new walk across the river after approval | River | Approval taken back, out of the pack | API check (new) | PASS |
| OSM bridge closed and reopened from the obstacle screen | River | Stays a bridge, back in the pack | API check (new) | PASS |
| End stretch crosses the river | River | Kept out | API check (new) | PASS |
| Volunteer walk across the river | River | Out of the pack until an admin checks it | API check (new) | PASS |
| Real Nashik data: river crossings | River | Only on bridges | 30 crossings on bridges, 0 unsafe (graph check on a copy) | PASS |
| OSM re-import keeps people's lane settings | Trust | One-way, wall, walked shape kept | API check (new) | PASS |
| OSM re-import of a lane stored in the other direction | Trust | Direction kept (one-way never reversed) | API check (new) | PASS |
| Unverified never shown as verified | Trust | Dashed lines, trust labels | T27 + API trust checks | PASS |
| Simulated data never becomes verified | Trust | Saved as unverified; refused in production | API checks | PASS |
| Lanes verified on the ground | Trust | — | 0 of 2,475 walked | BLOCKED |

### SOS (Module F)

| Test Case | Module | Expected Result | Actual Result | Status |
|---|---|---|---|---|
| Send SOS online | SOS | SENT only after the server stored it | T32 + browser test | PASS |
| Send SOS offline | SOS | NOT SENT YET, saved on the phone | Browser test | PASS |
| Reconnect → delivered | SOS | SENT, then visible to the operator | Browser test | PASS |
| Retry on server error / 429 | SOS | Stays pending, retried | T32 | PASS |
| Duplicate prevention | SOS | One alert per client id | T32 + API checks (incl. simultaneous) | PASS |
| Operator acknowledges | SOS | Phone shows ACKNOWLEDGED with the message | Browser test + API | PASS |
| Operator resolves | SOS | Leaves the open list; cannot be acknowledged again | API check | PASS |
| Expired after 48 h; deleted after 7 days | SOS | Expired, then deleted | API checks | PASS |
| Wi-Fi login page answers 200 | SOS | Stays pending (not "sent") | T36 (new) | PASS |
| Proxy 403 page | SOS | Stays pending (not "refused") | T36 (new) | PASS |
| Phone storage fails | SOS | Alert still sent; screen says it was not saved | T36 (new) | PASS |
| Alert older than 24 h learns it expired | SOS | Shows EXPIRED | T36 (new) | PASS |
| More than 200 open alerts | SOS | All listed for operators | API check (new): 297 listed | PASS |
| Alert delivered late shows when "Send" was pressed | SOS | `asked_at` kept; a clearly wrong clock (future, years back) ignored | API check (new) | PASS |
| Not presented as 112 / 108 | SOS | Separate Call 112 / Call 108; "Setu alerts go to Setu volunteers…" | Screen text checked | PASS |
| SOS with real operators on duty | SOS | — | Needs authority staffing | BLOCKED |

### Ask Setu and report helper (Module G)

| Test Case | Module | Expected Result | Actual Result | Status |
|---|---|---|---|---|
| "nearest toilet" | Ask Setu | Nearest toilet, or honest "none in the data" | "none" with the test data | PASS |
| "nearest hospital" | Ask Setu | Nearest open medical place first | T33 | PASS |
| "where is the temple?" / "is the ghat open?" | Ask Setu | Place / status with expiry | T33 | PASS |
| "fire", "injured person", "drowning" | Ask Setu | Emergency box first | T33 | PASS |
| "आग", "बचाओ", "मदत करा" | Ask Setu | Emergency box first | T33 | PASS |
| आगीत, बुडाला, "can’t breathe", snake bite, खतरा, धोका, bachao, aag lagi… | Ask Setu | Emergency | T37 (13 phrasings, new) | PASS |
| "आगे…", "घाट सापडत नाही", "help desk", "dangerous to bathe at night?", "snake charmers", "धोका आहे का", "क्या यहाँ खतरा है" | Ask Setu | Not an emergency | T37 (new) | PASS |
| Works offline, no external AI | Ask Setu | No network use | Browser test (airplane mode) + code review | PASS |
| Report helper fields | Report helper | Age, clothing, place, time, name, phone | T34 + browser test | PASS |
| "about 8 years old" not a time; नाव ("boat"); Devanagari digits | Report helper | Correct fields | T37 (new) | PASS |
| Native-speaker check of the Hindi/Marathi words | Ask Setu | — | Needs native speakers | BLOCKED |

### Volunteer, operator, admin and permissions (Modules H, J)

| Test Case | Module | Expected Result | Actual Result | Status |
|---|---|---|---|---|
| Volunteer sign-in | Auth | Works with phone + PIN | Browser test + API | PASS |
| Wrong PIN ×5 → paused | Auth | Paused 15 min, same answer as an unknown number | API check (updated) | PASS |
| 20 parallel wrong PINs | Auth | At most 5 checked, all refused | 5 checked (API check, updated) | PASS |
| 30 failures from one network | Auth | 429 for 15 min | API check | PASS |
| Expired / signed-out token | Auth | 401 | API checks | PASS |
| Anonymous on restricted endpoints | Permissions | 401 | API checks | PASS |
| Volunteer on operator/admin endpoints | Permissions | 403 | API checks | PASS |
| Record a walk offline, sync | Volunteer | Kept, then sent once | Browser test | PASS |
| Close a lane | Volunteer | Live at once (no republish) | API check | PASS |
| A late walk does not reopen a closed lane | Volunteer | Still closed | API check (new) | PASS |
| Wi-Fi login page in the outbox | Volunteer | Change kept | T36 (new) | PASS |
| Volunteer cannot pick an OSM-… code | Volunteer | 400 | API check (new) | PASS |
| Operator SOS inbox, operations summary | Operator | Listed, counts only | Browser test + API | PASS |
| Operator quick replies in the visitor's language | Operator | A known reply is translated; typed text shown as typed | T39 (4 checks) | PASS |
| Register a place before saved places have loaded | Volunteer | Saving disabled until loaded; failure explained | Code + browser test (offline register step) | PASS |
| Reopen a closed map-road lane from the volunteer screen | Volunteer | Listed and reopenable | Type check; server path covered by API map-lane checks; not walked through in a browser | NOT TESTED |
| Touch targets ≥ 44 px, turn instructions announced, sign-in dialog focus | Accessibility | — | CSS/ARIA changes; needs a screen reader and real phones to confirm | BLOCKED |
| Lost-person case flow | Operator | New → reunited → closed, history | Browser test (cases are off in production) | PASS |
| Admin graph check, trust levels, facility status, boards | Admin | Work, logged | API checks | PASS |
| Publish and roll back | Admin | New version; rollback keeps live closures | API checks | PASS |
| Audit log has no SOS note or location | Admin | None | API check | PASS |

### Backend, database, input validation (Module I)

| Test Case | Module | Expected Result | Actual Result | Status |
|---|---|---|---|---|
| All API checks on PostgreSQL 16 | Database | Same as SQLite | 216 / 216 | PASS |
| Old database upgrades without loss | Database | Columns added, data kept, repeatable | `check_migration.py` All OK | PASS |
| New `sos_alerts.asked_at` column on old databases | Database | Added automatically | `_ensure_columns`; migration check and Postgres run | PASS |
| NaN / Infinity coordinates | Validation | 422, not saved, no 500 | API check (new) | PASS |
| Malformed lane path | Validation | 422; the pack keeps working | API check (new) | PASS |
| Admin inputs out of range | Validation | 422 | API check (new) | PASS |
| Body larger than 4 MB | Validation | Refused | API check | PASS |
| Duplicate offline sends (Idempotency-Key) | Database | Saved once | API checks | PASS |
| Backup → restore | Database | All rows back | Phase 8 run (`TESTING_AND_QA.md`); not re-run | NOT TESTED |

### Languages, security, end-to-end (Scenarios 1–8)

| Test Case | Module | Expected Result | Actual Result | Status |
|---|---|---|---|---|
| Scenario 1, new pilgrim: language, map, search, route, guide, arrive | E2E | Works | Browser test (language, map, search, route) + T26 simulated walk to arrival | PASS |
| Scenario 2, offline pilgrim | E2E | Works with servers stopped | Browser test (airplane mode) | PASS |
| Scenario 3, wrong route | E2E | GPS filtered, reroute | T26 + T38 | PASS |
| Scenario 4, emergency offline then online | E2E | Pending → sent → operator sees it → acknowledged | Browser test | PASS |
| Scenario 5, volunteer walk and closure, sync | E2E | Kept offline, sent once; closure live | Browser test + API | PASS |
| Scenario 6, admin review, graph check, publish, rollback | E2E | Works | API checks (no browser walkthrough of the admin screens) | PASS |
| Scenario 7, English / Hindi / Marathi | E2E | All keys in all languages; screens switch | tsc key parity + browser language switch | PASS |
| Scenario 7, native wording quality | E2E | — | Needs native speakers | BLOCKED |
| Scenario 8, security: unauthorised access, wrong PIN, roles, expiry, no data leak | E2E | Refused / minimal data | API checks | PASS |
| Production CSP: nothing blocked except the test probe | Security | Only the probe blocked | Browser test | PASS |
| Professional penetration test | Security | — | Not performed | BLOCKED |
| Load test on the production server | Performance | — | No server chosen yet | BLOCKED |

## 3. Failures during this cycle

| What | Cause | Resolution |
|---|---|---|
| One new API check failed once (`OSM-…` code: 422 instead of 400) | **The test** omitted a required field (`local_name`), so the request was refused for that reason | The test request was fixed. The check then passed (400) |

No other test failure occurred. The independent review of the fixes found 6 more problems (B-29 to B-34 in the code review report). Each got a fix and a regression test, and all suites were run again afterwards. No safety rule or validation was weakened to make a test pass.

## 4. Not tested / blocked: what is needed

- **Real phones:** Android Chrome, iPhone Safari, installed PWA, storage limits, compass, GPS permission prompts.
- **Field pilot in Nashik:** walk and verify lanes (0 of 2,475 verified), GPS near the river and in crowds, guidance end to end.
- **People:** native Hindi/Marathi review; operators on duty for SOS; authority approvals.
- **Security and scale:** a professional penetration test; a load test on the chosen server.
