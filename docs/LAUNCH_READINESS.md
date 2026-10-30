# Launch readiness (Phase 8c)

Status on 2026-10-30. **Nothing is deployed.** The software for all 8 phases
is built and tested on the development machine in Pune. What remains needs
people, places and decisions that software can't supply: the field, real
phones, the Mela authority, a lawyer and a server.

## Verdict

| Use | Ready? | Blocking items |
|---|---|---|
| **Field pilot** (volunteers and invited testers, Ramkund–Panchavati) | **Yes, once 4 owner items are done** | Volunteer accounts and consent wording; a decision on the 5 unbridged crossings; a native-speaker read of the Hindi and Marathi; a laptop (`./start.sh`) or small server |
| **Public launch** (pilgrims) | **No** | Everything marked ❌ below, in particular field-verified data, real-device tests, the privacy notice / DPDP review, a security assessment, a load test, authority approvals |

## 1. Data still unverified

| Data | Today | Needed |
|---|---|---|
| Places | **156** in the visitor data, all imported from OpenStreetMap; **0** checked on site | Volunteers check each pilot place (the app marks them "checked on site" with the date) |
| Walking lanes | **2,475**, all from OSM map roads; **0** walked by volunteers | Volunteers walk the pilot lanes; the guide shows unwalked parts dashed with a warning |
| River crossings | 30 on bridges (safe); **5 unbridged** near Ramkund blocked from routing | Decide each one on site; approve real ones in `backend/config/approved_crossings.json` |
| Possible duplicates | 9 pairs (e.g. Kalaram Mandir / Sri Kala Rama Swamy Temple) | Resolve on site or with the authority list |
| Facility open/closed status | The feature works; no statuses set | Operators set them during the Mela; they expire automatically |
| QR boards | The feature works; **0 boards** created | Admin creates codes, prints them; installed with permission (below) |
| Safety tips in "Ask Setu" | General advice, labelled "not official" | Replace with the authority's official text |

**Authoritative data needed** from the Mela authority / police: official facility list (medical posts, help desks, Lost & Found, police posts, toilets, water); Snan-day road closures and one-way systems; ghat designations; official emergency numbers if different from 112/108.

## 2. Testing still to do

| Test | Status | Notes |
|---|---|---|
| Automated (phone logic, API, browser smoke under the production CSP) | ✅ | 198 phone-logic checks, 200 API checks (SQLite and Postgres), 30 browser checks (`TESTING_AND_QA.md`) |
| End-to-end plan (20 scenarios) | ✅ written, 🟡 partly run | [E2E_TEST_PLAN.md](E2E_TEST_PLAN.md): which are automated, simulated, remote review, device or field |
| **Real phones** (Android Chrome, iOS Safari, installed PWA) | ❌ | GPS, compass, storage eviction, service worker, `tel:` links, vibration |
| **Field** (on site in Nashik) | ❌ | GPS in crowds and near water; walkability; QR boards in daylight |
| **Load test** | ❌ | On the real server: pack check (cached 30 s) and pack download for the expected number of phones; SOS bursts |
| **Accessibility review** | ❌ | Contrast, large text, screen readers (TalkBack / VoiceOver), touch targets; elderly pilgrims |
| **Native Hindi and Marathi review** | ❌ | Including the emergency words in "Ask Setu" and regional phrasing |
| **Professional security assessment** | ❌ | The Phase 8 review is a developer/supervisor review, **not a penetration test** |

## 3. Privacy and approvals

| Item | Status | Where |
|---|---|---|
| Privacy notice (en/hi/mr), DPDP review, data fiduciary named | ❌ | [PRIVACY_DPDP_CHECKLIST.md](PRIVACY_DPDP_CHECKLIST.md) |
| Volunteer consent wording (GPS walks) | ❌ | Before the pilot |
| **Lost-person cases** switched on (`CASES_ENABLED=1`) | ❌ off | Needs the authority's approval of the process and children's-data handling |
| **SOS** going to Setu operators (not 112) | 🟡 | Who staffs the console, during which hours, and how they hand over to police/medical teams must be agreed with the authority. The app says clearly that SOS is not 112 |
| **QR board installation** | ❌ | Permission for each location (authority / landowner), board material and size, who replaces damaged boards |
| Authority approval to publish Setu routes to pilgrims | ❌ | Ideally a written approval of the data and closure process |

## 4. Server, monitoring and backups

| Item | Status | Notes |
|---|---|---|
| Server and domain | ❌ | 2 vCPU / 4 GB / 40 GB for the pilot (estimate); Indian region; `DEPLOYMENT_READINESS.md` |
| Production configuration | ✅ | `deploy/`: Caddy (HTTPS, security headers, **tightened CSP**), Postgres 16, migrate-once, unsafe-setting refusal |
| Monitoring and alerting | ❌ | At least: uptime check on `/health`, disk space, container restarts, **unacknowledged SOS older than 5 minutes** (the operations summary has the count; an alert needs a monitor) |
| Backups | 🟡 | `deploy/backup.sh` (nightly, 14 days); **restore tested** locally on Postgres 16. Needed: off-server copy, encryption, a restore tried on the real server |

