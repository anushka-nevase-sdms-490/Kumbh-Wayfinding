# Project implementation audit (part of Phase 4)

**Date:** 2026-10-30.
**Scope:** the whole repository, checked against the requirements in the
*Master Engineering Prompt — Setu / KumbhPath 2027* (its section 2).
**Method:**
- read the code, database models and endpoints directly (documents were checked against the code, not trusted);
- re-ran every test suite;
- searched for each required capability.

**No code was changed by this audit.**

> **Missing input:** the "KumbhPath project concept document" the prompt refers to is
> **not in the repository or the workspace**. This audit uses the requirements written
> in the prompt itself (section 2, A–E). Please supply the document if it adds more.

## 1. Summary

- **Navigation core: built and well tested.**
  - offline PWA, map, on-phone routing;
  - river safety, trust levels;
  - offline reliability;
  - volunteer data collection with an offline queue;
  - admin publishing, rollback and audit;
  - security controls.
- **The safety half of the concept is not built:**
  - lost-person case management;
  - SOS with truthful delivery states;
  - an AI assistant.
- **QR location re-identification was removed on purpose, by your earlier decision.**
  - ROADMAP 1.1: "QR removed completely — owner decision".
  - The agreed approach: "no camera anywhere in the visitor flow".
  - The new prompt asks for QR again, so **that decision must be confirmed or kept** (decision 7).
- **Facility data is thinner than the concept asks for:** no operational status (open/closed), no validity dates, no accessibility or access-restriction fields, and no free-text search for visitors.
- **Nothing is committed:** 110 changed, new or deleted files on `kunal-offline-map-integration`. The last commit is `e6883e2`.

**Field status:**
- nothing has been tested on real phones or on site;
- 0 places or lanes are field-verified (all 156 places and 2,475 lanes are `osm_imported`);
- nothing is deployed.

## 2. Repository state

| Item | State |
|---|---|
| Branch | `kunal-offline-map-integration` |
| Last commit | `e6883e2` Stop tracking Vite config timestamp temp files |
| Working tree | 41 modified, 55 new, 14 deleted, **all uncommitted** |
| Deleted (uncommitted) | QR scanner (`QrScanner.tsx`, `BoardQrGallery.tsx`), AR guide (`ArGuide.tsx`), `DirectionArrow.tsx`, `VolunteerRecordPath.tsx`, demo packs, the backend `/network` router (LAN-address info), two hooks |
| Not in git at all | `frontend/public/map/` (offline map, about 15 MB); `backend/data/osm/` (OSM snapshots, git-ignored) |

## 3. What exists (inventory)

### Frontend (`frontend/src`)
- **`App.tsx`:** 1,506 lines; holds the visitor flow, volunteer home and app state.
- **Screens and components:**
  - visitor: home, start place, destination (category and area filters, map tap, list), guide (turn prompts, progress, re-route, arrival, "path blocked"), `OfflineMapCard`, `OfflineMap` (MapLibre), `LangPicker`;
  - volunteer: `VolunteerLogin`, `VolunteerRegisterForm` (place plus walked lane), `VolunteerPathHeading`, `VolunteerObstacle` (with `VisitorReports`), `VolunteerOutbox`;
  - admin: `AdminMap`, `AdminChecks`, `AdminAudit`, `AdminReleases`;
  - development: `SimulationPanel` (lazy, development or test builds only).
- **Libraries (`lib/`):**
  - routing: `router` (A*), `navigation`, `progress`, `nearest`, `gpsFilter`;
  - offline: `packSync`, `packStore`, `mapCache` / `mapDownload`;
  - map: `mapData`, `mapStyle`;
  - volunteer: `outbox`, `volunteerData`;
  - other: `auth`, `officialPlaces`, `fallbackPack`, `location/*` (real GPS and simulation).
- **Languages:** `i18n/` en / hi / mr. The visitor and volunteer screens are complete; the admin screens are English only.

### Backend (`backend/app`)
- **Routers:** `auth`, `nodes`, `pack`, `volunteer`, `reports`, `admin`.
- **Services:** `osm_import`, `osm_network`, `water`, `river_guard`, `pack_builder`, `graph_report`.
- **Middleware:** idempotency, body-size limit, CORS, gzip.
- **Scripts:** `import_osm.py`, `validate_graph.py`, `publish_data.py`, `manage_volunteers.py`, `run_api_checks.py`.

### Database tables
| Table | Purpose |
|---|---|
| `qr_nodes` | Places and hidden junctions. Fields: `code` (stable id), name, local name, lat/lon, GPS accuracy, `node_type` (category), `verification`, `verified_by`, `verification_note`, `updated_by`/`updated_at` |
| `edges` | Lanes: geometry (`path_json`), closures (`blocked`, `blocked_until`, `door_state`, `walkable`), trust, source, `verified_at` |
| `block_reports` | Visitor "lane blocked" reports (pseudonymous; deleted 30 days after settling) |
| `volunteers`, `auth_sessions` | Accounts (roles `volunteer` / `admin`), hashed tokens |
| `pack_versions`, `dataset_releases` | Built packs; published versions (manual publishing) |
| `audit_log` | Who changed what |
| `client_actions` | Offline-queue idempotency keys (7 days) |
| `audit_photos` | **Unused**: only touched by the old demo clean-up in `seed.py` |

