# Setu — Delivery Roadmap

Branch: `kunal-offline-map-integration`. Steps run in order; each one is
reviewed by the `kumbh-supervisor` agent before it is checked off.

> **Phase numbering:** the project now uses **8 phases** (see
> `docs/REMAINING_WORK_ROADMAP.md` and `docs/Setu_Development_Phases.pdf`).
> This file is the original detailed checklist. Each section below says which of
> the 8 phases it belongs to. Item numbers (1.1, 4.2, 5.4 …) are checklist ids
> and are kept, because other documents refer to them.

**Approach (decided):** no camera. Visitors navigate on an offline map using
GPS coordinates. Places and lanes come from volunteer on-site GPS and
OpenStreetMap.

## Bug fixes — Phase 1 (done)
- [x] 0.1 Audit: build, lint, routing tests, backend boot; list verified bugs (14 found)
- [x] 0.2 Fix critical/high bugs from the audit (+ mediums/lows; supervisor APPROVED)
- [x] 0.3 Fix remaining medium bugs worth fixing before new work (#5 current-leg-from-GPS and #8 GPS lock-out moved to 1.4)

## Offline map navigation core — Phase 1 (done)
- [x] 1.1 Remove the camera: AR guide, in-app QR scanner, `html5-qrcode`; start point = nearest place from GPS, or pick from list (QR removed completely — owner decision; supervisor APPROVED)
- [x] 1.2 MapLibre GL map with offline vector tiles (Nashik + Trimbakeshwar) in `frontend/public/map/` — `npm run map:fetch` (build pinned to 20261029; supervisor APPROVED)
- [x] 1.3 Map guide screen: live GPS dot, route line, places, turn instructions, distance left; arrow/compass removed; map lazy-loaded (supervisor APPROVED)
- [x] 1.4 GPS navigation logic: arrival radius sized for GPS (~15–25 m), off-route detection, reroute from nearest node; derive the current leg from live GPS (audit #5); stop a bad first GPS fix from blocking all later fixes (audit #8) (supervisor APPROVED)
- [x] 1.5 Volunteer registration always stores live on-site GPS (official place gives name/type only; warn if > 50 m from official point; ±30 m needed, accuracy stored) (supervisor APPROVED)
- [x] 1.6 Correct the 9 official coordinates from OpenStreetMap and record each source (6 from OSM; Kushavarta, Vilholi, Adgaon have no OSM feature → marked approximate, confirm on site; Sinnar Phata approximate too) (supervisor APPROVED)

## Truly offline — Phase 1 (done)
- [x] 2.1 Cache the offline pack: rebuild only on data change, `/api/pack/latest/json` serves the cached file
- [x] 2.2 Persist the pack on the phone and check for a newer version when online
- [x] 2.3 PWA: manifest + service worker caching the app shell, map tiles via "Download offline map" (the pack lives in IndexedDB, 2.2); works in airplane mode
- [x] 2.4 Non-empty bundled fallback pack — the 5 OSM-matched official places, no lanes (only Ramkund is in the pilot zone); built from `officialPlaces.ts` in `lib/fallbackPack.ts`

## Data and language — Phase 1 (done)
- [x] 3.1 OSM import script for permanent places (ghats, temples, hospitals, toilets, bus stands, parking) — `backend/scripts/import_osm.py places`; volunteers confirm a map place with "This is …"
- [x] 3.2 OSM footpath/road network as routable edges where no volunteer lane exists — `import_osm.py network` (pilot zone; re-run after new places); map lanes drawn dashed with a warning
- [x] 3.3 Hindi and Marathi interface — visitor screens, directions and map labels (`src/i18n/`); volunteer screens stayed English then (translated later, in Phase 3); native speakers must review hi/mr before 4.1

## Field pilot — Phase 8 (remaining)
- [ ] 4.1 Register and walk the Ramkund–Panchavati pilot zone
- [ ] 4.2 Field-test checklist (GPS drift, compass, iOS permissions, battery) and fixes — also: riverside connectors (Ramkund) must not join a lane across the Godavari; whether primary/secondary roads stay walkable on Snan days (police); standing still 60 s on iOS and Android gives no false "No GPS signal"; review the 5 unbridged river/weir crossings left out of routing (OSM ways 1470352108, 1470352110, 1469207348 at Ramkund weirs; 1470252662 Godavari footway; 116833045 Waghadi road) and approve real ones in `backend/config/approved_crossings.json`

## Harden and launch — 5.1–5.3 in Phase 3 (done); 5.4 setup files in Phase 4 (done), deployment in Phase 8 (remaining)
- [x] 5.1 Volunteer authentication on all write endpoints — phone + PIN accounts (`scripts/manage_volunteers.py`), revocable shift tokens; admins for data repair
- [x] 5.2 Visitor "path blocked" reports become expiring suggestions confirmed by volunteers — `/api/reports`, per-phone ids, timed blocks reopen by themselves
- [x] 5.3 Admin map: places, lanes, pending reports — admin mode in the PWA (`GET /api/admin/overview`)
- [ ] 5.4 Production deployment (domain, HTTPS, restricted CORS, real secrets) — code and config done and approved (`deploy/`: Caddy HTTPS, Postgres, migrate-once, startup safety checks, backups); **waiting for the owner's server + domain** to run it and do the on-domain checks in `deploy/README.md`
