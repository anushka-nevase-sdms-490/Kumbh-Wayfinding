"""
Safe retries for volunteer writes.

The volunteer app queues writes made without internet and sends them later
(frontend lib/outbox.ts). A send can reach the server and still look failed to
the phone (the connection drops before the answer), so the same write may
arrive twice. Each queued write carries an `Idempotency-Key` (a random id made
on the phone); the first request with a key is processed and its answer
stored, and any later request with that key gets the stored answer back.
"""

import re
from datetime import datetime, timedelta

from fastapi import Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy.exc import IntegrityError
from starlette.concurrency import run_in_threadpool

from .auth import _bearer, _token_hash
from .db import AuthSession, ClientAction, SessionLocal

PREFIX = "/api/volunteer/"
KEY_RE = re.compile(r"[A-Za-z0-9-]{16,64}")
# A request still "in progress" after this long died with its server: retry it.
STALE_PENDING = timedelta(minutes=2)
KEEP_FOR = timedelta(days=7)


def _volunteer_id(authorization: str | None) -> int | None:
    token = _bearer(authorization)
    if not token:
        return None
    db = SessionLocal()
    try:
        row = db.query(AuthSession).filter(AuthSession.token_hash == _token_hash(token)).first()
        if row is None or row.revoked or row.expires_at <= datetime.utcnow():
            return None
        return row.volunteer_id
    finally:
        db.close()


def _claim(key: str, volunteer_id: int, path: str):
    """("new", None) to process it now, or ("done"|"busy"|"other", row)."""
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        db.query(ClientAction).filter(ClientAction.created_at < now - KEEP_FOR).delete()
        db.add(ClientAction(key=key, volunteer_id=volunteer_id, path=path, created_at=now))
        try:
            db.commit()
            return "new", None
        except IntegrityError:
            db.rollback()
        row = db.query(ClientAction).filter(ClientAction.key == key).first()
        if row is None:  # removed in between (a failed first try): claim again
            return _claim(key, volunteer_id, path)
        if row.volunteer_id != volunteer_id or row.path != path:
            return "other", None
        if row.status_code is not None:
            return "done", (row.status_code, row.response_json)
        # Take over a request whose server died; atomic, so only one retry wins.
        took = (
            db.query(ClientAction)
            .filter(ClientAction.id == row.id, ClientAction.status_code.is_(None),
                    ClientAction.created_at < now - STALE_PENDING)
            .update({ClientAction.created_at: now}, synchronize_session=False)
        )
        db.commit()
        return ("new", None) if took else ("busy", None)
    finally:
        db.close()


def _finish(key: str, status_code: int | None, body: str | None) -> None:
    db = SessionLocal()
    try:
        q = db.query(ClientAction).filter(ClientAction.key == key)
        if status_code is None:
            q.delete()  # server error: let the phone try again
        else:
            q.update({ClientAction.status_code: status_code, ClientAction.response_json: body})
        db.commit()
    finally:
        db.close()


async def idempotency_middleware(request: Request, call_next):
    key = request.headers.get("idempotency-key")
    if request.method != "POST" or not key or not request.url.path.startswith(PREFIX):
        return await call_next(request)
    if not KEY_RE.fullmatch(key):
        return JSONResponse({"detail": "Bad Idempotency-Key"}, status_code=400)
    volunteer_id = await run_in_threadpool(_volunteer_id, request.headers.get("authorization"))
    if volunteer_id is None:
        return await call_next(request)  # the route answers 401
    state, stored = await run_in_threadpool(_claim, key, volunteer_id, request.url.path)
    if state == "done":
        status_code, body = stored
        return Response(body or "", status_code=status_code, media_type="application/json",
                        headers={"Idempotent-Replay": "true"})
    if state == "busy":
        return JSONResponse({"detail": "This change is still being saved — try again shortly"},
                            status_code=409, headers={"Retry-After": "5"})
    if state == "other":
        return JSONResponse({"detail": "This Idempotency-Key was used for another change"},
                            status_code=422)
    try:
        response = await call_next(request)
        body = b"".join([chunk async for chunk in response.body_iterator])
    except Exception:
        await run_in_threadpool(_finish, key, None, None)
        raise
    ok = response.status_code < 500
    await run_in_threadpool(_finish, key, response.status_code if ok else None,
                            body.decode("utf-8", "replace") if ok else None)
    headers = {k: v for k, v in response.headers.items() if k.lower() != "content-length"}
    return Response(body, status_code=response.status_code, headers=headers,
                    media_type=response.media_type)
