"""
Volunteer sign-in: phone number + 6-digit PIN, created by an admin
(scripts/manage_volunteers.py). A sign-in gives an opaque random token valid
for one shift; only its sha256 is stored, so it can be revoked at once.

Every write endpoint depends on `require_volunteer` or `require_admin`.
"""
import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import or_, update
from sqlalchemy.orm import Session

from .db import AuthSession, Volunteer, get_db
from .schemas import LoginRequest, LoginResponse, VolunteerOut

router = APIRouter(prefix="/api/auth", tags=["auth"])

# A 12 h shift plus slack; volunteers sign in once per shift.
TOKEN_HOURS = 16
MAX_FAILED_LOGINS = 5
LOCK_MINUTES = 15
# scrypt cost: ~50 ms and 16 MB per check — slow for guessing, fine for sign-in.
_SCRYPT = {"n": 2**14, "r": 8, "p": 1}


def normalize_phone(phone: str) -> str:
    """Last 10 digits (drops +91, spaces, dashes)."""
    digits = re.sub(r"\D", "", phone or "")
    return digits[-10:]


def hash_pin(pin: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(pin.encode(), salt=salt, dklen=32, **_SCRYPT)
    return f"scrypt${_SCRYPT['n']}${_SCRYPT['r']}${_SCRYPT['p']}${salt.hex()}${digest.hex()}"


def verify_pin(pin: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, digest = stored.split("$")
        got = hashlib.scrypt(
            pin.encode(), salt=bytes.fromhex(salt), dklen=32, n=int(n), r=int(r), p=int(p)
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(got.hex(), digest)


# Compared against when the phone is unknown, so timing does not reveal it.
_DUMMY_HASH = hash_pin("000000")


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _bearer(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip() or None
    return None


def require_volunteer(
    authorization: str | None = Header(default=None), db: Session = Depends(get_db)
) -> Volunteer:
    token = _bearer(authorization)
    if not token:
        raise HTTPException(401, "Sign in as a volunteer first")
    row = (
        db.query(AuthSession)
        .filter(AuthSession.token_hash == _token_hash(token))
        .first()
    )
    if row is None or row.revoked or row.expires_at <= datetime.utcnow():
        raise HTTPException(401, "Your sign-in has expired — sign in again")
    vol = db.get(Volunteer, row.volunteer_id)
    if vol is None or not vol.active:
        raise HTTPException(401, "This volunteer account is disabled")
    return vol


def require_admin(vol: Volunteer = Depends(require_volunteer)) -> Volunteer:
    if vol.role != "admin":
        raise HTTPException(403, "Only an admin can do this")
    return vol


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    phone = normalize_phone(body.phone)
    vol = db.query(Volunteer).filter(Volunteer.phone == phone).first()
    now = datetime.utcnow()
    if vol is None or not vol.active:
        verify_pin(body.pin, _DUMMY_HASH)  # same time as a real check
        raise HTTPException(401, "Wrong phone number or PIN")

    # Take an attempt slot *before* the slow PIN check, in one atomic UPDATE:
    # guesses sent in parallel cannot all slip past the limit.
    slot = db.execute(
        update(Volunteer)
        .where(
            Volunteer.id == vol.id,
            or_(Volunteer.locked_until.is_(None), Volunteer.locked_until <= now),
            Volunteer.failed_logins < MAX_FAILED_LOGINS,
        )
        .values(failed_logins=Volunteer.failed_logins + 1)
        .returning(Volunteer.failed_logins)
    ).scalar()
    db.commit()
    if slot is None:
        db.refresh(vol)
        if vol.locked_until is None or vol.locked_until <= now:
            # Every slot is taken (guesses in flight): lock now.
            _lock(db, vol.id, now)
            db.refresh(vol)
        minutes = max(1, round((vol.locked_until - now).total_seconds() / 60))
        raise HTTPException(423, f"Too many wrong PINs — try again in {minutes} min")

    if not verify_pin(body.pin, vol.pin_hash):
        if slot >= MAX_FAILED_LOGINS:
            _lock(db, vol.id, now)
        raise HTTPException(401, "Wrong phone number or PIN")

    db.execute(
        update(Volunteer).where(Volunteer.id == vol.id).values(failed_logins=0, locked_until=None)
    )
    # Old sign-ins are of no use once expired.
    db.query(AuthSession).filter(AuthSession.expires_at < now - timedelta(days=7)).delete()
    token = secrets.token_urlsafe(32)
    expires = now + timedelta(hours=TOKEN_HOURS)
    db.add(AuthSession(token_hash=_token_hash(token), volunteer_id=vol.id, expires_at=expires))
    db.commit()
    db.refresh(vol)
    return LoginResponse(
        token=token, expires_at=expires, volunteer=VolunteerOut.model_validate(vol)
    )


def _lock(db: Session, volunteer_id: int, now: datetime) -> None:
    db.execute(
        update(Volunteer)
        .where(Volunteer.id == volunteer_id)
        .values(failed_logins=0, locked_until=now + timedelta(minutes=LOCK_MINUTES))
    )
    db.commit()


@router.post("/logout")
def logout(
    authorization: str | None = Header(default=None), db: Session = Depends(get_db)
):
    token = _bearer(authorization)
    if token:
        row = db.query(AuthSession).filter(AuthSession.token_hash == _token_hash(token)).first()
        if row is not None:
            row.revoked = True
            db.commit()
    return {"success": True}


@router.get("/me", response_model=VolunteerOut)
def me(vol: Volunteer = Depends(require_volunteer)):
    return vol
