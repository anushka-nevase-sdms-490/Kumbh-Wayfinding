# Deployment readiness

Status on 2026-10-30. **The code and production configuration are ready to
deploy. A server, a domain and several owner decisions are still needed.**
Nothing has been deployed. The work is committed on `kunal-offline-map-integration` (not pushed or merged). For the full go/no-go list see [LAUNCH_READINESS.md](LAUNCH_READINESS.md).

## Verdict

| Use | Ready? | What is missing |
|---|---|---|
| **Field pilot** (volunteers and invited testers, Ramkund–Panchavati) | **Almost.** It can run from a laptop with `./start.sh` and the ngrok link, or from a small server | A native Hindi/Marathi review; the volunteers' accounts and consent wording; a decision on the 5 unbridged crossings; a first real ngrok run with the new `start.sh` |
| **Public launch** (pilgrims) | **No** | Real-device and field testing; a privacy notice / DPDP; a security review; a load test; field-verified data; the server and domain |

## Ready (built and tested)

| Area | State |
|---|---|
| App | Offline PWA: map, routing and guidance on the phone; en/hi/mr; damage checks, storage-full handling, update prompt |
| Backend | FastAPI + Postgres; migrate-once at start; refuses unsafe production settings; API docs off in production |
| Production config (`deploy/`) | Caddy with automatic HTTPS and security headers (HSTS, CSP, nosniff, frame-ancestors none); Postgres 16; volumes for the database, packs and OSM data; `.env.example` |
| Data pipeline | OSM import of places, streets and water; river safeguards; `validate_graph.py` gate; trust levels |
| Admin | Data checks, audit log, **manual publishing with rollback** (closures and rejections always live) |
| Volunteers | Sign-in, offline queue with safe resend, hi/mr screens |
| Backups | `deploy/backup.sh` (nightly `pg_dump`, 14 days); **restore tested** on Postgres 16 |
| Security | Access review (45 endpoints, 4 roles), public data minimised, size limits, sign-in limits per account and per network address, tightened CSP tested in the browser, no third parties (`SECURITY_AND_PRIVACY.md`) |
| Visitor safety | QR boards, facility status with expiry, SOS with truthful states and an operator console, lost-person cases (off until approved), offline "Ask Setu" with emergencies first, operations summary |
| Tests | 198 phone-logic + 200 API checks (SQLite and Postgres) + 30 browser checks under the production CSP + migration check; no network needed (`TESTING_AND_QA.md`, `E2E_TEST_PLAN.md`) |

## Needed from the owner

| # | Item | Notes |
|---|---|---|
| 1 | **Push / merge** | The work is committed on `kunal-offline-map-integration`; pushing, a pull request and merging wait for the owner. Also decide whether to commit the offline map `frontend/public/map/` (about 15 MB; not in git today; Git LFS optional), so deployments don't depend on downloading it again (item 2) |
| 2 | **Server** | 2 vCPU / 4 GB RAM / 40 GB disk is plenty for the pilot (an estimate, not load-tested). Ubuntu with Docker, **plus Node 20 and npm** for the offline map step. Indian region preferred (latency, data residency). **The offline map:** `npm run map:fetch` downloads Protomaps build `20261029`, which is pinned in `frontend/scripts/fetchOfflineMap.ts`. Protomaps doesn't keep daily builds forever, so by deploy time it may fail. Then either copy `frontend/public/map/` from the development machine (`rsync`, about 15 MB), or run `npm run map:fetch latest` (a newer map: check the tiles; phones download the map again) |
| 3 | **Domain** | DNS A record to the server; Caddy gets the certificate automatically |
| 4 | **Secrets** | In `deploy/.env`: `SETU_DOMAIN`, `ACME_EMAIL`, `POSTGRES_PASSWORD`, and a random `SECRET_KEY` of at least 32 characters (the command in `.env.example` gives 64). CORS is set automatically from `SETU_DOMAIN` |
| 5 | **First admin account** | `manage_volunteers.py add … --role admin` (the PIN is typed in) |
| 6 | **First data** | Import → validate → **publish** (below) |
| 7 | **Backups off the server** | A cron for `backup.sh`, plus a copy of `deploy/backups/` to other storage |
| 8 | **Monitoring** | None is set up. At least an uptime check on `https://<domain>/health`, disk-space alerts, and an alert when an SOS stays unacknowledged for 5 minutes |
| 9 | **Decisions** | The 5 unbridged crossings; the 9 possible duplicates; Snan-day road closures; the privacy notice / DPDP and data controller; whether to commit the OSM snapshots (about 1 MB) |
| 10 | ~~Approve the CSP tightening~~ | **Done** (Phase 8, under the owner's approval of 2026-10-30) |
| 11 | **Operators and approvals** | Who staffs the SOS console; authority approval before `CASES_ENABLED=1`; QR board installation permissions |

## First deployment (summary of `deploy/README.md`)

```bash
git clone <repo> /opt/setu && cd /opt/setu
cd frontend && npm ci && npm run map:fetch && cd ..          # offline map files (needs Node 20; see item 2 if it fails)
cd deploy && cp .env.example .env                            # fill in the secrets (item 4)
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec api python scripts/manage_volunteers.py add 9XXXXXXXXX "Admin" --role admin
docker compose -f docker-compose.prod.yml exec api python scripts/import_osm.py all
docker compose -f docker-compose.prod.yml exec api python scripts/validate_graph.py    # must end with OK
docker compose -f docker-compose.prod.yml exec api python scripts/publish_data.py "First Nashik data"
```

**Then check:**
- the cache headers and the 404 for missing tiles (`deploy/README.md` "Check it");
- on a phone: open the site, add it to the home screen, download the map, turn on airplane mode, and check that a route works;
- sign in as the admin → Admin map → Data versions shows version 1 or 2, with nothing waiting.

## Updating and rolling back

| What | How |
|---|---|
| App update | `git pull && docker compose … up -d --build`. Phones show "A new version is ready" and reload when convenient (never during guidance) |
| **Bad app release** | `git checkout <previous tag>` and rebuild. Tag each release so this is possible |
| **Bad data** | Admin map → Data versions → "Put this version on phones" (closures stay live) |
| Database loss | Restore the latest dump (`deploy/README.md` "Backups"); packs are rebuilt from the database |
| New map tiles | `npm run map:fetch` and rebuild; phones download the new map into a new cache, and the old one is kept until the new one is complete |

## Before the public launch (go / no-go)

- [ ] Field pilot done (`TESTING_AND_QA.md` checklist), and the issues found fixed
- [ ] Pilot lanes walked by volunteers (today **0** lanes are field-verified)
- [ ] Native Hindi and Marathi review
- [ ] Privacy notice in the app, DPDP review, data controller named
- [ ] Professional security review / penetration test
- [ ] Load test on the real server (pack check and download for the expected number of phones)
- [ ] Accessibility check (contrast, large text, screen reader basics)
- [x] Sign-in rate limit by network address (Phase 8); a request-size limit in Caddy is optional (the API already refuses bodies over 4 MB)
- [ ] Monitoring and off-server backups working, with a restore tried on the server
- [ ] A release tagged in git
- [ ] Vite 6+ upgrade (dev tools); `pip-audit` was run in Phase 8 (no advisories in the pinned requirements)
- [ ] Privacy notice and the items in `PRIVACY_DPDP_CHECKLIST.md`; authority approvals (`LAUNCH_READINESS.md`)
