"""
Publish the current map data to visitors' phones (PUBLISH_MODE=manual; the
admin map's Publish button does the same). Run it after checking the data:

  .venv/bin/python scripts/validate_graph.py              # must end with OK
  .venv/bin/python scripts/publish_data.py "First Nashik data"
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.config import publishing_manual, settings  # noqa: E402
from app.db import SessionLocal, init_db  # noqa: E402
from app.services.pack_builder import ensure_current_pack, publish  # noqa: E402


def main() -> int:
    if not publishing_manual(settings):
        print("Publishing is off (PUBLISH_MODE=auto): every change is already live.")
        return 0
    note = " ".join(sys.argv[1:]).strip() or None
    init_db()
    db = SessionLocal()
    try:
        row = publish(db, None, note, by_name="command line")
        pack = ensure_current_pack(db)
        print(f"Published version {row.id}: {row.node_count} points, {row.edge_count} lanes "
              f"(phone pack {pack.version}: {pack.node_count} points, {pack.edge_count} lanes).")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