### Endpoints (30)
- **Public:** `/health`, `/api/pack/latest`, `/latest/json`, `/download/{v}`, `POST /api/reports`, `/api/auth/login|logout`.
- **Volunteer:** `/api/auth/me`; `GET /api/nodes`, `/nodes/{code}`, `/edges`, `/volunteer/nodes/{code}`; `POST /api/volunteer/register|record-path|path-heading|edge-status`; `GET /api/reports`; `POST /api/reports/{id}/confirm|reject`.
- **Admin:** `POST /api/nodes`, `/edges`, `/sync`, `/pack/build`; `/api/admin/overview|graph-report|releases|publish|rollback|audit|verify`.

## 4. Current test results (re-run 2026-10-30, this audit)

| Check | Command | Result |
|---|---|---|
| TypeScript | `npx tsc -b` | **Pass** (0 errors) |
| Lint | `npm run lint` | **Pass**: 0 errors, 1 warning (old: an effect's dependencies in `App.tsx`) |
| Routing and phone logic | `npm run test:routing` | **140 / 140** |
| Production build | `npm run build` | **Pass**; 24 precached files (2.2 MB); no simulation code; no third-party URLs |
| Runtime dependency audit | `npm audit --omit=dev` | **0 vulnerabilities** (dev tools: 8 advisories, see `SECURITY_AND_PRIVACY.md`) |
| API checks, SQLite, network blocked | `run_api_checks.py` | **151 / 151** |
| API checks, Postgres 16 (throwaway, empty DB), network blocked | `SETU_TEST_DATABASE_URL=… run_api_checks.py` | **149 / 149**; 2 SQLite-only checks are skipped by design (the first-run dataset build) |
| Graph validation, real Nashik database | `validate_graph.py` | **OK**: 30 crossings on bridges, 0 unsafe; main network 1,903; 44 places with no lane; 1 place in a small separate part |

**Correction to the earlier handoff:** it said "151/151 on PostgreSQL". Postgres runs **149** checks, because 2 are SQLite-only.

**Not re-run in this audit** (last run on 2026-10-30 during the earlier phases, see their documents):
- the Chrome browser tests;
- the airplane-mode test on a production build;
- the backup → restore round trip.

## 5. Findings

### 5.1 Built but thinner than the concept
1. **QR re-identification was removed by an owner decision.**
   - **Why:** ROADMAP 1.1 "Remove the camera: AR guide, in-app QR scanner, html5-qrcode … QR removed completely — owner decision"; the agreed strategy was "no camera anywhere in the visitor flow".
   - **What was removed:** `QrScanner.tsx` (html5-qrcode) and `BoardQrGallery.tsx` (qrcode.react) exist in commit `e6883e2` but are deleted in the working tree, together with both packages.
   - **What remains:** the stable place `code` that a QR would point to.
   - **The new prompt reverses the decision.** Bringing QR back is an owner choice (decision 7), with an option that needs no camera inside the app.
2. **No operational status for facilities.** Lanes can be closed; places can't be marked open, closed or temporary, and have no validity window. The "is this facility open?" requirement can't be met yet.
3. **No per-place verification date.**
   - places have `updated_at`, but no `verified_at`, and no explicit `source` (inferred from the code prefix `OSM-` / `KUMBH-`);
   - only lanes have `verified_at`.
4. **No accessibility or access-restriction fields** for places. Lanes have `clearance_m` and `passage_kind`, but there is no wheelchair or step-free information.
5. **Visitors can't free-text search.** They can only use category and area filters, the list, or the map.
6. **Visitors don't see a place's verification status.** Only unwalked lanes are shown (dashed). Freshness is shown once for the whole dataset ("Data details").

### 5.2 Not built
7. **Lost-person case management:** none. "Lost and found" is only a place category.
8. **SOS / emergency alerts with delivery states:** none. The visitor "path blocked" report is the only visitor-to-server message.
9. **AI features:** none (no model, API or speech libraries).
10. **No operator role:** roles are `volunteer` and `admin` only.

### 5.3 Duplicated or dead code; reuse opportunities
- **Reuse for SOS:**
  - the volunteer **offline queue** (`lib/outbox.ts`: IndexedDB, ordered sending, refusals kept);
  - **idempotency** (`app/idempotency.py`: an action is never applied twice).
  - Together they already give "pending → sent, never duplicated". Only "acknowledged" and a visitor (unsigned) variant are missing.
- **Reuse for case access control:** sign-in, the role check (`require_admin` pattern), `audit_log`, and retention jobs (`expire_blocks` pattern).
- **Reuse for QR:** the old scanner and gallery in git; the stable `code`; the pack lookup on the phone.
- **Reuse for search and the assistant:** `nearest.ts`, `officialPlaces.ts`, the pack (versioned and published), trust levels.
- **Dead or legacy:**
  - the `audit_photos` table is unused;
  - `POST /api/sync` (admin batch upsert from the old "ground-staff phones" design) has no caller in the frontend (kept and tested; candidate for removal);
  - `TYPE_META` in `lib/types.ts` holds English category labels next to the translated `cat.*` keys.
- **Maintainability:** `App.tsx` is 1,506 lines. **Rule for phases 5–7:** each new feature (QR, SOS, cases, assistant) is its own component and route; `App.tsx` only links to it.

### 5.4 Differences from the concept
| Concept | Repository |
|---|---|
| Nashik **and Trimbakeshwar** | Walking streets cover the Ramkund–Panchavati pilot zone only. Trimbakeshwar has an official place (Kushavarta Kund) but no streets |
| QR markers for re-identification | Removed (see 5.1) |
| Facility operational status, validity, accessibility | Not modelled |
| Lost-person cases, SOS, AI assistant | Not built |
| Name "KumbhPath" | The project is called **Setu** in code and documents |

### 5.5 Risks
- **Uncommitted work (high).** 110 files exist only in this working tree; one mistake or disk failure loses months of work. **Commit before new phases.**
- **Personal data in new features (high).** Lost-person cases (children, descriptions, contacts) and SOS (live location) are far more sensitive than anything stored today. Building them before the privacy, DPDP and authority decisions risks building the wrong thing, or holding data the project isn't allowed to hold.
- **False assurance (high).** An SOS that looks "sent" when it isn't is dangerous, so the delivery states must be evidence-based. The prompt requires this.
- **AI hallucination (medium).** Any assistant must answer only from the published pack, and must say when it doesn't know.
- **Data freshness (medium).** Without operational status and validity dates, the app can't say whether a facility is open, so neither can an assistant.
- **Field gap (high, external).** No real-device or on-site testing; 0 field-verified data.

## 6. Blockers and owner decisions (prioritized)

| # | Decision | Blocks | Recommendation |
|---|---|---|---|
| 1 | **Commit the current work** (110 files) and decide on `frontend/public/map/` (about 15 MB) | Every remaining phase (a safe baseline) | Commit now, as a separate commit, as step 5a |
| 2 | **Provide the KumbhPath concept document** | Exact scope of phases 5–7 | Share it, or confirm that the prompt's section 2 is the full scope |
| 3 | **Lost-person data:** who the operators are (police / Mela authority / volunteers?), which fields may be collected, the retention period, children's data, the legal basis (DPDP) | Phase 6 (6b, for real use) | Build the workflow only with minimal fields and placeholder retention, behind an operator role, **not live** until an authority approves |
| 4 | **SOS channels:** server-only first, or also SMS / radio / Bluetooth? Who receives and acknowledges (an operator console)? | Phase 6 (6a) | Server channel plus an operator console first; no real emergency-service link without approval and testing |
| 5 | **AI:** may visitor questions go to an external model API (data leaves the phone; cost; privacy), or deterministic only? Which model? | Phase 7 (7a, 7b) | Start with a deterministic, offline "ask" over the published pack (search plus nearest verified facility). Add a model only if you approve it, with that fallback kept |
| 6 | **Facility operational status:** who marks a facility open or closed, and from what source (authority feed, volunteers)? | Phase 5 (5d); "is it open?" answers; the QR status display | Add the fields plus an admin control; volunteers propose, admins publish. **Every status has an expiry (`valid_until`)**, so the app stops saying "open" once it lapses instead of showing a stale status |
| 7 | **Bring QR back?** This reverses your earlier "no camera / QR removed" decision. If yes, how? (a) **Link plus typed code, no in-app camera:** the QR holds `https://<domain>/?at=<place code>`, the phone's own camera app opens the app at "You are at <place>", and the short code printed on the board can be typed offline. (b) **In-app scanner** (html5-qrcode: camera permission; last release 2.3.8 in April 2023, so maintenance is uncertain). Also: will physical markers be allowed (authority approval)? | Phase 5 (5c) | **(a)**, which keeps the no-camera decision and needs no new library. Caveat: on **iOS**, a home-screen app keeps its storage separate from Safari, so a scanned link opens in Safari, which may lack the offline data. **The typed code is the reliable offline route on iOS**; on Android Chrome the link opens in the installed app and works offline. Markers only after approval |
| 8 | Earlier open items | Pilot or launch | The 5 unbridged crossings; 9 duplicates; native hi/mr review; server and domain; CSP tightening (production config); first real ngrok run; privacy notice; pentest |

The recommended order of work is in `REMAINING_WORK_ROADMAP.md`; the per-requirement status is in `REQUIREMENT_TRACEABILITY_MATRIX.md`.