## 5. Deployment checklist

1. [ ] Owner approves deployment (explicitly; not part of the approval of 2026-10-30).
2. [ ] Server and DNS ready; `deploy/.env` filled (strong `SECRET_KEY`, `POSTGRES_PASSWORD`, domain, ACME email).
3. [ ] Tag the release in git (`git tag setu-pilot-1`).
4. [ ] `docker compose -f deploy/docker-compose.prod.yml up -d --build`; the API refuses to start on unsafe settings: fix and retry.
5. [ ] First admin account (`manage_volunteers.py add … --role admin`; PIN typed in).
6. [ ] Import → `validate_graph.py` (must end with OK) → publish the first data version.
7. [ ] Check: HTTPS, headers (`curl -I`), `/docs` returns 404, a phone installs the app, downloads the map and routes in airplane mode.
8. [ ] Operator accounts; SOS console open on a staffed device; a test SOS sent and acknowledged.
9. [ ] Backups cron + off-server copy; monitoring live.
10. [ ] `CASES_ENABLED` left **off** unless approved.

## 6. Rollback procedure

| Problem | Action | Time |
|---|---|---|
| **Bad data** (wrong lane, wrong place) | Admin map → Data versions → "Put this version on phones" on the last good version. Closures and rejections stay live | Minutes; phones follow on their next check: every 3 min while guiding, and when the app is opened, comes back on screen or the connection returns |
| One dangerous lane | Block it (volunteer/admin) — live on the server at once, no publishing needed | Seconds on the server; a phone that is guiding gets it within about 3 minutes and reroutes with "Route updated with the latest information" (tested in the browser). Phones offline don't, so also tell people on the ground |
| **Bad app release** | `git checkout <previous tag>` → rebuild → up. Phones show "A new version is ready" (never during guidance) | ~10 min |
| Database damaged | Stop the API; restore the latest dump (`deploy/README.md` "Backups"); start; packs are rebuilt from the database | ~30 min (dump size dependent) |
| Server lost | New server → deploy → restore dump. **Phones keep working offline** with their saved data in the meantime | Hours |

## 7. Incident response

| Incident | First steps | Who |
|---|---|---|
| **Wrong route reported as dangerous** | Block the lane at once; then roll back the data if it came from a release; note it in the audit log | Any volunteer (block), admin (rollback) |
| **SOS console down or unstaffed** | Visitors' phones keep alerts as "not sent yet" and always show "Call 112"; restore the console; announce on PA/radio that 112 is the emergency number | Operations lead |
| **SOS flood / abuse** | Alerts marked "possible flood" sort below others; acknowledge and resolve in bulk; nothing is refused by address | Operators |
| **Suspected data breach** (stolen phone of an operator, leaked token, server compromise) | Disable the account (revokes all its tokens); rotate `SECRET_KEY` if the server is affected (signs everyone out); preserve logs; the data fiduciary decides on notifying the Data Protection Board and the people affected | Admin + data fiduciary (named before launch) |
| Server overloaded | Phones keep working offline; scale the server; the pack check is cached | Developer / host |
| Map or pack corrupt on phones | The app detects damaged copies, removes them and downloads again; a bad pack is rolled back | Automatic + admin |

Keep a contact sheet (names and phone numbers of the operations lead, admin, developer, authority liaison) **outside the app** and printed at the control room.

## 8. Training

| Who | What | Material |
|---|---|---|
| Volunteers | Sign in, register a place, walk a lane, block/reopen a lane, confirm visitor reports, offline queue | `VOLUNTEER_WORKFLOW.md` |
| Operators | SOS console (acknowledge with a message, resolve, flood marks), facility status with expiry, operations summary; cases only if enabled; the report helper's suggestions are **only suggestions** | `SOS_AND_LOST_PERSONS.md`, `ASSISTANT_AND_OPERATIONS.md`, `QR_BOARDS_AND_FACILITY_STATUS.md` |
| Admins | Data checks, publishing and rollback, trust levels, boards and printing, accounts | `ADMIN_WORKFLOW.md`, `QR_BOARDS_AND_FACILITY_STATUS.md` |
| Everyone | SOS is **not** 112; never mark a lane safe without walking it; never share case details outside the console | This document |

A 1-hour session per role before the pilot, with a dry run: one SOS, one lane block, one rollback.

## Owner actions, in order

1. Read and approve this report; decide pilot dates and zone.
2. Native-speaker read of Hindi and Marathi; volunteer consent wording; volunteer accounts.
3. Decide the 5 unbridged crossings and the 9 duplicates (with someone who knows the ghats).
4. Run the field pilot (`TESTING_AND_QA.md` checklist and the device/field rows of `E2E_TEST_PLAN.md`).
5. Before launch: privacy notice + lawyer, authority approvals (SOS, cases, QR boards, data), security assessment, load test, accessibility review, server/monitoring/backups, then **approve deployment**.
