# Setu — Offline Wayfinding (Kumbh Innovation Challenge 2027)

## One command (install + run backend + frontend)

```bash
cd /home/stark/Kumbh-Wayfinding
./start.sh
```

Then open **http://localhost:5173**

`start.sh` serves a **built** copy of the app (`vite preview`) to this PC, the
local network and the ngrok phone link — never the Vite development server,
which has known security advisories. The build keeps `?sim=1` for testing,
so anyone with the phone link can simulate a position **in their own browser**
(it never changes anyone else's GPS; changes still need a volunteer sign-in,
and the server saves simulated places and walks only as `unverified`). Share
the link only with testers. The production site never has simulation.
For live code reloading on this PC only: `FRONTEND_MODE=dev ./start.sh`
(no phones, no tunnel).

What you need on your PC: **[REQUIREMENTS.md](./REQUIREMENTS.md)**  
Beginner steps: **[BEGINNER.md](./BEGINNER.md)**

Stop with **Ctrl+C**.

---

## Documents

| Topic | File |
|---|---|
| **The 8 phases: done and remaining** | [docs/Setu_Development_Phases.pdf](docs/Setu_Development_Phases.pdf) (one page) · [docs/REMAINING_WORK_ROADMAP.md](docs/REMAINING_WORK_ROADMAP.md) |
| Audit against the new goals | [docs/PROJECT_IMPLEMENTATION_AUDIT.md](docs/PROJECT_IMPLEMENTATION_AUDIT.md) · [docs/REQUIREMENT_TRACEABILITY_MATRIX.md](docs/REQUIREMENT_TRACEABILITY_MATRIX.md) |
| QR boards, facility status, search | [docs/QR_BOARDS_AND_FACILITY_STATUS.md](docs/QR_BOARDS_AND_FACILITY_STATUS.md) |
| SOS alerts and lost-person cases | [docs/SOS_AND_LOST_PERSONS.md](docs/SOS_AND_LOST_PERSONS.md) |
| Ask Setu, report helper, operations summary | [docs/ASSISTANT_AND_OPERATIONS.md](docs/ASSISTANT_AND_OPERATIONS.md) |
| Privacy and DPDP checklist | [docs/PRIVACY_DPDP_CHECKLIST.md](docs/PRIVACY_DPDP_CHECKLIST.md) |
| End-to-end test plan (20 scenarios) | [docs/E2E_TEST_PLAN.md](docs/E2E_TEST_PLAN.md) |
| Launch readiness (pilot and public launch) | [docs/LAUNCH_READINESS.md](docs/LAUNCH_READINESS.md) |
| What is known not to work yet | [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) |
| Ready to deploy? What is missing | [docs/DEPLOYMENT_READINESS.md](docs/DEPLOYMENT_READINESS.md) · [deploy/README.md](deploy/README.md) |
| Tests, results, what is not tested | [docs/TESTING_AND_QA.md](docs/TESTING_AND_QA.md) |
| Security and privacy | [docs/SECURITY_AND_PRIVACY.md](docs/SECURITY_AND_PRIVACY.md) |
| Offline behaviour | [docs/OFFLINE_ARCHITECTURE.md](docs/OFFLINE_ARCHITECTURE.md) |
| Map data from OpenStreetMap, trust levels | [docs/NASHIK_GEO_DATA_PIPELINE.md](docs/NASHIK_GEO_DATA_PIPELINE.md) |
| River safeguards, graph checks | [docs/ROUTING_GRAPH_VALIDATION.md](docs/ROUTING_GRAPH_VALIDATION.md) |
| Testing from outside Nashik (simulation) | [docs/NASHIK_SIMULATION_MODE.md](docs/NASHIK_SIMULATION_MODE.md) |
| Volunteers | [docs/VOLUNTEER_WORKFLOW.md](docs/VOLUNTEER_WORKFLOW.md) |
| Admins: checks, audit log, publishing | [docs/ADMIN_WORKFLOW.md](docs/ADMIN_WORKFLOW.md) |
| Engineering audit and history | [docs/MASTER_ENGINEERING_AUDIT.md](docs/MASTER_ENGINEERING_AUDIT.md) · [docs/MISSING_ROUTE_ROOT_CAUSE.md](docs/MISSING_ROUTE_ROOT_CAUSE.md) |

## Folders

```
Kumbh-Wayfinding/
  start.sh         ← run everything
  REQUIREMENTS.md  ← what to install once
  backend/         ← Python API (:8000, or the next free port — start.sh prints it)
  frontend/        ← React UI (:5173)
  mobile/          ← optional Flutter apps
```

## Flow

Find my way → start (nearest place by GPS, or list) → destination → offline map with the walked route.
