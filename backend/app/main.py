from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import init_db
from .routers import nodes, pack
from .seed import seed


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    try:
        seed()
    except Exception as exc:  # noqa: BLE001 — boot should not crash on seed race
        print(f"Seed note: {exc}")
    yield


app = FastAPI(
    title="Setu API",
    description="Offline wayfinding backend for Kumbh Innovation Challenge 2027",
    version="0.1.0",
    lifespan=lifespan,
)

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if origins != ["*"] else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(nodes.router)
app.include_router(pack.router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "setu"}
