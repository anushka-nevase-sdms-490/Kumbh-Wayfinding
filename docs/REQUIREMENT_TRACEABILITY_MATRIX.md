# Requirement traceability matrix

Each requirement from the Master Engineering Prompt (section 2, A–E) mapped
to the code, with a status checked against the code and tests (the audit in Phase 4
audit, 2026-10-30).

**Statuses:**
- **DONE+TESTED:** implemented and tested;
- **NEEDS TESTING:** implemented, but needs testing;
- **PARTIAL:** partially implemented;
- **MISSING:** not implemented;
- **OWNER:** blocked by an owner decision;
- **EXTERNAL:** blocked by an external approval.

"Tested" means automated tests and/or Chrome tests on the development machine.
**Nothing is tested on real devices or on site.**

## A. Offline pilgrim navigation

| Requirement | Status | Code | Endpoints / tables | UI | Tests | Missing | Risk | Next action |
|---|---|---|---|---|---|---|---|---|
| Downloaded offline maps | DONE+TESTED | `lib/mapCache.ts`, `mapDownload.ts`, `OfflineMapCard.tsx`, `vite.config.ts` (`__MAP_URLS__`) | static `/map/*` | Home: "Download offline map" | T28; Chrome: storage full, resume, airplane mode | Real-device storage eviction | The pinned Protomaps build may disappear (map not in git) | Commit the map, or document the fallback (done) |
| Offline points of interest | DONE+TESTED | `lib/packStore.ts`, `packSync.ts`, `fallbackPack.ts` | `/api/pack/*`; `qr_nodes`, `pack_versions`, `dataset_releases` | Destination list / map | T22, T23, T28; API pack checks | — | — | — |
| Walking routes calculated locally | DONE+TESTED | `lib/router.ts` (A*), `navigation.ts`, `progress.ts` | pack `edges` | Guide | T1–T20, T24, T26, T27 | On-site validation | OSM streets not walked | Field pilot |
| Search for verified facilities | PARTIAL | `App.tsx` destinations (category and area filters), `nearest.ts` | — | Destination screen | T16 (nearest) | **Free-text search**; a "verified only" filter; showing place trust to visitors | Visitors can't find a place by name | Phase 5: search over the pack (deterministic) |
| English, Hindi, Marathi | DONE+TESTED (visitor, volunteer) / PARTIAL (admin) | `i18n/*`, `vol-*.ts` | — | All visitor and volunteer screens | T25, T30 | Admin screens English; server messages English; **native review** | Wording errors | Native review (owner) |
| GPS-based approximate positioning | DONE+TESTED | `location/realGps.ts`, `gpsFilter.ts`, `useLivePosition` | — | Start suggestion, guide | T19, T20, T26 | Real-device GPS in crowds | Accuracy near the ghats | Field pilot |
| QR-based location re-identification | **OWNER** (removed by an owner decision: "no camera", ROADMAP 1.1; the new prompt asks for it again) | Old: `QrScanner.tsx`, `BoardQrGallery.tsx` in commit `e6883e2` | Stable `qr_nodes.code` exists | — | — | Confirm the reversal; choose a link + typed code (no camera) or an in-app scanner; admin QR generation; offline lookup; status display; tests | iOS: a scanned link opens in Safari without the app's offline data | Owner decision 7, then Phase 5 |
| Clear route-unavailable messages | DONE+TESTED | `App.tsx` (`nr.*`, `pack.*` messages) | — | "No walked lane yet", server and empty-data notices | T10, T22; Chrome | — | — | — |
| Show data source, verification, freshness | PARTIAL | `mapData.ts` (dashed unverified lanes), "Data details" panel (`App.tsx`) | pack `sources`, `verification` | Dashed lanes plus a warning; Data details | T27; API pack checks | **Per-place** trust and freshness shown to visitors; per-place verification date | Visitors trust an unverified place | Phase 5: show place trust plus date |

## B. Facility and location management

