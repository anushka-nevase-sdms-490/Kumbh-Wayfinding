# Production deployment

One server runs three containers: **Postgres**, the **API** (FastAPI) and
**Caddy**, which gets the HTTPS certificate by itself, serves the PWA and
passes `/api` to the API. Phones need HTTPS for GPS and offline mode.

## You need

- A server in India (2 vCPU, 4 GB RAM is enough) with Docker, ports 80 and 443 open.
- Node 20 and npm on the server, for the offline map step below (or copy the map files, see below).
- A domain (e.g. `setu.example.in`) whose DNS **A record** points to the server.
- Somewhere to copy backups off the server.

## First start

```bash
git clone <repo> /opt/setu && cd /opt/setu
cd frontend && npm ci && npm run map:fetch && cd ..   # offline map → frontend/public/map
cd deploy
cp .env.example .env        # fill in SETU_DOMAIN, ACME_EMAIL, SECRET_KEY, POSTGRES_PASSWORD
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec api python scripts/manage_volunteers.py add 9XXXXXXXXX "Admin name" --role admin
docker compose -f docker-compose.prod.yml exec api python scripts/import_osm.py all   # places, water, roads
docker compose -f docker-compose.prod.yml exec api python scripts/validate_graph.py   # must end with OK
docker compose -f docker-compose.prod.yml exec api python scripts/publish_data.py "First Nashik data"
```

Production publishes data by hand (`PUBLISH_MODE` defaults to `manual` when
`SETU_ENV=production`): new places, lanes and imports reach phones only after
an admin publishes (admin map → Data versions, or `publish_data.py`), while
lane closures and rejections are always live. See `docs/ADMIN_WORKFLOW.md`.

**The offline map** (`frontend/public/map/`, about 15 MB) is not in git.
`npm run map:fetch` downloads the Protomaps build pinned in
`frontend/scripts/fetchOfflineMap.ts` (`20261029`). Protomaps doesn't keep daily
builds forever, so if the download fails, either copy the folder from the
development machine (`rsync -a frontend/public/map/ server:/opt/setu/frontend/public/map/`),
or run `npm run map:fetch latest` (a newer map: check the tiles; phones
download the map again). Without it the build still succeeds, but the app has
**no offline map** ("Download offline map" has nothing to save): check that
`frontend/public/map/meta.json` exists before building.

Never build the public site with `VITE_ENABLE_SIMULATION=1`: that build lets
anyone fake their position with `?sim=1` (for demo builds only; see
`docs/NASHIK_SIMULATION_MODE.md`). The normal build contains no simulation code.

The OSM downloads (including the water data the river checks need) are kept in
the `setu_osm` volume, so they survive updates. Without water data the API logs
a warning and `validate_graph.py` fails — do not open the site until it passes.

The API **refuses to start** with unsafe settings (`SETU_ENV=production`): the
default or a short `SECRET_KEY`, `CORS_ORIGINS=*`, or SQLite.

## Check it

```bash
curl -sI https://$SETU_DOMAIN/sw.js | grep -i cache-control      # no-cache
curl -sI https://$SETU_DOMAIN/assets/<any file> | grep -i cache  # immutable
curl -sI https://$SETU_DOMAIN/map/tiles/0/0/9.mvt | head -1      # 404 (missing tile, not index.html)
curl -s  https://$SETU_DOMAIN/api/pack/latest                     # version info
```

Then on a phone: open the site, add it to the home screen, tap **Download
offline map**, switch on airplane mode, and check the app, map and route still work.

### QR boards

Print boards from the public site (`https://<SETU_DOMAIN>`): a board's QR code holds the address of the page it was printed from. A build for another host can set `VITE_PUBLIC_ORIGIN=https://<SETU_DOMAIN>` so boards always point to the public site; the admin screen warns when a board would point to a test address (localhost, a private IP, ngrok).

## Backups

`deploy/backup.sh` dumps the database (kept 14 days). Run it nightly from cron
and copy `deploy/backups/` off the server. To restore, stop the API first so
nothing writes during the restore:

```bash
docker compose -f docker-compose.prod.yml stop api
docker compose -f docker-compose.prod.yml exec -T db pg_restore -U setu -d setu --clean --if-exists < backups/setu-YYYY-MM-DD-HHMM.dump
docker compose -f docker-compose.prod.yml start api
```

Pack files are rebuilt from the database on the first request.

## Update

```bash
git pull && cd deploy && docker compose -f docker-compose.prod.yml up -d --build
```

Phones see "A new version of the app is ready" and reload when convenient.
New tables and columns are added once at start, before the API workers
(`python -m app.migrate`, using `app/db.py` `_ensure_columns`).
