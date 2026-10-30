"""
Volunteer and admin accounts (phone number + 6-digit PIN).

  .venv/bin/python scripts/manage_volunteers.py add 9876543210 "Asha Patil" [--role admin]
  .venv/bin/python scripts/manage_volunteers.py list
  .venv/bin/python scripts/manage_volunteers.py reset-pin 9876543210
  .venv/bin/python scripts/manage_volunteers.py disable 9876543210    # also signs out
  .venv/bin/python scripts/manage_volunteers.py enable 9876543210     # also lifts a PIN lock
  .venv/bin/python scripts/manage_volunteers.py revoke 9876543210     # sign out all phones

The PIN is typed in (never on the command line, so it stays out of shell history).
The first admin is created with `add ... --role admin`.
"""
import argparse
import getpass
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.auth import hash_pin, normalize_phone  # noqa: E402
from app.db import AuthSession, SessionLocal, Volunteer, init_db  # noqa: E402


def ask_pin() -> str:
    pin = getpass.getpass("New 6-digit PIN: ")
    if not re.fullmatch(r"\d{6}", pin):
        sys.exit("The PIN must be exactly 6 digits.")
    if pin in {"000000", "123456", "111111", "654321"} or len(set(pin)) == 1:
        sys.exit("That PIN is too easy to guess.")
    if getpass.getpass("Same PIN again: ") != pin:
        sys.exit("The PINs did not match.")
    return pin


def find(db, phone: str) -> Volunteer:
    vol = db.query(Volunteer).filter(Volunteer.phone == normalize_phone(phone)).first()
    if vol is None:
        sys.exit(f"No account for {phone}.")
    return vol


def revoke_all(db, vol: Volunteer) -> int:
    rows = (
        db.query(AuthSession)
        .filter(AuthSession.volunteer_id == vol.id, AuthSession.revoked.is_(False))
        .all()
    )
    for row in rows:
        row.revoked = True
    return len(rows)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    add = sub.add_parser("add")
    add.add_argument("phone")
    add.add_argument("name")
    add.add_argument("--role", choices=["volunteer", "admin"], default="volunteer")
    sub.add_parser("list")
    for cmd in ("reset-pin", "disable", "enable", "revoke"):
        sub.add_parser(cmd).add_argument("phone")
    args = ap.parse_args()

    init_db()
    db = SessionLocal()
    try:
        if args.cmd == "add":
            phone = normalize_phone(args.phone)
            if len(phone) != 10:
                sys.exit("Give a 10-digit mobile number.")
            if db.query(Volunteer).filter(Volunteer.phone == phone).first():
                sys.exit(f"{phone} already has an account (use reset-pin).")
            db.add(Volunteer(phone=phone, name=args.name, role=args.role, pin_hash=hash_pin(ask_pin())))
            db.commit()
            print(f"Added {args.role} {args.name} ({phone}).")
        elif args.cmd == "list":
            for v in db.query(Volunteer).order_by(Volunteer.role, Volunteer.name):
                state = "active" if v.active else "disabled"
                print(f"{v.phone}  {v.role:9}  {state:8}  {v.name}")
        elif args.cmd == "reset-pin":
            vol = find(db, args.phone)
            vol.pin_hash = hash_pin(ask_pin())
            vol.failed_logins, vol.locked_until = 0, None
            n = revoke_all(db, vol)
            db.commit()
            print(f"PIN changed for {vol.name}; {n} phone(s) signed out.")
        elif args.cmd == "disable":
            vol = find(db, args.phone)
            vol.active = False
            n = revoke_all(db, vol)
            db.commit()
            print(f"Disabled {vol.name}; {n} phone(s) signed out.")
        elif args.cmd == "enable":
            vol = find(db, args.phone)
            vol.active = True
            vol.failed_logins, vol.locked_until = 0, None  # also lifts a PIN lock
            db.commit()
            print(f"Enabled {vol.name}.")
        elif args.cmd == "revoke":
            vol = find(db, args.phone)
            n = revoke_all(db, vol)
            db.commit()
            print(f"Signed out {n} phone(s) of {vol.name}.")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
