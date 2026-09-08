# Setu Backend

Python API for QR boards, walkable paths, and offline pack files.

## Folder

```
backend/
  app/           # FastAPI code
  data/packs/    # Generated offline packs
  requirements.txt
  run.sh         # Start server
  Dockerfile
```

## Run

```bash
cd backend
./run.sh
```

- Health: http://localhost:8000/health  
- Docs: http://localhost:8000/docs  

## Main APIs

| Method | Path | Meaning |
|--------|------|---------|
| GET | `/api/nodes` | QR board list |
| GET | `/api/edges` | Man-made path links |
| POST | `/api/sync` | Staff phone upload |
| POST | `/api/pack/build` | Build offline pack |
| GET | `/api/pack/latest/json` | Pack for frontend/apps |
