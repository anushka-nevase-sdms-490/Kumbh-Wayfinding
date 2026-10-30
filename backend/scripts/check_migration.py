"""
Migration safety check: a database made by an OLDER version of the code is
upgraded by the current one without losing anything.

  .venv/bin/python scripts/check_migration.py              # from commit e6883e2
  .venv/bin/python scripts/check_migration.py <commit>

1. Takes backend/app from <commit> out of git (into a temporary folder).
2. Creates a SQLite database with that old code and adds sample rows.
3. Runs the current upgrade (python -m app.migrate) on it.
4. Checks: every old row is still there, new tables and columns exist, old
   rows got sensible defaults, and the current code builds a pack from it.

Works on a temporary copy only. Exit code 1 if a check fails.
"""
import os
import sqlite3
import subprocess
import sys
import tempfile

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(BACKEND)
PY = os.path.join(BACKEND, ".venv/bin/python")
ok = True


def check(cond, msg):
    global ok
    print(("OK   " if cond else "FAIL ") + msg, flush=True)
    ok = ok and bool(cond)


OLD_ROWS = """
import sys; sys.path.insert(0, '.')
from app.db import SessionLocal, QrNode, Edge, init_db
init_db()
db = SessionLocal()
db.add(QrNode(code='OLD-A', name='Old Ghat', lat=20.0072, lon=73.7924, node_type='ghat'))
db.add(QrNode(code='OSM-N999', name='Old Temple', lat=20.0075, lon=73.7930, node_type='temple'))
db.flush()
db.add(Edge(from_code='OLD-A', to_code='OSM-N999', distance_m=70, verified=True,
            path_json='[{"lat":20.0072,"lon":73.7924,"t_ms":1},{"lat":20.0075,"lon":73.793,"t_ms":2}]'))
db.commit()
print('old rows written')
"""


def main() -> int:
    commit = sys.argv[1] if len(sys.argv) > 1 else "e6883e2"
    tmp = tempfile.mkdtemp(prefix="setu-migration-")
    old = os.path.join(tmp, "old")
    os.makedirs(old)
    arch = subprocess.run(["git", "-C", REPO, "archive", commit, "backend/app"], capture_output=True)
    if arch.returncode != 0:
        print(f"Cannot read {commit} from git: {arch.stderr.decode()[:200]}")
        return 2
    subprocess.run(["tar", "-x", "-C", old], input=arch.stdout, check=True)
    db_path = os.path.join(tmp, "old.db")
    env = {**os.environ, "USE_SQLITE": "1", "SQLITE_PATH": db_path, "PACK_DIR": os.path.join(tmp, "packs"),
           "SETU_ENV": "development", "HTTPS_PROXY": "http://127.0.0.1:9", "HTTP_PROXY": "http://127.0.0.1:9"}
    r = subprocess.run([PY, "-c", OLD_ROWS], cwd=os.path.join(old, "backend"), env=env, capture_output=True, text=True)
    check(r.returncode == 0, f"database created by the code at {commit} ({(r.stdout or r.stderr).strip()[-120:]})")
    before = {t: n for t, n in sqlite3.connect(db_path).execute(
        "select name, 0 from sqlite_master where type='table'")}

    r = subprocess.run([PY, "-m", "app.migrate"], cwd=BACKEND, env=env, capture_output=True, text=True)
    check(r.returncode == 0, f"current upgrade (python -m app.migrate) runs ({(r.stdout + r.stderr).strip()[-160:]})")

    con = sqlite3.connect(db_path)
    tables = {n for (n,) in con.execute("select name from sqlite_master where type='table'")}
    new_tables = sorted(tables - set(before))
    check({"audit_log", "client_actions", "dataset_releases", "sos_alerts", "lost_cases", "lost_case_events"} <= tables
          and "flood_suspect" in {c[1] for c in con.execute("pragma table_info(sos_alerts)")}
          and "board_code" in {c[1] for c in con.execute("pragma table_info(qr_nodes)")},
          f"new tables added ({', '.join(new_tables) or 'none'})")
    cols = {c[1] for c in con.execute("pragma table_info(qr_nodes)")}
    ecols = {c[1] for c in con.execute("pragma table_info(edges)")}
    check({"verification", "verified_by", "verification_note"} <= cols and {"verification", "source"} <= ecols,
          "new columns added to places and lanes")
    rows = con.execute("select code, name, verification from qr_nodes where code in ('OLD-A','OSM-N999') order by code").fetchall()
    check([r[:2] for r in rows] == [("OLD-A", "Old Ghat"), ("OSM-N999", "Old Temple")], "old places kept unchanged")
    check(dict((r[0], r[2]) for r in rows) == {"OLD-A": "unverified", "OSM-N999": "osm_imported"},
          f"old places get trust levels from what is known, never more {rows}")
    lane = con.execute("select from_code, to_code, distance_m, verification from edges").fetchall()
    check(lane == [("OLD-A", "OSM-N999", 70.0, "volunteer_verified")], f"old walked lane kept, marked volunteer_verified {lane}")
    con.close()

    r = subprocess.run([PY, "-c", (
        "import json,sys; sys.path.insert(0,'.');"
        "from app.db import SessionLocal; from app.services.pack_builder import ensure_current_pack;"
        "db=SessionLocal(); row=ensure_current_pack(db); p=json.load(open(row.file_path));"
        "print(row.node_count, row.edge_count, any('t_ms' in (e.get('path_json') or '') for e in p['edges']))"
    )], cwd=BACKEND, env=env, capture_output=True, text=True)
    check(r.stdout.strip() == "2 1 False", f"the current code builds a pack from the upgraded database ({r.stdout.strip() or r.stderr[-160:]})")
    r = subprocess.run([PY, "-m", "app.migrate"], cwd=BACKEND, env=env, capture_output=True, text=True)
    check(r.returncode == 0, "running the upgrade a second time is harmless")

    print("\nALL OK" if ok else f"\nSOME FAILED (files in {tmp})")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
