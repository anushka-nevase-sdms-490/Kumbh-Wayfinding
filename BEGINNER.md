# Setu — Beginner Guide

Backend and frontend are **separate folders**.

```
backend/   → server (Python)
frontend/  → website (React)
```

---

## Terminal 1 — Backend

```bash
cd /home/stark/Kumbh-Wayfinding/backend
./run.sh
```

Open http://localhost:8000/health → should say `ok`

---

## Terminal 2 — Frontend

```bash
cd /home/stark/Kumbh-Wayfinding/frontend
npm install
npm run dev
```

Open **http://localhost:5173**

1. Find my way  
2. Select starting point (or scan QR)  
3. Select destination  
4. Follow the arrow + route list  

---

## Optional — phone apps

```bash
export PATH="/home/stark/Kumbh-Wayfinding/.flutter-sdk/bin:$PATH"
cd /home/stark/Kumbh-Wayfinding/mobile/pilgrim
flutter run
```

---

## What each folder is

| Folder | What |
|--------|------|
| `backend/` | API + database + offline pack |
| `frontend/` | React pilgrim UI |
| `mobile/` | Flutter apps (pilgrim + staff) |
| `_archive/` | Old admin UI (not used) |
