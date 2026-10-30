from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from .config import production_problems, settings
from .db import init_db
from .idempotency import idempotency_middleware
from .body_limit import BodySizeLimit
from . import auth
from .routers import admin, cases, nodes, pack, reports, sos, volunteer
from .seed import seed


@asynccontextmanager
async def lifespan(_: FastAPI):
    problems = production_problems(settings)
    if problems:
        raise RuntimeError("Unsafe production settings: " + "; ".join(problems))
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
    # The interactive API docs list every admin endpoint: development only.
    docs_url=None if settings.setu_env == "production" else "/docs",
    redoc_url=None if settings.setu_env == "production" else "/redoc",
    openapi_url=None if settings.setu_env == "production" else "/openapi.json",
)

# Innermost (added first): sees the plain JSON answer, before gzip.
app.middleware("http")(idempotency_middleware)


MAX_BODY_BYTES = 4 * 1024 * 1024  # the largest real request (an admin sync) is far smaller

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
# Sign-in uses a Bearer token, never cookies, so no credentials over CORS
# (credentials with "*" is not even valid CORS).
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
    # The volunteer queue reads these to tell "still being saved" from a refusal.
    expose_headers=["Retry-After", "Idempotent-Replay"],
)

# The pack (places + map lanes) is large JSON; gzip cuts it ~4×.
app.add_middleware(GZipMiddleware, minimum_size=1000)
# Outermost: refuse oversized request bodies, also ones sent without a length.
app.add_middleware(BodySizeLimit, max_bytes=MAX_BODY_BYTES)

app.include_router(auth.router)
app.include_router(nodes.router)
app.include_router(pack.router)
app.include_router(volunteer.router)
app.include_router(reports.router)
app.include_router(admin.router)
app.include_router(sos.router)
app.include_router(cases.router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "setu"}