| Requirement | Status | Code | Endpoints / tables | UI | Tests | Missing | Risk | Next action |
|---|---|---|---|---|---|---|---|---|
| Stable location IDs | DONE+TESTED | `qr_nodes.code` (`OSM-N…`, `KUMBH-A…`) | `qr_nodes` (unique `code`) | — | API checks (codes kept on confirm / re-import) | — | — | Use them as the QR target |
| Facility categories | DONE+TESTED | `node_type`, `officialPlaces.ts` `SITE_CATEGORIES`, `cat.*` | `qr_nodes.node_type` | Category filters | API import checks | `TYPE_META` duplicates the labels | — | Clean-up (minor) |
| Coordinates and geometry | DONE+TESTED | Places: lat/lon + GPS accuracy; lanes: `path_json` | `qr_nodes`, `edges` | Maps | API and routing tests | Place outlines (areas) | — | — |
| Verification status | DONE+TESTED | `app/verification.py`; admin trust controls | `verification`, `verified_by`, `verification_note` | Admin map | T27; API trust checks | Shown to visitors for places | — | Phase 7 (admin) |
| **Operational status** (open / closed / temporary) | **MISSING** | — (lanes have closures; places don't) | — | — | — | Fields with an **expiry (`valid_until`)**, admin control, visitor display, pack | "Is it open?" can't be answered; a manual status goes stale | Phase 5 (OWNER: who sets it) |
| Source and verifier | PARTIAL | `verified_by`, `updated_by`, `audit_log`; source inferred from the code prefix; pack `sources` | `qr_nodes`, `audit_log` | Admin History | API audit checks | Explicit per-place `source` field | — | Phase 5 |
| Verification and validity dates | PARTIAL | Lanes: `verified_at`; places: only `updated_at` | — | — | — | Place `verified_at`; `valid_from` / `valid_until` | Stale data shown as current | Phase 5 |
| Dataset versions | DONE+TESTED | `pack_builder.py` (content-hash versions), `dataset_releases` (publish / rollback) | `/api/pack/latest`, `/api/admin/releases|publish|rollback` | Data versions panel | 13 publishing checks; Chrome | — | — | — |
| Accessibility and access restrictions | **MISSING** (places) / PARTIAL (lanes: `clearance_m`, `passage_kind`, one-way) | `edges` | — | — | T6, T7 | Step-free / wheelchair / women-only / restricted-hours fields | Unsuitable routes for the disabled or elderly | Phase 5 (OWNER: which attributes) |
| QR marker IDs | **MISSING** (depends on decision 7) | — | — | — | — | Marker id ↔ place code mapping, duplicate protection | — | Phase 5 |
| Never invent coordinates | DONE+TESTED | Places only from OSM or on-site GPS (accuracy required); official-site coordinates not used | — | — | API register and import checks | — | — | — |

## C. Lost-person case management

| Requirement | Status | Code | Endpoints / tables | UI | Tests | Missing | Risk | Next action |
|---|---|---|---|---|---|---|---|---|
| Unique case ID, last seen, description, contact | **MISSING** | — | — | — | — | Everything | Sensitive personal data (children) | Phase 6; OWNER + EXTERNAL: data and authority |
| Case status workflow (NEW → … → CLOSED) | **MISSING** | Reusable: `audit_log`, `require_admin` pattern | — | — | — | — | — | Phase 6 |
| Authorized operator access | **MISSING** (no operator role) | `auth.py` roles `volunteer` / `admin` | `volunteers.role` | — | — | An `operator` role, per-case access | Over-broad access | Phase 6 |
| Search, updates, escalation, reunification outcome | **MISSING** | — | — | — | — | — | — | Phase 6 |
| Audit logs | PARTIAL (infrastructure exists) | `app/audit.py` | `audit_log` | Admin audit | API audit checks | Case events | — | Reuse in Phase 6 |
| Retention and deletion | PARTIAL (infrastructure exists) | Pattern: `expire_blocks` (reports deleted after 30 days) | — | — | API retention check | Case retention policy | Over-retention of children's data | OWNER / EXTERNAL: retention period |
| No public exposure of sensitive details | n/a (nothing stored yet) | Pattern: the public pack stripped of personal data | — | — | Pack privacy checks | — | — | Keep cases out of the pack and public APIs |
| No autonomous identity decisions | n/a | — | — | — | — | — | — | Design rule for Phases 6 and 7 |

## D. SOS and connectivity

| Requirement | Status | Code | Endpoints / tables | UI | Tests | Missing | Risk | Next action |
|---|---|---|---|---|---|---|---|---|
| Offline SOS / report queue | **MISSING** for SOS; PARTIAL infrastructure | Reusable: `lib/outbox.ts`, `app/idempotency.py` (volunteer-only, signed-in) | `client_actions` | `VolunteerOutbox` | T29; idempotency API checks | A visitor (unsigned) SOS queue | — | Phase 6 |
| Show pending when offline | PARTIAL (volunteer queue only) | `VolunteerOutbox` | — | — | T29 | Visitor SOS screen | — | Phase 6 |
| Retry through approved channels | PARTIAL (HTTP retry only) | `outbox.flushOutbox` | — | — | T29 | Channel abstraction; SMS / radio need approval | — | Phase 6; EXTERNAL for SMS / radio |
| Sent only after channel acceptance | PARTIAL (volunteer queue: removed only after a 2xx) | `outbox.ts` | — | — | T29 | SOS states | False "sent" | Phase 6 |
| Acknowledged only after receiver confirmation | **MISSING** | — | — | — | — | Operator acknowledgement, a visitor status check | False reassurance | Phase 6 |
| Never claim delivery without evidence | n/a | — | — | — | — | — | — | Design rule for Phase 6 |

## E. AI capabilities

| Requirement | Status | Code | Missing | Risk | Next action |
|---|---|---|---|---|---|
| Multilingual information assistant | **MISSING** | — (reusable: the pack, `nearest.ts`, trust levels, i18n) | Everything | Hallucinated facilities or availability | Phase 7. OWNER: external model or deterministic only. Start deterministic and offline |
| Report structuring (text / speech) | **MISSING** | — | Everything | Wrong extraction, privacy | Phase 7, only after the lost-person cases (Phase 6) and approval |
| Translation and speech | **MISSING** (static UI translation only) | `i18n/*` | Speech input and output | — | Phase 7 (OWNER) |
| Data quality checks | PARTIAL (rule-based, not AI) | `graph_report.py`, `validate_graph.py` (duplicates, river crossings, disconnected places) | AI is not needed for these | — | Keep rule-based |
| Image-assisted matching | EXTERNAL | — | — | Biometric data; legal | Not in the MVP (the prompt excludes it) |
| Navigation works without AI or a backend | DONE+TESTED | Routing on the phone; offline pack and map | — | — | Keep (Chrome: all servers stopped → guidance works) |

## Engineering and operations

| Requirement | Status | Evidence |
|---|---|---|
| Sign-in, roles, sessions | DONE+TESTED | `auth.py`; scrypt; lock-out; hashed tokens; API checks |
| Authorization on every endpoint | DONE+TESTED | Route-dependency review; 401/403 checks (`SECURITY_AND_PRIVACY.md`) |
| Input validation, size limits | DONE+TESTED | Pydantic limits; 4 MB body limit; checks |
| Audit logs | DONE+TESTED | `audit_log`; 6 checks |
| Backup and restore | DONE+TESTED (locally) | `backup.sh`; restore round trip on Postgres 16 (not on a server) |
| Publishing and rollback | DONE+TESTED | 13 checks plus Chrome |
| Simulation never in production | DONE+TESTED | Build check; the server refuses simulated data in production |
| Deployment | OWNER | Server and domain not provided; `deploy/` ready |
| Real-device and field testing | EXTERNAL / OWNER | Not done |
| Privacy notice / DPDP | OWNER / EXTERNAL | Not done |
| Professional security test | EXTERNAL | Not done |
