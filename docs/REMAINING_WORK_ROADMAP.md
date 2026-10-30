# Roadmap: 8 phases

The whole project is organised in **8 phases: 4 completed and 4 remaining**
(status 30 October 2026; summary in `Setu_Development_Phases.pdf`). The
remaining order is based on the audit (`PROJECT_IMPLEMENTATION_AUDIT.md`,
`REQUIREMENT_TRACEABILITY_MATRIX.md`).

**Every remaining phase follows:** plan → **owner approval** → build → test →
supervisor review → fix → re-review → owner report.

Each part inside a phase is approved and reviewed on its own, so a phase can
move forward step by step. Sizes are rough estimates of development effort,
not promises.

## The 8 phases

| Phase | Name | Status | Includes | Earlier labels |
|---|---|---|---|---|
| **1** | Offline navigation app | Done | Bug fixes; offline map and GPS guide; installable, works in airplane mode; OSM places and streets; Hindi and Marathi visitor screens | Original roadmap phases 0–3 (`ROADMAP.md`) |
| **2** | Safe and reliable routes | Done | Missing-route fix; Nashik simulation; Godavari river safeguards; trust levels; offline reliability | First master prompt: A, B, D, C, E |
| **3** | Volunteer and admin tools | Done | Volunteer accounts and visitor reports; admin map; volunteer offline queue; volunteer screens in hi/mr; admin data checks, audit log, publish and rollback | Original roadmap 5.1–5.3; first master prompt: F1, F2, F3 |
| **4** | Security, documents and audit | Done | Security and privacy review; QA, deployment-readiness and known-limitations documents; backup restore tested; production setup files; full audit against the new goals | Original roadmap 5.4 (setup files); first master prompt: G, H; new master prompt: Phase 0 |
| **5** | Stabilize and locate | Remaining | 5a commit, 5b stabilization, 5c QR location boards, 5d facility status, dates, accessibility and search | Earlier remaining list 0–3 |
| **6** | Pilgrim safety | Remaining | 6a SOS alerts, 6b lost-person cases | Earlier remaining list 4–5 |
| **7** | Assistant and admin | Remaining | 7a assistant (deterministic first, AI optional), 7b AI help for reports, 7c admin and operations | Earlier remaining list 6–8 |
| **8** | Final checks and field pilot | Remaining | 8a security and privacy review of the new features, 8b end-to-end testing, 8c field pilot and launch readiness (including deployment) | Earlier remaining list 9–11; original roadmap 4.1–4.2 and the deployment part of 5.4 |

## Principles for the order

1. **Protect what exists first.** The navigation core works and is tested; commit it before adding anything.
2. **Build what needs no outside approval before what does.** QR (software), facility status and search can be built now. Lost-person cases, SOS channels and AI need decisions about personal data, channels and models.
3. **Safety features must never pretend.** SOS states and assistant answers must be evidence-based, so they come after the data they depend on (facility status, freshness).
4. **New features are separate components and routes.** `App.tsx` is already 1,506 lines.
5. **Reuse:**
   - the offline queue and idempotency for SOS;
   - the audit log, roles and retention jobs for cases;
   - the stable place codes (and, if an in-app scanner is chosen, the old QR code in git) for QR boards;
   - the published pack for search and the assistant.

## Remaining phases in detail

### Phase 5: Stabilize and locate

| Part | What | Why now | Size | Needs from the owner first |
|---|---|---|---|---|
| **5a** | **Commit the current work** | 110 uncommitted files are the biggest risk | Minutes | Approval to commit; whether to include `frontend/public/map/` |
| **5b** | **Stabilization and regression protection** | Small, because the suites already pass (140 / 151 / 149). Add: a browser smoke test that can be re-run (airplane mode, volunteer queue); a check that the 14 deleted files leave nothing broken; a decision on dead code (`audit_photos`, `/api/sync`); a migration-safety review for the new tables | Small | Approval |
| **5c** | **QR location boards** | The concept asks for it; stable codes exist; needs no personal data. **It reverses your earlier "no camera / QR removed" decision**, so first confirm it | Small (link + typed code) / small–medium (in-app scanner) | **Confirm bringing QR back.** Choose (a) a link + typed code with no in-app camera (recommended; keeps the no-camera decision; the typed code is the reliable offline route on iOS) or (b) an in-app scanner (html5-qrcode, camera permission, no release since 2023). Physical markers only after authority approval |
| **5d** | **Facility status, dates, accessibility and search** | The QR display, the assistant ("is it open?") and SOS routing to help points all need it; visitors need free-text search. **A status expires (`valid_until`)**, so it never shows as "open" when stale | Medium | Who sets open/closed (authority feed, volunteers + admin); which accessibility attributes |

### Phase 6: Pilgrim safety

| Part | What | Why | Size | Needs from the owner first |
|---|---|---|---|---|
| **6a** | **SOS and offline alert workflow** | Highest safety value; reuses the outbox and idempotency. Server channel plus an operator console only. Truthful states: Pending → Sent → Acknowledged | Medium | Channels (server first); who receives and acknowledges; an operator role; **no real emergency-service link** without approval |
| **6b** | **Lost-person case management** | High value, but the most sensitive data. Build minimal fields behind an operator role; **not live** until approved | Medium–large | Operators; fields allowed; retention period; children's data; legal basis (DPDP); authority approval for live use |

### Phase 7: Assistant and admin

| Part | What | Why | Size | Needs from the owner first |
|---|---|---|---|---|
| **7a** | **Assistant: deterministic first, AI optional** | Answers "nearest verified medical / help desk / ghat", with status and freshness, from the published pack, **offline**. A model adds free-form questions only if approved | Medium (deterministic) + medium (AI) | External model allowed? Which? Data leaving the phone (privacy); cost |
| **7b** | **AI help for reports** | Only after cases exist (6b) and AI is approved (7a). Operator-reviewed drafts only; AI never confirms identity or closes a case | Medium | AI approval; privacy |
| **7c** | **Admin and operations** | Status, provenance, closures, QR mapping, case and SOS monitoring, operational reports | Medium | — |

### Phase 8: Final checks and field pilot

| Part | What | Why | Size | Needs from the owner first |
|---|---|---|---|---|
| **8a** | **Security, privacy and reliability review** | Cases and SOS add sensitive data; re-review access, retention, logs, offline privacy; DPDP checklist | Medium | Legal review and a professional pentest come from outside |
| **8b** | **End-to-end testing and simulation** | The 20 scenarios in the master prompt, each labelled automated / simulated / remote review / device / field | Medium | Devices for the device tests |
| **8c** | **Field pilot and production readiness** | Volunteers walk the pilot zone; real-device tests; launch-readiness report; deployment only with approval | Medium | Server, domain, authority approvals, training |

## What can't be done remotely (stays open whatever the order)

- **Physical verification:** walking the lanes, the 5 unbridged crossings, Snan-day closures.
- **Real-device tests:** Android and iOS, in the field.
- **Approvals:** QR marker installation and lost-person data handling (authority); emergency channels; DPDP / legal review; a professional penetration test.
- **Native Hindi and Marathi review.**

## Recommendation for the next step

1. **Approve 5a (commit the current work)** (decision 1 in the audit).
2. **Approve 5b (stabilization):** small and low-risk; it sets the baseline for the new features.
3. **Meanwhile, answer decisions 2–7 in the audit**, so the rest of phases 5–7 can be planned precisely:
   - the concept document;
   - whether to bring QR back (it reverses your earlier no-camera decision), and how;
   - the facility status source;
   - SOS channels and receivers;
   - lost-person data rules;
   - the AI policy.
