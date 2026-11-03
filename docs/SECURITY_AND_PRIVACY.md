# Security and privacy

How Setu protects visitors, volunteers and the map data. It covers the code in
this repository and its production setup (`deploy/`). **No external security
audit or penetration test has been done.** That is recommended before the
public launch.

## Who uses what

| Who | Signs in | Can |
|---|---|---|
| Visitor | No (no account) | Read the published pack; report "this lane is blocked" (rate-limited; changes nothing until a volunteer confirms); send an SOS alert and see its state |
| Volunteer | Phone + 6-digit PIN | Register places, walk lanes, set walk directions, block/reopen lanes, confirm or reject visitor reports, read the full database |
| Operator | Phone + 6-digit PIN, `operator` role | Everything a volunteer can, plus: the SOS console, lost-person cases (when enabled), facility open/closed status, the operations summary |
| Admin | Phone + 6-digit PIN, `admin` role | Everything a volunteer can, plus: admin map, trust levels, data checks, audit log, publish / roll back, add places and lanes directly |

### Every endpoint

The access levels below were listed from the routers' own dependencies (re-listed in Phase 8, 2026-10-30: 45 endpoints).

| Access | Endpoints |
|---|---|
| **Public** (9) | `GET /health`; `GET /api/pack/latest`, `/api/pack/latest/json`, `/api/pack/download/{version}` (published data only); `POST /api/reports` (visitor report); `POST /api/auth/login`, `/api/auth/logout`; `POST /api/sos` (SOS alert); `GET /api/sos/{client_id}` (that alert's state only: no note or location; the id is a random UUID made on the phone, 122 random bits) |
| **Volunteer** (12) | `GET /api/auth/me`; `GET /api/nodes`, `/api/nodes/{code}`, `/api/edges`, `/api/volunteer/nodes/{code}` (the whole database); `POST /api/volunteer/register`, `/record-path`, `/path-heading`, `/edge-status`; `GET /api/reports`; `POST /api/reports/{id}/confirm`, `/reject` |
| **Operator** (10) | `POST /api/admin/place-status`; `GET /api/ops/sos`, `POST /api/ops/sos/{id}/ack`, `/resolve`; `GET /api/ops/summary`; `GET`/`POST /api/ops/cases`, `GET`/`PUT /api/ops/cases/{ref}`, `POST /api/ops/cases/{ref}/status` (cases answer 404 unless `CASES_ENABLED`) |
| **Admin** (15) | `POST /api/nodes`, `/api/edges`, `/api/sync`, `/api/pack/build`; `/api/admin/*`: overview, graph-report, releases, publish, rollback, audit, verify, place-access, board, board/retire, boards |

The checks confirm that:
- every write needs a sign-in, except visitor reports;
- volunteers get 403 on admin endpoints;
- an expired or signed-out token gets 401.

## Sign-in

- **PINs:** stored as scrypt hashes (N=2¹⁴, r=8, p=1, 16-byte salt), compared in constant time. An unknown phone number is checked against a dummy hash, so the response time doesn't reveal which numbers exist. Easy PINs (000000, 123456, all one digit…) are refused when set.
- **Lock-out:** after 5 wrong PINs the account is locked for 15 minutes. The counter is updated atomically, so parallel guesses can't get past it.
- **Per network address (Phase 8):** after 30 failed sign-ins from one address in 15 minutes, further attempts from it get 429 until the window passes. This stops one device trying a few PINs on many phone numbers (which the per-account lock-out alone doesn't). Only failures count; addresses are stored as a keyed hash and deleted after a day (`login_failures`). Production trusts the forwarded address from Caddy only (`FORWARDED_ALLOW_IPS`), so the limit sees the real phone's address. **Trade-off:** volunteers behind one carrier address share the 30; at shift start with hundreds of volunteers that is still well above normal typing mistakes, but watch it in the pilot.
  - **Since the code review (2026-11-03)** a locked account gets exactly the same answer as an unknown number or a wrong PIN (401, same text, same timing), so the answer no longer reveals which numbers are staff accounts. Anyone can still pause an account for 15 minutes with 5 wrong PINs (a lock-out trade-off; `manage_volunteers.py enable` lifts it).
- **Tokens:** 32 random bytes, of which only the SHA-256 hash is stored. They last one shift (16 h). Sign-out revokes the token, and disabling a volunteer revokes all of theirs.
- **On the phone:** the token is kept in `localStorage`. The production CSP allows scripts from this site only, which limits the damage an injected script could do; React escapes all text, and nothing is rendered as raw HTML.
- **Accounts:** made only with `scripts/manage_volunteers.py`; the PIN is typed in, never put on the command line. There is no self-sign-up, and **no test or demo accounts** exist in production; the checks create theirs in a temporary database.

## What data is kept

| Data | Where | Personal? | Kept |
|---|---|---|---|
| Volunteer name, phone number, PIN hash, role | `volunteers` | Yes (staff) | While the account exists |
| Sign-in tokens (hash only) | `auth_sessions` | Linked to a volunteer | Deleted 7 days after expiry |
| Places and lanes | `qr_nodes`, `edges` | No | Permanent; rejected rows are kept for the record |
| **Walked tracks** (GPS points **with timestamps**) | `edges.path_json` | Yes: when a volunteer was where | Permanent, **staff-only** (never in the public pack) |
| Who changed what (name, time, sentence) | `audit_log` | Staff names, **never phone numbers** | Permanent |
| Visitor reports | `block_reports` | Pseudonymous: SHA-256 of (network address + server secret + day) and of (random phone id + secret) | **Deleted 30 days after they are settled** |
| Offline-queue keys | `client_actions` | Linked to a volunteer | 7 days |
| Published data versions | `dataset_releases` | No (same as the public pack) | Newest 20 |
| **SOS alerts**: kind, short note, position (if given), nearest place, language, pseudonymous phone and network hashes, operator who acknowledged | `sos_alerts` | **Yes** (position and note at a moment of need) | Expired after 48 h unacknowledged; **deleted 7 days** after resolved/expired |
| **Lost-person cases**: reference, minimal description, approximate age, last-seen place/note, reporter contact (masked in lists for children), status history | `lost_cases`, `lost_case_events` | **Yes** (may concern children) | Off in production until approved; **deleted 30 days after closing**, with their history |
| Failed sign-ins (keyed hash of the address, time) | `login_failures` | Pseudonymous | 1 day |

**Visitors' locations never leave the phone.** Finding where you are, the route and guidance all run on the phone. A visitor report sends only the lane (its two places) and the random phone id: no position, no name, no account.

**The public pack has only what navigation needs.** Walked tracks are reduced to positions, with no timestamps or compass readings. Volunteers' free-text notes, verification times and record timestamps are removed. The checks verify this.

**What stays on a phone:**
- the pack and the map (IndexedDB / Cache Storage);
- the language;
- a random phone id for reports;
- for volunteers: the sign-in token and changes waiting to be sent (`setu-outbox`, which can include their own GPS walks).

Signing out removes the token. Waiting changes stay until they are sent or cancelled, so another volunteer on a shared phone can't lose them.

**No third parties:**
- no analytics or advertising;
- no crash-reporting service;
- no external map or tile servers (the tiles are on our server);
- **no Google Fonts:** the UI fonts are served from our own site (`@fontsource`, which also makes them work offline). The built app contains no third-party URLs.

## Transport and browser protection (production, `deploy/Caddyfile`)

- **HTTPS only**, with automatic Let's Encrypt certificates, and HSTS for 1 year.
- **Content-Security-Policy:** `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; …`. Pages can't be framed; scripts, styles, fonts and requests stay on this site. **Phase 8:** the unused Google Fonts domains were removed, and the browser smoke test now serves the app with this exact policy (read from `deploy/Caddyfile`) and fails on any violation; a whole run blocks nothing (a deliberate probe proves the recorder works).
- **Other headers:** `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a `Permissions-Policy` allowing only geolocation (self).
- **CORS:** the API refuses to start in production with `CORS_ORIGINS=*`. Sign-in uses a bearer token, never cookies, so CSRF doesn't apply.
- **Proxy:** the API runs behind Caddy. Its port is not published outside Docker, so only Caddy can reach it, which is why trusting forwarded addresses (`FORWARDED_ALLOW_IPS`) is safe.

## Production safety switches

The API **refuses to start** with `SETU_ENV=production` if any of these hold:
- the default or a short `SECRET_KEY`;
- `CORS_ORIGINS=*`;
- SQLite.

In production:
- **API docs** (`/docs`, `/redoc`, `/openapi.json`) are switched off, since they list every admin endpoint.
- **Simulation:** the normal build contains no simulation code. The server **refuses simulated positions with 403**, and in development saves them only as `unverified` with a note.
- **Publishing is manual by default:** new data reaches visitors only after an admin publishes; closures and rejections are always live (`ADMIN_WORKFLOW.md`).
- **Secrets:** come from environment variables (`deploy/.env`, not in git). `.env`, databases and OSM downloads are git-ignored, and a scan of the tracked files found no keys or passwords.

## Input limits and abuse

- **Request bodies:** over 4 MB they are refused with 413, before or while they are read, including bodies sent in chunks.
- **Field limits:** a walk has at most 5,000 GPS points (about an hour), and a batch sync at most 5,000 places / 10,000 lanes. Text fields have maximum lengths matching the database columns (an over-long value gets 422, not a database error), and coordinates are range-checked.
- **Visitor reports:** 5 per phone per hour, and 60 per network address per hour (many phones share one mobile address). They expire, and change nothing until a volunteer confirms.
- **SOS alerts:** 5 per phone per hour (429 with a message to call 112). Many alerts from one network address are **marked "possible flood" for operators but never refused** (carrier addresses are shared). Resends with the same id are idempotent.
- **Volunteer resends:** use an `Idempotency-Key`, so they can't apply a change twice, and keys are tied to the volunteer.
- **Database queries:** all go through SQLAlchemy (no hand-written SQL with user input). Pack downloads are looked up by version in the database, never by file path.

## Logs

- **Never logged:** PINs and tokens. Server errors return no stack traces.
- **Logged:** the API's access log (uvicorn, in the container log) records the client address and the request path.
  - Since Phase 4, **no position goes into a URL**: the volunteer report list is sorted on the phone, not with `?lat=&lon=`.
- **Caddy** has no access log configured.

## Found and fixed in Phase 4 (2026-10-30)

| Finding | Risk | Fix |
|---|---|---|
| `/api/nodes`, `/api/edges`, `/api/volunteer/nodes/{code}` were public and returned the whole database, including **unpublished** and **rejected** data | Bypassed publishing and rejection; exposed volunteer walk timestamps | Volunteer sign-in required; visitors use only the published pack |
| The public pack contained walked tracks **with timestamps**, plus volunteers' notes and record times | Showed when a volunteer was where | The pack keeps positions only; notes and times removed |
| UI fonts loaded from Google Fonts | Every visitor's address went to Google; no fonts on an offline first visit | Self-hosted fonts, precached |
| The volunteer's position was sent in a URL (`/api/reports?lat=&lon=`) | Positions in server logs | Distances worked out on the phone |
| No limit on request size, walk length or some text fields (the blocked-lane note column holds 64 characters, but the app allowed any length) | Memory exhaustion; a server error on Postgres | 4 MB body limit (also chunked); 5,000-point walks; sync caps; text limits matching the columns; a 64-character limit on the note field in the app |
| API docs public in production | Listed every admin endpoint | Off in production |
| Visitor reports kept forever | Pseudonymous ids kept longer than needed | Deleted 30 days after settling |
| The API checks downloaded data from the public Overpass server | Tests depended on an outside service | Fixture added; the network is blocked during the checks |
| `./start.sh` put the Vite **dev server** on the ngrok link and the local network by default | Its path-traversal advisory could expose files on the developer's machine | `start.sh` serves a built copy (`vite preview`); dev server only with `FRONTEND_MODE=dev`, on 127.0.0.1, no tunnel. Verified: dev-only paths (`/@vite/client`, `/@fs/…`, `/src/…`) return only the app page; dev mode is unreachable from the network |

## Phase 8 review of the new features (2026-10-30)

A code review by the developer and the project's supervisor agent, **not a professional security assessment or penetration test**.

| Area | Checked | Result |
|---|---|---|
| Authorization | Every endpoint's access level re-listed from the code (table above); operator-only and admin-only checks in the API suite | Volunteers get 403 on operator and admin endpoints; operators 403 on admin; cases 404 when switched off |
| Session management | 16 h tokens, hash-only storage, revocation on sign-out and on disabling | Unchanged; checks pass |
| Rate limiting | Per account (5), **per network address (30 / 15 min, new)**, SOS per phone (5 / h), SOS flood marking, visitor reports | New checks: 30 failures → 429; sign-in works again after the window |
| API validation | Pydantic limits on every new body (SOS note 280, case fields, board codes, status values); unknown values → 422 | Checks pass |
| SQL injection | All queries through SQLAlchemy; the only raw SQL is fixed migration text from code constants | No user input reaches raw SQL |
| XSS | React escapes all text; no `dangerouslySetInnerHTML`; the one `innerHTML` is a fixed error string; CSP `script-src 'self'` | Smoke run under the production CSP blocks nothing |
| CSRF | Bearer token in a header, no cookies | Not applicable |
| File uploads | None (the old audit-photo table was removed in Phase 5) | Nothing to review |
| Sensitive data exposure | The public SOS state shows no note or location; the operations summary returns counts only; audit entries for SOS and cases have no notes, positions or contacts; child contacts are masked in case lists | Checks assert each of these |
| Retention and deletion | `purge_expired`: SOS 48 h expiry, 7-day deletion; closed cases 30 days; failed sign-ins 1 day; visitor reports 30 days | Checks run the purge with shifted dates |
| Offline data on phones | Pending SOS alerts (`setu-sos`) and the volunteer outbox stay until sent; the published pack has no personal data | Shared volunteer phones: sign-out keeps waiting changes (by design, noted) |
| Audit log | SOS acknowledge/resolve, case status changes, facility status, boards, publishing | Staff names only, never phone numbers or case details |
| Error handling | No stack traces to clients; 4xx messages in plain words | Unchanged |
| Production configuration | Startup refuses weak secrets, `CORS_ORIGINS=*`, SQLite; docs off; cases off by default; **CSP tightened** | Done |
| Dependencies | `npm audit --omit=dev`: **0**; dev tools: 8 advisories (Vite 5 dev server); Python: `pip-audit` (below) | See next section |

The privacy and DPDP checklist is in [PRIVACY_DPDP_CHECKLIST.md](PRIVACY_DPDP_CHECKLIST.md). **Nothing in it is a claim of legal compliance**; it needs a lawyer's review.

## Code review (2026-11-03)

Security-relevant fixes from [CODE_REVIEW_AND_BUG_FIX_REPORT.md](CODE_REVIEW_AND_BUG_FIX_REPORT.md):

| Finding | Fix |
|---|---|
| A volunteer could label a lane "bridge" and get it past the river check | "Bridge" counts only from the OSM import; volunteer lane kinds are a fixed list; other lanes over water stay out, except a recorded walk an admin approved (a new walk across water takes the approval back) |
| NaN / Infinity passed range checks (a NaN in the pack makes it unreadable on every phone); a rejected NaN caused a 500 | All schemas refuse NaN/Infinity; ranges on walk points, heading, clearance, admin coordinates, lane length and cost; the 422 answer no longer echoes the input |
| A malformed lane path broke the pack for everyone | Paths must be a list of `{lat, lon}`; the pack builder tolerates damaged stored paths |
| A volunteer could create a place hidden from admins (code `OSM-J…`) | `OSM-…` codes are reserved for the map import |
| The "locked" answer revealed staff numbers | One answer for unknown / wrong / locked |
| The operator SOS list stopped at 200 (a flood could hide real alerts) | All open alerts listed; possible floods last |
| An SOS or a volunteer change counted as delivered on a Wi-Fi login page | Only a real Setu answer counts |

Checked and found correct: tokens (hashed, expiry, revocation), role checks on every endpoint (API level), SQLAlchemy bound parameters (no SQL built from input), no raw HTML rendering, no cookies (no CSRF surface), CORS without credentials, Caddy replacing client-sent `X-Forwarded-For`, `.env` and databases excluded from Docker images. **Not done:** a professional penetration test.

## Dependencies

- **Runtime packages** (what visitors' phones run): `npm audit --omit=dev` → **0 known vulnerabilities**.
- **Development tools:** 8 advisories (3 high), in Vite 5's **development server** and build helpers (brace-expansion, source-map-js, esbuild, workbox-build).
  - These don't affect the production site, which is static files served by Caddy.
  - The fix needs Vite 6+, a major upgrade, left as a later task.
  - **The dev server is never exposed:** `start.sh` serves a production build with `vite preview` (built files only) to the network and the ngrok link. The dev server runs only with `FRONTEND_MODE=dev`, bound to 127.0.0.1 and never tunnelled. Before this fix, `./start.sh` tunnelled the dev server by default, so anyone with the phone link could have tried the path-traversal advisory against the developer's files (`backend/.env`, the database).
- **Python:** no automated audit tool is installed. The dependencies are pinned in `backend/requirements.txt` and should be audited (e.g. `pip-audit`) before launch.

## Open items (owner decisions)

1. **Privacy notice and DPDP Act compliance:**
   - a short notice in the app (what visitors and volunteers share, as above);
   - consent wording for volunteers, whose GPS walks are recorded;
   - a named data controller (the Mela authority?) and a contact for requests.
2. **Professional security review or penetration test** before the public launch.
3. ~~Rate limit on sign-in by network address~~ **Done in Phase 8** (in the API). A Caddy-level request limit can still be added on the server.
4. ~~Tighten the CSP~~ **Done in Phase 8** (owner's blanket approval of 2026-10-30), and tested in the browser.
5. **Upgrade Vite to 6+** (dev-tool advisories) and run `pip-audit` on the backend.
6. **Two-person approval for publishing**, if the Mela authority wants it.
