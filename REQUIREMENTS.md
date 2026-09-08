# Setu — What you need on your computer

Run everything with **one command**:

```bash
cd /home/stark/Kumbh-Wayfinding
./start.sh
```

That script installs Python/Node packages and starts **backend + frontend**.

---

## System requirements (install once)

| Need | Why | Check | Install (Ubuntu) |
|------|-----|--------|------------------|
| **Python 3.10+** | Backend API | `python3 --version` | `sudo apt install python3 python3-venv python3-pip` |
| **Node.js 18+** | React frontend | `node -v` | `sudo apt install nodejs npm` |
| **npm** | Frontend packages | `npm -v` | comes with Node |
| **curl** | Health checks in `start.sh` | `curl --version` | `sudo apt install curl` |
| **Git** (optional) | Version control | `git --version` | `sudo apt install git` |

### Optional (only for Flutter phone apps)

| Need | Why |
|------|-----|
| Flutter SDK | Already in `.flutter-sdk/` in this project |
| Android phone / emulator | Real gyroscope demo |
| Android Studio / SDK | Build APK |

You do **not** need Flutter to use the React website.

---

## Project packages (installed automatically by `./start.sh`)

### Backend (`backend/requirements.txt`)

- FastAPI, Uvicorn — web API  
- SQLAlchemy, GeoAlchemy2, psycopg2 — database  
- Pydantic — data validation  
- boto3, python-jose, passlib, aiofiles — storage / auth helpers  

Uses **SQLite by default** (no Postgres required for local demo).

### Frontend (`frontend/package.json`)

- React 18 + Vite + TypeScript  
- html5-qrcode — camera QR scan  

---

## After `./start.sh`

| URL | What |
|-----|------|
| http://localhost:5173 | **Open this** — pilgrim UI |
| http://localhost:8000 | Backend API |
| http://localhost:8000/docs | API documentation |

Stop with **Ctrl+C**.

Logs: `.run-logs/backend.log` and `.run-logs/frontend.log`

---

## One-command cheat sheet

```bash
cd /home/stark/Kumbh-Wayfinding && ./start.sh
```
