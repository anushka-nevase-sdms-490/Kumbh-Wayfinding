"""
API regression checks against a throwaway SQLite DB.
Run: cd backend && .venv/bin/pip install -r requirements-dev.txt && .venv/bin/python scripts/run_api_checks.py
     (add SETU_TEST_DATABASE_URL=postgresql+psycopg2://user@host/emptydb to check Postgres)
"""
import json
import os
import sys
import tempfile

_tmp = tempfile.mkdtemp(prefix="setu-api-checks-")
os.environ["SQLITE_PATH"] = os.path.join(_tmp, "test.db")
# SETU_TEST_DATABASE_URL=postgresql+psycopg2://… runs the same checks on an
# EMPTY Postgres database (it is filled with test data).
if os.environ.get("SETU_TEST_DATABASE_URL"):
    os.environ["USE_SQLITE"] = "0"
    os.environ["DATABASE_URL"] = os.environ["SETU_TEST_DATABASE_URL"]
os.environ["PACK_DIR"] = os.path.join(_tmp, "packs")
os.environ["PUBLIC_URL_FILE"] = os.path.join(_tmp, "none")
# The checks bring their own water data; never read the real backend/data/osm.
os.environ["OSM_DIR"] = os.path.join(_tmp, "osm-none")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

ok = True
def check(cond, msg):
    global ok
    ok &= bool(cond)
    print(("OK  " if cond else "FAIL"), msg)

# Step 5.1: every write needs a signed-in volunteer; admins for data-repair endpoints.
from datetime import datetime, timedelta  # noqa: E402

from app.auth import hash_pin  # noqa: E402
from app.db import AuthSession, SessionLocal as _Session, Volunteer, init_db  # noqa: E402

init_db()
_db = _Session()
_db.add_all([
    Volunteer(phone="9000000001", name="Admin", role="admin", pin_hash=hash_pin("482913")),
    Volunteer(phone="9000000002", name="Asha", role="volunteer", pin_hash=hash_pin("736251")),
    Volunteer(phone="9000000003", name="Ravi", role="volunteer", pin_hash=hash_pin("593017")),
    Volunteer(phone="9000000004", name="Meera", role="operator", pin_hash=hash_pin("618274")),
])
_db.commit()
_db.close()

with TestClient(app) as anon:
    writes = [
        ("/api/volunteer/register", {"location_name": "X", "local_name": "x", "lat": 19, "lon": 73}),
        ("/api/volunteer/path-heading", {"from_code": "A", "to_code": "B", "path_heading_deg": 0}),
        ("/api/volunteer/edge-status", {"from_code": "A", "to_code": "B", "blocked": True}),
        ("/api/volunteer/record-path", {"from_code": "A", "to_code": "B", "waypoints": []}),
        ("/api/nodes", {"code": "ZZ", "name": "z", "lat": 19, "lon": 73}),
        ("/api/edges", {"from_code": "A", "to_code": "B", "distance_m": 1}),
        ("/api/sync", {"client_batch_id": "x"}),
        ("/api/pack/build", None),
    ]
    codes = [anon.post(url, json=body).status_code for url, body in writes]
    check(all(code == 401 for code in codes), f"every write endpoint needs sign-in (got {codes})")
    check(anon.get("/api/pack/latest").status_code == 200 and anon.get("/api/pack/latest/json").status_code == 200,
          "reading the published pack stays public")
    check(all(anon.get(u).status_code == 401 for u in ("/api/nodes", "/api/edges", "/api/nodes/X1", "/api/volunteer/nodes/X1")),
          "the full database (unpublished and rejected rows) needs a sign-in")

    login = lambda phone, pin: anon.post("/api/auth/login", json={"phone": phone, "pin": pin})
    r = login("+91 90000 00002", "736251")
    check(r.status_code == 200 and r.json()["volunteer"]["role"] == "volunteer", "volunteer signs in (+91 and spaces ok)")
    VOL = {"Authorization": f"Bearer {r.json()['token']}"}
    check(anon.get("/api/auth/me", headers=VOL).json()["name"] == "Asha", "/me returns the signed-in volunteer")
    check(anon.post("/api/pack/build", headers=VOL).status_code == 403, "volunteer on an admin endpoint → 403")
    check(login("9000000002", "000000").status_code == 401 and login("9999999999", "736251").status_code == 401,
          "wrong PIN or unknown phone → 401 (same message)")
    for _ in range(3):
        login("9000000002", "111111")
    check(login("9000000002", "111111").status_code == 401, "5th wrong PIN still 401")
    locked = login("9000000002", "736251")
    unknown = login("9999999999", "736251")
    check(locked.status_code == 401 and locked.json() == unknown.json(),
          "after 5 wrong PINs the account is locked — with the same answer as an unknown number (no account probing)")
    # Wrong PINs sent in parallel must not get past the 5-try limit.
    from concurrent.futures import ThreadPoolExecutor  # noqa: E402

    _db = _Session()
    asha = _db.query(Volunteer).filter(Volunteer.phone == "9000000002").first()
    asha.locked_until, asha.failed_logins = None, 0
    _db.commit()
    _db.close()
    import app.auth as _auth  # noqa: E402

    _real_verify, checked = _auth.verify_pin, []

    def _counting(pin, h):
        if h == asha_hash:
            checked.append(1)
        return _real_verify(pin, h)

    _db = _Session()
    asha_hash = _db.query(Volunteer).filter(Volunteer.phone == "9000000002").first().pin_hash
    _db.close()
    _auth.verify_pin = _counting
    with ThreadPoolExecutor(max_workers=10) as pool:
        burst = list(pool.map(lambda i: login("9000000002", f"{100000 + i}").status_code, range(20)))
    _auth.verify_pin = _real_verify
    check(len(checked) <= 5 and burst.count(401) == 20,
          f"20 parallel wrong PINs: at most 5 checked against the real PIN ({len(checked)}), all refused")
    _db = _Session()
    asha = _db.query(Volunteer).filter(Volunteer.phone == "9000000002").first()
    asha.locked_until = datetime.utcnow() - timedelta(minutes=1)
    _db.commit()
    _db.close()
    check(login("9000000002", "736251").status_code == 200, "right PIN works again once the lock has ended")
    anon.post("/api/auth/logout", headers=VOL)
    check(anon.get("/api/auth/me", headers=VOL).status_code == 401, "signed-out token no longer works")

    r = login("9000000001", "482913")
    ADMIN = {"Authorization": f"Bearer {r.json()['token']}"}
    _db = _Session()
    row = _db.query(AuthSession).order_by(AuthSession.id.desc()).first()
    row.expires_at = datetime.utcnow() - timedelta(minutes=1)
    _db.commit()
    _db.close()
    check(anon.get("/api/auth/me", headers=ADMIN).status_code == 401, "expired token → 401")
    ADMIN = {"Authorization": f"Bearer {login('9000000001', '482913').json()['token']}"}
    VOL2 = {"Authorization": f"Bearer {login('9000000003', '593017').json()['token']}"}
    OPER = {"Authorization": f"Bearer {login('9000000004', '618274').json()['token']}"}

with TestClient(app, headers=ADMIN) as c:
    reg = lambda **kw: c.post("/api/volunteer/register", json={"location_name": kw.pop("name"), "local_name": "x", **kw})
    a = reg(name="A", lat=19.0, lon=73.0).json()
    check(a["success"], "register first place")
    A = a["node"]["code"]
    far = reg(name="Far", lat=19.03, lon=73.0).json()
    check(far["success"], "register far place without connection")
    check(len(c.get("/api/edges").json()) == 0, "no auto-link to nearest place (finding 3)")

    n_before = len(c.get("/api/nodes").json())
    r = reg(name="Bad", lat=19.0, lon=73.0001, connect_to_code="NOPE")
    check(r.status_code == 400, "unknown connect_to_code → 400")
    check(len(c.get("/api/nodes").json()) == n_before, "no orphan place left (finding 2)")

    c.post("/api/nodes", json={"code": "RAMKUND-1", "name": "Ramkund", "lat": 19.0, "lon": 73.0002})
    r = reg(name="B", lat=19.0, lon=73.0003, connect_to_code="RAMKUND-1").json()
    check(r["success"], "can connect to non-KUMBH-A place")
    B = r["node"]["code"]

    r = c.post("/api/edges", json={"from_code": A, "to_code": "GHOST", "distance_m": 5})
    check(r.status_code == 404, "edge to missing place → 404 (finding 1)")
    r = c.post("/api/edges", json={"from_code": B, "to_code": "RAMKUND-1", "distance_m": 5})
    check(r.status_code == 409, "duplicate lane (reverse direction) → 409 (finding 9)")

    r = c.post("/api/sync", json={"client_batch_id": "1", "nodes": [
        {"code": "dup", "name": "D", "lat": 19, "lon": 73},
        {"code": "DUP", "name": "D2", "lat": 19, "lon": 73}]})
    check(r.status_code == 200, "sync with dup/DUP codes no 500 (finding 10)")
    c.post("/api/sync", json={"client_batch_id": "2", "nodes": [
        {"code": "LN-1", "name": "L", "lat": 19, "lon": 73, "local_name": "मराठी"}]})
    c.post("/api/sync", json={"client_batch_id": "3", "nodes": [
        {"code": "LN-1", "name": "L2", "lat": 19, "lon": 73}]})
    check(c.get("/api/nodes/LN-1").json()["local_name"] == "मराठी", "sync keeps unsent local_name")
    r = c.post("/api/sync", json={"client_batch_id": "4", "edges": [
        {"from_code": "LN-1", "to_code": "GHOST", "distance_m": 3}]})
    check(r.status_code == 404, "sync edge to missing place → 404")

    # Eastward 30 m walk with a dead compass (heading 0) → heading ~90 / ~270
    E = reg(name="E", lat=19.0, lon=73.000285).json()["node"]["code"]
    wps = [{"lat": 19.0, "lon": 73.0 + i * 0.0000285, "heading_deg": 0, "t_ms": i} for i in range(11)]
    r = c.post("/api/volunteer/record-path", json={"from_code": A, "to_code": E, "waypoints": wps}).json()
    check(abs(r["heading_ab"] - 90) < 2 and abs(r["heading_ba"] - 270) < 2,
          f"walk heading from GPS track (finding 4): ab={r['heading_ab']:.1f} ba={r['heading_ba']:.1f}")

    # Sync the A–E lane back in the reverse direction without headings:
    # the row flips, so the stored headings must swap with it.
    c.post("/api/sync", json={"client_batch_id": "5", "edges": [
        {"from_code": E, "to_code": A, "distance_m": 30}]})
    lane = next(x for x in c.get("/api/edges").json() if {x["from_code"], x["to_code"]} == {A, E})
    check(lane["from_code"] == E and abs(lane["heading_ab"] - 270) < 2 and abs(lane["heading_ba"] - 90) < 2,
          "sync re-orient keeps heading meaning")

    # 40 m eastward walk with one 4 m sideways GPS jitter sample at the start
    F = reg(name="F", lat=19.001, lon=73.00038).json()["node"]["code"]
    G = reg(name="G", lat=19.001, lon=73.0, connect_to_code=F).json()["node"]["code"]
    wps = [{"lat": 19.001, "lon": 73.0, "heading_deg": None, "t_ms": 0},
           {"lat": 19.001036, "lon": 73.0, "heading_deg": None, "t_ms": 1}]
    wps += [{"lat": 19.001, "lon": 73.0 + i * 0.000038, "heading_deg": None, "t_ms": 1 + i} for i in range(1, 11)]
    r = c.post("/api/volunteer/record-path", json={"from_code": G, "to_code": F, "waypoints": wps}).json()
    check(abs(r["heading_ab"] - 90) < 10, f"GPS jitter at walk start ignored: ab={r['heading_ab']:.1f}")

    # One-way lane must not be turned around by sync or record-path
    c.post("/api/nodes", json={"code": "OW-A", "name": "a", "lat": 19.002, "lon": 73.0})
    c.post("/api/nodes", json={"code": "OW-B", "name": "b", "lat": 19.002, "lon": 73.0003})
    c.post("/api/edges", json={"from_code": "OW-A", "to_code": "OW-B", "distance_m": 30, "bidirectional": False})
    r = c.post("/api/sync", json={"client_batch_id": "6", "edges": [
        {"from_code": "OW-B", "to_code": "OW-A", "distance_m": 30}]})
    lane = next(x for x in c.get("/api/edges").json() if {x["from_code"], x["to_code"]} == {"OW-A", "OW-B"})
    check(r.status_code == 409 and lane["from_code"] == "OW-A", "sync refuses to reverse a one-way lane")
    r = c.post("/api/volunteer/record-path", json={"from_code": "OW-B", "to_code": "OW-A", "waypoints": [
        {"lat": 19.002, "lon": 73.0003, "t_ms": 0}, {"lat": 19.002, "lon": 73.0, "t_ms": 1}]})
    check(r.status_code == 409, "record-path refuses to walk a one-way lane backwards")

    # Step 1.5: places are saved from live GPS; rough fixes are refused
    r = reg(name="Rough", lat=19.004, lon=73.0, gps_accuracy_m=80)
    check(r.status_code == 400, "register with ±80 m GPS → 400")
    r = reg(name="Precise", lat=19.004, lon=73.0, gps_accuracy_m=6.5).json()
    check(r["success"] and r["node"]["gps_accuracy_m"] == 6.5, "register stores GPS accuracy")

    pack = c.get("/api/pack/latest/json").json()
    codes = {n["code"] for n in pack["nodes"]}
    check(all(e["from_code"] in codes and e["to_code"] in codes for e in pack["edges"]), "pack has no dangling edges")

    # Step 2.1: the pack is rebuilt only when places or lanes change
    pack_files = lambda: len(os.listdir(os.environ["PACK_DIR"]))
    files_before = pack_files()
    again = c.get("/api/pack/latest/json")
    check(again.json()["version"] == pack["version"] and again.json()["signature"] == pack["signature"]
          and pack_files() == files_before, "unchanged data → same pack, no new file")
    check(again.headers.get("cache-control") == "no-cache", "latest/json is revalidated (no-cache)")
    meta = c.get("/api/pack/latest").json()
    check(meta["version"] == pack["version"] and meta["node_count"] == len(pack["nodes"]), "meta matches latest/json")
    b1 = c.post("/api/pack/build").json()
    b2 = c.post("/api/pack/build").json()
    check(b1["version"] == b2["version"] == pack["version"], "/build does not force a new version")
    r = c.get(meta["download_url"])
    check(r.status_code == 200 and "immutable" in r.headers.get("cache-control", "")
          and r.json()["signature"] == meta["signature"], "download serves the version, cached as immutable")
    N = reg(name="New place", lat=19.005, lon=73.0, gps_accuracy_m=5).json()["node"]["code"]
    newer = c.get("/api/pack/latest/json").json()
    check(newer["version"] != pack["version"] and newer["signature"] != pack["signature"]
          and N in {n["code"] for n in newer["nodes"]}, "new place → new pack version containing it")
    os.remove(os.path.join(os.environ["PACK_DIR"], f"setu_pack_{newer['version']}.json"))
    rebuilt = c.get("/api/pack/latest/json")
    check(rebuilt.status_code == 200 and rebuilt.json()["signature"] == newer["signature"],
          "missing pack file is rebuilt")


# Step 3.1: OpenStreetMap places import
import json  # noqa: E402

from app.db import QrNode, SessionLocal  # noqa: E402
from app.services.osm_import import import_places, load_official_points, parse_places  # noqa: E402

FIXTURE = json.load(open(os.path.join(os.path.dirname(__file__), "fixtures", "osm_small.json"), encoding="utf-8"))
official = load_official_points()
check(len(official) == 5 and any(p.name == "Ramkund Ghat" for p in official),
      "official OSM-matched places read from officialPlaces.ts")

def run_import(elements, prune=False):
    db = SessionLocal()
    try:
        rep = import_places(db, parse_places(elements, official=official), prune=prune)
        db.commit()
        return rep
    finally:
        db.close()

with TestClient(app, headers=ADMIN) as c:
    # A volunteer already registered the toilet at 1008's spot.
    reg = lambda **kw: c.post("/api/volunteer/register", json={"location_name": kw.pop("name"), "local_name": "x", **kw})
    vol = reg(name="Toilet block 7", lat=20.01201, lon=73.80101, node_type="toilet", gps_accuracy_m=5).json()
    check(vol["success"] and not vol["node"]["code"].startswith("OSM-"), "volunteer toilet registered")

    rep = run_import(FIXTURE["elements"])
    got = {n["code"]: n for n in c.get("/api/nodes").json() if n["code"].startswith("OSM-")}
    check(sorted(got) == sorted(["OSM-N1001", "OSM-N1002", "OSM-N1004", "OSM-N1006", "OSM-N1007", "OSM-N1010",
                                 "OSM-N1011", "OSM-N1012", "OSM-N1013"]),
          f"import keeps the right places: {sorted(got)}")
    check(rep.skipped_near_volunteer == ["OSM-N1008"], "OSM toilet next to the volunteer's toilet is skipped")
    check(got["OSM-N1002"]["local_name"] == "काळाराम मंदिर" and got["OSM-N1002"]["node_type"] == "temple",
          "temple with its Marathi name (way twin merged)")
    check(got["OSM-N1004"]["name"] == "Ramkund Ghat" and got["OSM-N1004"]["node_type"] == "ghat",
          "feature at an official point takes the official name")
    check(got["OSM-N1012"]["name"] == "Ram Mandir" and got["OSM-N1012"]["node_type"] == "temple",
          "a second feature 10 m from an official point keeps its own name and type")
    check(got["OSM-N1010"]["name"] == "Bus stand" and got["OSM-N1010"]["local_name"] == "बस स्थानक",
          "Devanagari-only name becomes the local name")
    check(got["OSM-N1001"]["gps_accuracy_m"] is None and "not yet confirmed" in got["OSM-N1001"]["description"],
          "imported places are unconfirmed")

    v1 = c.get("/api/pack/latest").json()["version"]
    rep = run_import(FIXTURE["elements"])
    check(not rep.inserted and not rep.updated and c.get("/api/pack/latest").json()["version"] == v1,
          "re-import of the same data changes nothing (same pack)")

    # Near a map place without saying "this is it" → a new place; the map place is untouched.
    r = reg(name="Kalaram Mandir", lat=20.01513, lon=73.8050, node_type="temple", gps_accuracy_m=6).json()
    dp = c.get("/api/nodes/OSM-N1013").json()
    check(r["success"] and r["node"]["code"] != "OSM-N1013" and dp["name"] == "Sti Datta Paduka"
          and dp["gps_accuracy_m"] is None, "saving next to a different map place never takes it over")
    # Confirming needs an explicit choice, the same kind of place and being near it.
    r = reg(name="Parking P3", lat=20.01305, lon=73.79905, node_type="parking", confirm_code="OSM-N1011")
    check(r.status_code == 400, "confirm a map place without GPS accuracy → 400")
    r = reg(name="Parking P3", lat=20.01305, lon=73.79905, node_type="toilet", gps_accuracy_m=7, confirm_code="OSM-N1011")
    check(r.status_code == 400, "confirm a map place of another kind → 400")
    r = reg(name="Parking P3", lat=20.0140, lon=73.7990, node_type="parking", gps_accuracy_m=7, confirm_code="OSM-N1011")
    check(r.status_code == 400, "confirm a map place from 110 m away → 400")
    r = reg(name="Parking P3", lat=20.01305, lon=73.79905, node_type="parking", gps_accuracy_m=7,
            confirm_code="OSM-N1011").json()
    check(r["success"] and r["node"]["code"] == "OSM-N1011" and r["node"]["gps_accuracy_m"] == 7
          and r["node"]["name"] == "Parking P3", "\"This is <map place>\" confirms it (same code)")
    r = reg(name="Again", lat=20.01305, lon=73.79905, node_type="parking", gps_accuracy_m=7, confirm_code="OSM-N1011")
    check(r.status_code == 400, "an already confirmed place can't be confirmed again")
    moved = [dict(e, lat=e["lat"] + 0.001) if e["id"] == 1011 else e for e in FIXTURE["elements"]]
    rep = run_import(moved)
    p3 = c.get("/api/nodes/OSM-N1011").json()
    check("OSM-N1011" in rep.confirmed_kept and abs(p3["lat"] - 20.01305) < 1e-9 and p3["name"] == "Parking P3",
          "re-import never moves a volunteer-confirmed place")

    without = [e for e in FIXTURE["elements"] if e["id"] not in (1007, 1011)]
    rep = run_import(without)
    check(sorted(rep.missing) == ["OSM-N1007", "OSM-N1011"] and not rep.pruned
          and c.get("/api/nodes/OSM-N1007").status_code == 200, "places gone from OSM are only listed")
    rep = run_import(without, prune=True)
    check(rep.pruned == ["OSM-N1007"] and c.get("/api/nodes/OSM-N1007").status_code == 404
          and c.get("/api/nodes/OSM-N1011").status_code == 200, "--prune removes unconfirmed ones, keeps confirmed")


# Step 3.2: OpenStreetMap roads and footpaths as lanes
from app.services.osm_network import import_network  # noqa: E402

WAYS = json.load(open(os.path.join(os.path.dirname(__file__), "fixtures", "osm_ways_small.json"), encoding="utf-8"))

def run_network(elements, water=None):
    db = SessionLocal()
    try:
        rep = import_network(db, elements, water=water, allow_without_water=water is None)
        db.commit()
        return rep
    finally:
        db.close()

with TestClient(app, headers=ADMIN) as c:
    rep = run_network(WAYS["elements"])
    edges = [e for e in c.get("/api/edges").json() if e["source"] == "osm"]
    codes = {x for e in edges for x in (e["from_code"], e["to_code"])}
    check("OSM-J5" not in codes and "OSM-J6" not in codes, "motorway and private road are not lanes")
    lanes = {frozenset((e["from_code"], e["to_code"])): e for e in edges}
    steps = lanes.get(frozenset(("OSM-J4", "OSM-J7")))
    foot = lanes.get(frozenset(("OSM-J2", "OSM-J4")))
    check(steps and steps["surface"] == "steps" and foot and foot["cost_mult"] == 1.2 and not foot["verified"],
          "steps and footway lanes: surface, cost, unverified")
    check(any(e["name"] == "MG Road" and e["passage_kind"] == "corridor" for e in edges), "street name kept on lanes")
    toilet = [e for e in edges if "OSM-N1001" in (e["from_code"], e["to_code"])]
    check(len(toilet) == 1 and toilet[0]["passage_kind"] == "connector" and toilet[0]["cost_mult"] == 1.5,
          "place 0 m from MG Road joined by one connector")
    split = toilet[0]["to_code"] if toilet[0]["from_code"] == "OSM-N1001" else toilet[0]["from_code"]
    check(split.startswith("OSM-A") and frozenset(("OSM-J1", "OSM-J2")) not in lanes
          and frozenset(("OSM-J1", split)) in lanes and frozenset((split, "OSM-J2")) in lanes,
          "MG Road split where the place joins it")
    check("OSM-N1002" in rep.places_not_joined, "place far from every lane is not joined")
    nodes = {n["code"]: n for n in c.get("/api/nodes").json()}
    check(nodes["OSM-J2"]["node_type"] == "junction" and nodes["OSM-J2"]["name"] == "", "junctions are hidden places")

    rep = run_network(WAYS["elements"])
    check(rep.inserted == 0 and rep.updated == 0 and rep.removed == 0, "re-import of the same roads changes nothing")

    c.post("/api/volunteer/edge-status", json={"from_code": "OSM-J2", "to_code": "OSM-J4", "blocked": True,
                                              "walkable": False, "obstacle_note": "barricade"})
    run_network(WAYS["elements"])
    foot = next(e for e in c.get("/api/edges").json() if {e["from_code"], e["to_code"]} == {"OSM-J2", "OSM-J4"})
    check(foot["blocked"] and foot["obstacle_note"] == "barricade", "re-import keeps a volunteer's block on a map lane")
    # Audit fix: a re-import keeps one-way rules, a "wall" and a walked shape that people set.
    from app.db import Edge  # noqa: E402

    _db = SessionLocal()
    mg = _db.query(Edge).filter(Edge.source == "osm", Edge.name == "MG Road").first()
    # Stored the other way round (sync and walks re-orient lanes): one-way from the map's "to" end.
    mg.from_code, mg.to_code = mg.to_code, mg.from_code
    mg.heading_ab, mg.heading_ba = 11.0, 191.0
    mg.bidirectional = False
    mg.passage_kind = "wall"
    mg.verified = True
    mg.path_json = json.dumps([{"lat": 1.0, "lon": 2.0}, {"lat": 1.0001, "lon": 2.0}])
    mg_id, mg_from = mg.id, mg.from_code
    _db.commit()
    _db.close()
    run_network(WAYS["elements"])
    _db = SessionLocal()
    mg = _db.get(Edge, mg_id)
    check(mg is not None and mg.bidirectional is False and mg.passage_kind == "wall" and mg.verified
          and '"lat": 1.0' in (mg.path_json or ""),
          "re-import keeps an admin's one-way rule, a lane marked as a wall and a volunteer's walked shape")
    check(mg is not None and mg.from_code == mg_from and mg.heading_ab == 11.0,
          "re-import keeps the stored direction of a lane (a one-way rule is never turned around)")
    _db.close()

    without_steps = [w for w in WAYS["elements"] if w["id"] != 5]
    run_network(without_steps)
    gone = c.get("/api/nodes/OSM-J7")
    check(gone.status_code == 404 and not any({e["from_code"], e["to_code"]} == {"OSM-J4", "OSM-J7"}
                                              for e in c.get("/api/edges").json()),
          "lane gone from OSM is removed with its junction")
    pack = c.get("/api/pack/latest/json", headers={"Accept-Encoding": "gzip"})
    check(pack.headers.get("content-encoding") == "gzip" and any(e["source"] == "osm" for e in pack.json()["edges"]),
          "pack carries map lanes, gzipped")


# Step 5.2: visitor reports are suggestions; volunteers confirm timed blocks
from app.db import BlockReport, Edge  # noqa: E402

with TestClient(app) as anon, TestClient(app, headers=VOL2) as vc:
    lane = ("OSM-J1", split)  # an open map lane from the 3.2 fixture
    v0 = anon.get("/api/pack/latest").json()["version"]
    rep = lambda f, t, dev="phone-aaaa-1": anon.post("/api/reports", json={"from_code": f, "to_code": t, "device": dev})
    r = rep(lane[0], lane[1])
    check(r.status_code == 201 and anon.get("/api/pack/latest").json()["version"] == v0,
          "visitor report is accepted and changes nothing for others")
    again = rep(lane[1], lane[0]).json()
    check(again["duplicate"] and again["id"] == r.json()["id"], "same phone, same lane → one report")
    other = rep(lane[0], lane[1], "phone-bbbb-2").json()
    check(not other["duplicate"], "another phone on the same IP is a second reporter")
    check(anon.get("/api/reports").status_code == 401, "only volunteers see reports")
    listed = vc.get("/api/reports", params={"lat": 20.005, "lon": 73.79}).json()
    check(len(listed) == 1 and listed[0]["reporters"] == 2 and listed[0]["distance_m"] is not None,
          "volunteer sees one entry for the lane: 2 phones, with its distance")
    rid = listed[0]["id"]
    r = vc.post(f"/api/reports/{rid}/confirm", json={"hours": 1})
    e = next(x for x in c.get("/api/edges").json() if {x["from_code"], x["to_code"]} == set(lane))
    v1 = anon.get("/api/pack/latest").json()["version"]
    in_pack = any({x["from_code"], x["to_code"]} == set(lane) for x in anon.get("/api/pack/latest/json").json()["edges"])
    check(r.status_code == 200 and e["blocked"] and v1 != v0 and not in_pack,
          "confirm (1 h) blocks the lane: new pack without it")
    check(vc.post(f"/api/reports/{rid}/confirm", json={"hours": 1}).status_code == 409, "a report is settled once")

    _db = _Session()
    row = _db.query(Edge).filter(Edge.id == e["id"]).first()
    row.blocked_until = datetime.utcnow() - timedelta(minutes=1)
    _db.commit()
    _db.close()
    v2 = anon.get("/api/pack/latest").json()["version"]
    back = any({x["from_code"], x["to_code"]} == set(lane) for x in anon.get("/api/pack/latest/json").json()["edges"])
    check(v2 != v1 and back, "the block ends by itself: next pack has the lane again")

    r = rep(lane[0], lane[1])
    rid = r.json()["id"]
    check(vc.post(f"/api/reports/{rid}/reject").status_code == 200
          and not next(x for x in c.get("/api/edges").json() if x["id"] == e["id"])["blocked"],
          "reject leaves the lane open")
    others = [(x["from_code"], x["to_code"]) for x in c.get("/api/edges").json()
              if x["source"] == "osm" and not x["blocked"] and x["walkable"]][:6]
    codes = [rep(f, t).status_code for f, t in others]
    # 2 reports from this phone already this hour (one confirmed, one rejected).
    check(codes[:3] == [201, 201, 201] and set(codes[3:]) == {429},
          f"more than 5 reports an hour from one phone → 429 ({codes})")
    # Many phones behind one mobile-network IP: only a flood limit per IP.
    many = [rep(f, t, f"phone-{i:04d}-x").status_code for i, (f, t) in
            enumerate((others * 60)[:60])]
    check(201 in many and many[-1] == 429 and many.count(201) == 60 - 6,
          f"60 reports an hour per IP, whatever the phone ids ({many.count(201)} accepted)")
    check(anon.post("/api/reports", json={"from_code": "OSM-J1", "to_code": "NOPE"}).status_code == 404,
          "report on a lane that doesn't exist → 404")


# Step 5.3: admin map overview
with TestClient(app) as anon:
    check(anon.get("/api/admin/overview", headers=VOL2).status_code == 403, "volunteer cannot open the admin map (403)")
    ov = anon.get("/api/admin/overview", headers=ADMIN)
    body = ov.json() if ov.status_code == 200 else {}
    lane_ids = {x["id"] for x in body.get("lanes", [])}
    check(ov.status_code == 200 and not any(p["code"].startswith("OSM-J") for p in body["places"])
          and "OSM-J2" in body["junctions"] and len(lane_ids) == len(anon.get("/api/edges", headers=ADMIN).json()),
          "admin overview: places (no junctions), junction positions, every lane incl. blocked")
    check(any(p["confirmed"] for p in body["places"]) and any(not p["confirmed"] for p in body["places"]),
          "admin overview marks confirmed and unconfirmed places")


# Missing-route fix: a first setup builds the dataset in one command (start.sh runs it).
import shutil  # noqa: E402
import subprocess  # noqa: E402

if not os.environ.get("SETU_TEST_DATABASE_URL"):
    _fx = os.path.join(os.path.dirname(__file__), "fixtures")
    _raw = os.path.join(_tmp, "osm-saved")
    os.makedirs(_raw, exist_ok=True)
    shutil.copy(os.path.join(_fx, "osm_small.json"), os.path.join(_raw, "places-20260101.json"))
    shutil.copy(os.path.join(_fx, "osm_ways_small.json"), os.path.join(_raw, "network-20260101.json"))
    # `all` also imports water: give it a saved answer too, or it would download one.
    shutil.copy(os.path.join(_fx, "osm_river_water.json"), os.path.join(_raw, "water-20260101.json"))
    # The checks never use the network: any download attempt fails at once.
    _env = {**os.environ, "SQLITE_PATH": os.path.join(_tmp, "first-run.db"), "PACK_DIR": os.path.join(_tmp, "first-packs"),
            "HTTPS_PROXY": "http://127.0.0.1:9", "HTTP_PROXY": "http://127.0.0.1:9", "NO_PROXY": ""}
    _cmd = [sys.executable, os.path.join(os.path.dirname(__file__), "import_osm.py"), "all", "--saved", "--raw-dir", _raw]
    out = subprocess.run(_cmd, env=_env, capture_output=True, text=True, timeout=120)
    last = [line for line in out.stdout.splitlines() if line.startswith("Pack ")]
    check(out.returncode == 0 and last and " 0 lanes" not in last[-1] and ": 0 places" not in last[-1]
          and "junctions" in last[-1],
          f"import_osm.py all --saved builds places and lanes on an empty database ({last[-1] if last else out.stderr[-200:]})")
    out2 = subprocess.run(_cmd, env=_env, capture_output=True, text=True, timeout=120)
    check(out2.returncode == 0 and "inserted 0" in out2.stdout, "running the dataset build again changes nothing")


# Phase D: Godavari river safeguards
from app.services.osm_network import MissingWaterData  # noqa: E402
from app.services.water import parse_water  # noqa: E402

_fx = os.path.join(os.path.dirname(__file__), "fixtures")
RIVER_WAYS = json.load(open(os.path.join(_fx, "osm_river_ways.json"), encoding="utf-8"))
RIVER_WATER = parse_water(json.load(open(os.path.join(_fx, "osm_river_water.json"), encoding="utf-8"))["elements"])

with TestClient(app, headers=ADMIN) as c:
    _db = SessionLocal()
    try:
        import_network(_db, RIVER_WAYS["elements"])
        refused = False
    except MissingWaterData:
        refused = True
    finally:
        _db.rollback()
        _db.close()
    check(refused, "street import refuses to run without river data (unless overridden)")

    # North bank place 3 m from the river: the south street is nearer (25 m) but across it.
    c.post("/api/nodes", json={"code": "RIV-P", "name": "North bank ghat", "lat": 20.01003, "lon": 73.8025})
    # North bank place whose only street within 60 m is across the river.
    c.post("/api/nodes", json={"code": "RIV-Q", "name": "Lonely north ghat", "lat": 20.01003, "lon": 73.8058})
    c.post("/api/nodes", json={"code": "RIV-S", "name": "South bank temple", "lat": 20.0096, "lon": 73.8031})
    rep = run_network(RIVER_WAYS["elements"], RIVER_WATER)
    lanes = {frozenset((e["from_code"], e["to_code"])): e for e in c.get("/api/edges").json() if e["source"] == "osm"}
    check(lanes.get(frozenset(("OSM-J103", "OSM-J203")), {}).get("passage_kind") == "bridge",
          "the mapped footbridge is kept and marked as a bridge")
    check(frozenset(("OSM-J102", "OSM-J202")) not in lanes and any(b["way"] == 14 for b in rep.blocked_crossings),
          "an unbridged footway across the river is left out and reported")
    check(frozenset(("OSM-J101", "OSM-J201")) not in lanes and any(b["way"] == 15 and b["reason"] == "ford" for b in rep.blocked_crossings),
          "a ford is left out")
    check(frozenset(("OSM-J101", "OSM-J102")) in lanes or any("OSM-J101" in k for k in lanes),
          "the bank-side street next to a cut crossing stays usable")
    p_link = [e for k, e in lanes.items() if "RIV-P" in k]
    other = [x for x in (p_link[0]["from_code"], p_link[0]["to_code"]) if x != "RIV-P"][0] if p_link else None
    p_end = c.get(f"/api/nodes/{other}").json() if other else {}
    check(len(p_link) == 1 and p_end.get("lat", 0) > 20.0100 and any(r["place"] == "RIV-P" and r["joined"] for r in rep.connectors_rejected),
          "a place by the river joins the street on its own bank, not the nearer one across the water")
    check(not any("RIV-Q" in k for k in lanes) and any(r["place"] == "RIV-Q" and not r["joined"] for r in rep.connectors_rejected),
          "a place whose only nearby street is across the river is not joined (no route, said honestly)")
    # Every lane that crosses the river line is a bridge.
    def crosses(e):
        pts = [(p["lat"]) for p in json.loads(e["path_json"] or "[]")]
        return pts and min(pts) < 20.0100 < max(pts)
    check(all(e["passage_kind"] == "bridge" for e in lanes.values() if crosses(e)),
          "the only lane across the river is the bridge")

    # An unbridged crossing a person checked and approved is kept.
    from app.services.osm_network import build_network  # noqa: E402

    net = build_network(RIVER_WAYS["elements"], water=RIVER_WATER,
                        approved={14: {"way": 14, "status": "remotely_reviewed"}})
    seg = [g for g in net.segs if {g.a, g.b} == {"OSM-J102", "OSM-J202"}]
    check(seg and seg[0].bridge and any(b.get("approved") == "remotely_reviewed" for b in net.bridges),
          "an approved (reviewed) unbridged crossing is kept and marked with its review status")

    # A straight volunteer link drawn across the river is kept out of the pack.
    os.environ["OSM_DIR"] = os.path.join(_tmp, "osm-water")
    os.makedirs(os.environ["OSM_DIR"], exist_ok=True)
    shutil.copy(os.path.join(_fx, "osm_river_water.json"), os.path.join(os.environ["OSM_DIR"], "water-20260101.json"))
    from app.config import settings as _settings  # noqa: E402
    _settings.osm_dir = os.environ["OSM_DIR"]
    r = c.post("/api/edges", json={"from_code": "RIV-P", "to_code": "RIV-S", "distance_m": 50})
    # The import above wrote straight to the database: rebuild now instead of
    # waiting out the API's 30 s pack cache.
    c.post("/api/pack/build")
    pack_edges = c.get("/api/pack/latest/json").json()["edges"]
    check(r.status_code == 200 and not any({e["from_code"], e["to_code"]} == {"RIV-P", "RIV-S"} for e in pack_edges)
          and any(e["passage_kind"] == "bridge" for e in pack_edges),
          "a straight unrecorded link across the river is kept out of the pack (bridges stay)"
          f" [link {r.status_code}, in pack {sum({e['from_code'], e['to_code']} == {'RIV-P', 'RIV-S'} for e in pack_edges)},"
          f" bridges {sum(e['passage_kind'] == 'bridge' for e in pack_edges)}]")
    out = subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "validate_graph.py")],
                         env={**os.environ}, capture_output=True, text=True, timeout=120)
    check(out.returncode == 0 and "1 unsafe (left out of the pack)" in out.stdout,
          f"validate_graph reports the unsafe link and passes the pack ({out.stdout.strip().splitlines()[1] if out.stdout else out.stderr[-200:]})")

    # Audit fixes: a "bridge" label, end stretches and walks are no way past the river check.
    def riv_in_pack(a, b):
        c.post("/api/pack/build")
        return any({e["from_code"], e["to_code"]} == {a, b} for e in c.get("/api/pack/latest/json").json()["edges"])

    from app.db import Edge as _Edge  # noqa: E402

    _db = _Session()
    link = _db.query(_Edge).filter(_Edge.from_code == "RIV-P", _Edge.to_code == "RIV-S").first()
    link.passage_kind = "bridge"  # e.g. typed in by a person, not from the OSM import
    _db.commit()
    link_id = link.id
    _db.close()
    check(not riv_in_pack("RIV-P", "RIV-S"),
          "a lane people added across the river stays out of the pack even when labelled 'bridge'")
    r = c.post("/api/volunteer/edge-status", json={"from_code": "RIV-P", "to_code": "RIV-S", "passage_kind": "bridge"})
    check(r.status_code == 422, f"a volunteer cannot label a lane 'bridge' (only the OSM import does) [{r.status_code}]")
    c.post("/api/admin/verify", json={"target": "lane", "lane_id": link_id, "status": "remotely_reviewed", "note": "checked"})
    check(not riv_in_pack("RIV-P", "RIV-S"),
          "an admin's trust level does not approve a straight line nobody walked across the river")
    c.post("/api/admin/verify", json={"target": "lane", "lane_id": link_id, "status": "rejected", "note": "test done"})
    # A path drawn on the north bank only: the stretch to the south-bank place crosses the river.
    north = json.dumps([{"lat": 20.0102, "lon": 73.8058}, {"lat": 20.0102, "lon": 73.8031}])
    r = c.post("/api/edges", json={"from_code": "RIV-Q", "to_code": "RIV-S", "distance_m": 300, "path_json": north})
    check(r.status_code == 200 and not riv_in_pack("RIV-Q", "RIV-S"),
          "a lane whose drawn end stretch crosses the river is kept out (not only its middle path)")
    # A volunteer walk across the river (GPS gap on a bridge?) waits for an admin.
    _db = _Session()
    _db.add(QrNode(code="RIV-N2", name="North bank shop", lat=20.0104, lon=73.8040, node_type="landmark"))
    _db.add(QrNode(code="RIV-S2", name="South bank shop", lat=20.0096, lon=73.8040, node_type="landmark"))
    _db.commit()
    _db.close()
    r = c.post("/api/volunteer/record-path", json={"from_code": "RIV-N2", "to_code": "RIV-S2", "waypoints": [
        {"lat": 20.0104 - i * 0.00008, "lon": 73.8040, "t_ms": i} for i in range(11)]})
    check(r.status_code == 200 and not riv_in_pack("RIV-N2", "RIV-S2"),
          "a recorded walk across the river stays out of the pack until an admin checks it")
    walk_id = next(e["id"] for e in c.get("/api/edges").json() if {e["from_code"], e["to_code"]} == {"RIV-N2", "RIV-S2"})
    c.post("/api/admin/verify", json={"target": "lane", "lane_id": walk_id, "status": "officially_verified", "note": "bridge"})
    check(riv_in_pack("RIV-N2", "RIV-S2"), "the walk goes into the pack once an admin approved it")
    c.post("/api/volunteer/record-path", json={"from_code": "RIV-N2", "to_code": "RIV-S2", "waypoints": [
        {"lat": 20.0104, "lon": 73.8040, "t_ms": 0}, {"lat": 20.0096, "lon": 73.8041, "t_ms": 1}]})
    after = next(e for e in c.get("/api/edges").json() if e["id"] == walk_id)
    check(after["verification"] == "volunteer_verified" and not riv_in_pack("RIV-N2", "RIV-S2"),
          "a new walk across the river takes the approval back (out of the pack until checked again)")
    # A map bridge closed and reopened from the obstacle screen (which always sends a lane kind) stays a bridge.
    bridge = next(e for e in c.get("/api/edges").json() if e["source"] == "osm" and e["passage_kind"] == "bridge")
    ends = {"from_code": bridge["from_code"], "to_code": bridge["to_code"], "passage_kind": "corridor"}
    c.post("/api/volunteer/edge-status", json={**ends, "blocked": True})
    c.post("/api/volunteer/edge-status", json={**ends, "blocked": False})
    again = next(e for e in c.get("/api/edges").json() if e["id"] == bridge["id"])
    check(again["passage_kind"] == "bridge" and riv_in_pack(bridge["from_code"], bridge["to_code"]),
          "a map bridge closed and reopened stays a bridge and back in the pack")
    # Damaged input never reaches the pack.
    out_of_range = [c.post("/api/nodes", json={"code": "BAD-LAT", "name": "x", "lat": 999, "lon": 73.8}).status_code,
                    c.post("/api/edges", json={"from_code": "RIV-N2", "to_code": "RIV-Q", "distance_m": -5}).status_code,
                    c.post("/api/edges", json={"from_code": "RIV-N2", "to_code": "RIV-Q", "distance_m": 5, "cost_mult": 0.1}).status_code]
    check(out_of_range == [422, 422, 422], f"admin inputs out of range (lat 999, negative length, cost below 1) are refused {out_of_range}")
    bad = c.post("/api/edges", json={"from_code": "RIV-N2", "to_code": "RIV-Q", "distance_m": 5, "path_json": "5"})
    check(bad.status_code == 422 and c.get("/api/pack/latest/json").status_code == 200,
          f"a lane path that is not a list of points is refused (the pack keeps working) [{bad.status_code}]")
    nan = c.post("/api/volunteer/record-path", content='{"from_code":"RIV-N2","to_code":"RIV-Q","waypoints":'
                 '[{"lat":NaN,"lon":73.8},{"lat":20.01,"lon":73.8}]}', headers={"Content-Type": "application/json"})
    sos_nan = c.post("/api/sos", content='{"client_id":"nan-test-000000000001","kind":"other","lat":NaN,"lon":73.8}',
                     headers={"Content-Type": "application/json"})
    check(nan.status_code == 422 and sos_nan.status_code == 422,
          f"NaN coordinates are refused with 422, not saved or a 500 [{nan.status_code}, {sos_nan.status_code}]")
    r = c.post("/api/volunteer/register", json={"location_name": "Hidden", "local_name": "x", "code": "OSM-J123456",
                                                     "lat": 20.02, "lon": 73.80})
    check(r.status_code == 400, f"a volunteer cannot pick an OSM-… code (it would hide the place from admins) [{r.status_code}]")
    # A walk sent late from the offline queue never reopens a lane closed meanwhile.
    _db = _Session()
    _db.add(QrNode(code="WLK-A", name="Walk A", lat=20.0300, lon=73.8000, node_type="landmark"))
    _db.add(QrNode(code="WLK-B", name="Walk B", lat=20.0300, lon=73.8006, node_type="landmark"))
    _db.commit()
    _db.close()
    c.post("/api/edges", json={"from_code": "WLK-A", "to_code": "WLK-B", "distance_m": 63})
    c.post("/api/volunteer/edge-status", json={"from_code": "WLK-A", "to_code": "WLK-B", "blocked": True})
    r = c.post("/api/volunteer/record-path", json={"from_code": "WLK-A", "to_code": "WLK-B", "waypoints": [
        {"lat": 20.0300, "lon": 73.8000 + i * 0.00006, "t_ms": i} for i in range(11)]})
    check(r.status_code == 200 and r.json().get("still_closed") is True and not riv_in_pack("WLK-A", "WLK-B"),
          "a recorded walk does not reopen a closed lane (reopening is its own decision)")
    c.post("/api/volunteer/edge-status", json={"from_code": "WLK-A", "to_code": "WLK-B", "blocked": False})
    check(riv_in_pack("WLK-A", "WLK-B"), "reopening the lane explicitly puts it back in the pack")

# Without water data the river checks cannot run: validation must fail, not say OK.
_empty = os.path.join(_tmp, "osm-empty")
os.makedirs(_empty, exist_ok=True)
out = subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "validate_graph.py")],
                     env={**os.environ, "OSM_DIR": _empty}, capture_output=True, text=True, timeout=120)
check(out.returncode == 1 and "FAIL: river checks could not run" in out.stdout and "\nOK:" not in out.stdout,
      "validate_graph fails (exit 1, no OK) when there is no water data and there are lanes")
_cfg = os.path.join(os.path.dirname(__file__), "..", "config", "approved_crossings.json")
_ignore = open(os.path.join(os.path.dirname(__file__), "..", ".dockerignore")).read().split()
check(os.path.exists(_cfg) and not any(pat.rstrip("/") in ("config", "config/approved_crossings.json") for pat in _ignore),
      "approved crossings live in backend/config/ (shipped in the Docker image)")

# Phase C: trust levels (app/verification.py)
from sqlalchemy import text as _text  # noqa: E402

from app.db import _backfill_verification  # noqa: E402

with TestClient(app, headers=ADMIN) as c:
    # Rows from before trust levels get only what is known about them (an old
    # database: the column was added empty).
    from sqlalchemy import create_engine as _ce  # noqa: E402

    old_db = _ce("sqlite://")
    with old_db.begin() as conn:
        conn.execute(_text("CREATE TABLE qr_nodes (code TEXT, gps_accuracy_m FLOAT, verification TEXT)"))
        conn.execute(_text("CREATE TABLE edges (source TEXT, verified BOOLEAN, verification TEXT)"))
        conn.execute(_text("INSERT INTO qr_nodes VALUES ('OSM-N1', NULL, NULL), ('KUMBH-A01', 6.0, NULL), "
                           "('KUMBH-A02', NULL, NULL), ('OSM-N2', 5.0, NULL), ('OSM-N3', NULL, 'rejected')"))
        conn.execute(_text("INSERT INTO edges VALUES ('osm', 0, NULL), ('volunteer', 1, NULL), ('volunteer', 0, NULL), "
                           "('osm', 0, 'remotely_reviewed')"))
        _backfill_verification(conn)
        places = [r[0] for r in conn.execute(_text("SELECT verification FROM qr_nodes"))]
        lanes = [r[0] for r in conn.execute(_text("SELECT verification FROM edges"))]
    check(places == ["osm_imported", "volunteer_verified", "unverified", "volunteer_verified", "rejected"],
          f"backfill places: OSM → osm_imported, GPS-saved → volunteer_verified, else unverified; set ones kept ({places})")
    check(lanes == ["osm_imported", "volunteer_verified", "unverified", "remotely_reviewed"],
          f"backfill lanes: OSM → osm_imported, walked → volunteer_verified, else unverified; set ones kept ({lanes})")

    # Volunteer writes.
    vreg = lambda **kw: c.post("/api/volunteer/register", json={"location_name": kw.pop("name"), "local_name": "x", **kw})
    a = vreg(name="Trust A", lat=19.1, lon=73.1, gps_accuracy_m=5).json()["node"]
    b = vreg(name="Trust B", lat=19.1, lon=73.1003, connect_to_code=a["code"], gps_accuracy_m=6).json()["node"]
    old_app = vreg(name="Trust C", lat=19.1, lon=73.1006).json()["node"]
    link = next(e for e in c.get("/api/edges").json() if {e["from_code"], e["to_code"]} == {a["code"], b["code"]})
    check(a["verification"] == "volunteer_verified" and old_app["verification"] == "unverified"
          and link["verification"] == "unverified",
          "register: GPS place → volunteer_verified; no GPS → unverified; straight link → unverified")
    c.post("/api/volunteer/record-path", json={"from_code": a["code"], "to_code": b["code"], "waypoints": [
        {"lat": 19.1, "lon": 73.1 + i * 0.00003, "t_ms": i} for i in range(11)]})
    link = next(e for e in c.get("/api/edges").json() if e["id"] == link["id"])
    check(link["verification"] == "volunteer_verified", "a recorded walk makes the lane volunteer_verified")

    # A volunteer's walk never lifts an admin's rejection (it is saved for review).
    c.post("/api/admin/verify", json={"target": "lane", "lane_id": link["id"], "status": "rejected", "note": "unsafe"})
    path_before = next(e for e in c.get("/api/edges").json() if e["id"] == link["id"])["path_json"]
    r = c.post("/api/volunteer/record-path", json={"from_code": a["code"], "to_code": b["code"], "waypoints": [
        {"lat": 19.1, "lon": 73.1 + i * 0.000031, "t_ms": i} for i in range(11)]}).json()
    after = next(e for e in c.get("/api/edges").json() if e["id"] == link["id"])
    in_pack = any(e["id"] == link["id"] for e in c.get("/api/pack/latest/json").json()["edges"])
    check(after["verification"] == "rejected" and not in_pack and "rejected" in r["message"]
          and after["path_json"] != path_before,
          "a walk on a rejected lane keeps it rejected and out of the pack (walk saved for review)")
    c.post("/api/admin/verify", json={"target": "lane", "lane_id": link["id"], "status": "volunteer_verified"})

    # Admin review: only admins, only known statuses.
    verify = lambda **kw: c.post("/api/admin/verify", json=kw)
    check(c.post("/api/admin/verify", json={"target": "place", "code": "OSM-N1001", "status": "rejected"},
                 headers=VOL2).status_code == 403, "only an admin can set trust levels")
    check(verify(target="place", code="OSM-N1001", status="trusted").status_code == 422
          and verify(target="place", code="NOPE", status="rejected").status_code == 404,
          "unknown status → 422, unknown place → 404")
    r = verify(target="place", code="OSM-N1002", status="remotely_reviewed", note="checked on imagery")
    n = c.get("/api/nodes/OSM-N1002").json()
    check(r.status_code == 200 and n["verification"] == "remotely_reviewed", "admin marks a place reviewed on maps")
    db_ = SessionLocal()
    row = db_.query(QrNode).filter(QrNode.code == "OSM-N1002").first()
    check(row.verified_by is not None and row.verification_note == "checked on imagery", "who and why are recorded")
    db_.close()

    # Rejected: hidden from visitors, kept in the database, never revived by an import.
    verify(target="place", code="OSM-N1001", status="rejected", note="toilet does not exist")
    pack = c.get("/api/pack/latest/json").json()
    check(not any(x["code"] == "OSM-N1001" for x in pack["nodes"]) and c.get("/api/nodes/OSM-N1001").status_code == 200,
          "a rejected place is left out of the pack but kept in the database")
    rep = run_import(FIXTURE["elements"])
    check("OSM-N1001" in rep.confirmed_kept and c.get("/api/nodes/OSM-N1001").json()["verification"] == "rejected"
          and c.get("/api/nodes/OSM-N1002").json()["verification"] == "remotely_reviewed",
          "an OSM re-import never revives a rejected place or undoes a review")
    lane_id = next(e["id"] for e in c.get("/api/edges").json() if e["passage_kind"] == "bridge")
    verify(target="lane", lane_id=lane_id, status="rejected", note="bridge closed for repairs")
    pack = c.get("/api/pack/latest/json").json()
    check(not any(e["id"] == lane_id for e in pack["edges"]), "a rejected lane is left out of the pack")
    rep = run_network(RIVER_WAYS["elements"], RIVER_WATER)
    after = next((e for e in c.get("/api/edges").json() if e["id"] == lane_id), None)
    check(after is not None and after["verification"] == "rejected", "a network re-import keeps a rejected lane rejected")
    check(verify(target="lane", lane_id=lane_id, status="officially_verified").status_code == 200
          and any(e["id"] == lane_id for e in c.get("/api/pack/latest/json").json()["edges"]),
          "un-rejecting brings the lane back")

    pack = c.get("/api/pack/latest/json").json()
    check("attribution" in pack and "OpenStreetMap" in pack["attribution"] and isinstance(pack.get("sources"), dict),
          "the pack names its sources and carries the OpenStreetMap attribution")

# Oversized requests are refused, with or without a stated length.
with TestClient(app) as anon:
    big = b"x" * (5 * 1024 * 1024)
    r1 = anon.post("/api/reports", content=big, headers={"Content-Type": "application/json"})

    def chunks():
        for _ in range(6):
            yield b"x" * (1024 * 1024)

    r2 = anon.post("/api/reports", content=chunks(), headers={"Content-Type": "application/json"})
    check(r1.status_code == 413 and r2.status_code == 413, f"a body over 4 MB is refused, also when sent in chunks ({r1.status_code}, {r2.status_code})")
    check(anon.post("/api/reports", json={"from_code": "A", "to_code": "B"}).status_code != 413, "normal requests are not affected")
    r = anon.post("/api/volunteer/edge-status", headers=VOL2,
                  json={"from_code": "A1", "to_code": "B1", "blocked": True, "obstacle_note": "x" * 65})
    check(r.status_code == 422, f"an over-long note is refused cleanly (422), not a database error ({r.status_code})")

# Privacy: the public pack has what navigation needs, not when volunteers were where.
with TestClient(app) as anon:
    pk = anon.get("/api/pack/latest/json").json()
    walked = [e for e in pk["edges"] if e.get("path_json") and e["source"] == "volunteer"]
    raw = anon.get("/api/pack/latest/json").text
    check(walked and all(set(p) <= {"lat", "lon"} for e in walked for p in json.loads(e["path_json"])),
          "walked tracks in the public pack are positions only (no volunteer timestamps or compass readings)")
    check('"t_ms"' not in raw and all(e.get("obstacle_note") is None and e.get("verified_at") is None for e in pk["edges"])
          and not any("created_at" in n or "updated_at" in n for n in pk["nodes"]),
          "the public pack has no volunteer notes or record timestamps")
    full = anon.get("/api/edges", headers=ADMIN).json()
    check(any('"t_ms"' in (e.get("path_json") or "") for e in full), "staff still see the full walk record")

# Offline queue: a write sent again with the same Idempotency-Key is done once.
with TestClient(app) as anon:
    from uuid import uuid4

    key = str(uuid4())
    body = {"location_name": "Queued Ghat", "local_name": "रांगेतील घाट", "lat": 19.0071, "lon": 73.0071,
            "gps_accuracy_m": 6, "node_type": "ghat"}
    first = anon.post("/api/volunteer/register", json=body, headers={**VOL2, "Idempotency-Key": key})
    again = anon.post("/api/volunteer/register", json=body, headers={**VOL2, "Idempotency-Key": key})
    names = [n["name"] for n in anon.get("/api/nodes", headers=VOL2).json()]
    check(first.status_code == 200 and first.json()["success"] and again.json() == first.json()
          and again.headers.get("idempotent-replay") == "true" and names.count("Queued Ghat") == 1,
          "a queued write sent twice is saved once and the second send gets the same answer")
    other = anon.post("/api/volunteer/register", json=body, headers={**ADMIN, "Idempotency-Key": key})
    check(other.status_code == 422, "another volunteer cannot reuse someone's Idempotency-Key")
    check(anon.post("/api/volunteer/register", json=body, headers={**VOL2, "Idempotency-Key": "short"}).status_code == 400,
          "a malformed Idempotency-Key is refused")
    k2 = str(uuid4())
    bad = anon.post("/api/volunteer/register", json={**body, "gps_accuracy_m": 90}, headers={**VOL2, "Idempotency-Key": k2})
    bad2 = anon.post("/api/volunteer/register", json={**body, "gps_accuracy_m": 90}, headers={**VOL2, "Idempotency-Key": k2})
    check(bad.status_code == 400 and bad2.status_code == 400 and bad2.headers.get("idempotent-replay") == "true",
          "a refused write keeps its answer (the phone shows why, without resending forever)")
    check(anon.post("/api/volunteer/register", json=body, headers={"Idempotency-Key": str(uuid4())}).status_code == 401,
          "a keyed write without sign-in still needs sign-in")

# Simulated positions (development tool) never count as on-site proof.
with TestClient(app, headers=VOL2) as vc:
    sim_body = {"location_name": "Sim Ghat", "local_name": "सिम घाट", "lat": 19.0081, "lon": 73.0081,
                "gps_accuracy_m": 5, "node_type": "ghat", "simulated": True}
    r = vc.post("/api/volunteer/register", json=sim_body).json()
    check(r["success"] and r["node"]["verification"] == "unverified",
          "a place from simulated GPS is saved as unverified, never volunteer_verified")
    other = vc.post("/api/volunteer/register", json={**sim_body, "location_name": "Sim Ghat 2", "lat": 19.0083,
                                                     "simulated": False}).json()["node"]
    walk = vc.post("/api/volunteer/record-path", json={"from_code": r["node"]["code"], "to_code": other["code"],
                   "simulated": True, "waypoints": [{"lat": 19.0081 + i * 0.00002, "lon": 73.0081, "t_ms": i * 1000}
                                                    for i in range(11)]})
    lane = next(e for e in vc.get("/api/edges").json()
                if {e["from_code"], e["to_code"]} == {r["node"]["code"], other["code"]})
    check(walk.status_code == 200 and lane["verification"] == "unverified",
          "a simulated walk is kept for testing but the lane stays unverified")
    from app.config import settings as _settings
    _settings.setu_env = "production"
    try:
        refused = vc.post("/api/volunteer/register", json={**sim_body, "location_name": "Sim Ghat 3", "lat": 19.0085})
        check(refused.status_code == 403, "the live (production) server refuses simulated positions")
    finally:
        _settings.setu_env = "development"

# Admin tools: data checks and the audit log.
with TestClient(app, headers=ADMIN) as c:
    rep = c.get("/api/admin/graph-report").json()
    check({"river_crossing_errors", "possible_duplicate_places", "places_without_lane", "bridges"} <= set(rep),
          "the admin data checks return the graph report")
    check(c.get("/api/admin/graph-report", headers=VOL2).status_code == 403, "volunteers cannot run the admin data checks")
    log = c.get("/api/admin/audit?limit=500").json()
    actions = {e["action"] for e in log}
    check({"place.register", "lane.walk", "trust.set", "lane.status"} <= actions,
          f"volunteer and admin changes are in the audit log ({sorted(actions)})")
    trust = next(e for e in log if e["action"] == "trust.set")
    check("→" in trust["summary"] and trust["actor"] and trust["target"].split(":")[0] in ("place", "lane"),
          "an audit entry says who changed what, from → to")
    reg = {e["summary"].split(" (")[0]: e["summary"] for e in log if e["action"] == "place.register"}
    check("simulated" in reg.get("Registered Sim Ghat", "") and "simulated" not in reg.get("Registered Sim Ghat 2", "x simulated"),
          "simulated changes are marked in the audit log (real ones are not)")
    check(not any(any(ch.isdigit() for ch in (e["actor"] or "")) and len(e["actor"]) >= 10 for e in log),
          "the audit log shows names, not phone numbers")
    one = c.get(f"/api/admin/audit?target={trust['target']}").json()
    check(one and all(e["target"] == trust["target"] for e in one), "the audit log can be filtered to one place or lane")
    check(c.get("/api/admin/audit", headers=VOL2).status_code == 403, "volunteers cannot read the audit log")

# Publishing (PUBLISH_MODE=manual): new data waits for an admin; closures,
# reopenings and rejections reach phones at once; rollback keeps closures live.
from app.config import settings as _cfg

with TestClient(app, headers=ADMIN) as c, TestClient(app, headers=VOL2) as vc:
    check(c.post("/api/admin/publish", json={}).status_code == 409, "publishing is refused while PUBLISH_MODE=auto")
    _cfg.publish_mode = "manual"
    try:
        def pack():
            c.post("/api/pack/build")
            return c.get("/api/pack/latest/json").json()

        rel = c.get("/api/admin/releases").json()
        check(rel["mode"] == "manual" and rel["live"] and rel["live"]["by"] == "automatic"
              and rel["draft"]["places_added"] == 0,
              "switching publishing on makes today's data the first version (phones never get an empty map)")
        first_id = rel["live"]["id"]
        before = pack()
        r = vc.post("/api/volunteer/register", json={"location_name": "Draft Ghat", "local_name": "ड्राफ्ट घाट",
                    "lat": 19.0091, "lon": 73.0091, "gps_accuracy_m": 5, "node_type": "ghat"}).json()
        draft_code = r["node"]["code"]
        p1 = pack()
        check(r["success"] and r["live"] is False and not any(n["code"] == draft_code for n in p1["nodes"]),
              "a new place waits for publishing (the volunteer is told it is not live yet)")
        rel = c.get("/api/admin/releases").json()
        check(rel["draft"]["places_added"] == 1 and any("Draft Ghat" in x for x in rel["draft"]["examples"]),
              "the admin sees what is waiting to be published")

        lane = next(e for e in p1["edges"] if e["source"] == "volunteer")
        vc.post("/api/volunteer/edge-status", json={"from_code": lane["from_code"], "to_code": lane["to_code"], "blocked": True})
        p2 = pack()
        check(not any(e["id"] == lane["id"] for e in p2["edges"]), "a lane closure reaches phones at once (no publishing)")
        vc.post("/api/volunteer/edge-status", json={"from_code": lane["from_code"], "to_code": lane["to_code"], "blocked": False})
        check(any(e["id"] == lane["id"] for e in pack()["edges"]), "reopening a lane reaches phones at once")

        victim = next(n for n in p1["nodes"] if n["code"].startswith("KUMBH-") and n["code"] != draft_code)
        c.post("/api/admin/verify", json={"target": "place", "code": victim["code"], "status": "rejected", "note": "test"})
        check(not any(n["code"] == victim["code"] for n in pack()["nodes"]), "a rejection takes a place off phones at once")

        out = c.post("/api/admin/publish", json={"note": "checks: add Draft Ghat"})
        p3 = pack()
        check(out.status_code == 200 and any(n["code"] == draft_code for n in p3["nodes"])
              and not any(n["code"] == victim["code"] for n in p3["nodes"]),
              "publishing puts the new place on phones (the rejected one stays off)")
        check(vc.post("/api/admin/publish", json={}).status_code == 403
              and vc.post("/api/admin/rollback", json={"release_id": first_id}).status_code == 403,
              "only admins can publish or roll back")

        vc.post("/api/volunteer/edge-status", json={"from_code": lane["from_code"], "to_code": lane["to_code"], "blocked": True})
        back = c.post("/api/admin/rollback", json={"release_id": first_id})
        p4 = pack()
        check(back.status_code == 200 and not any(n["code"] == draft_code for n in p4["nodes"])
              and c.get(f"/api/nodes/{draft_code}").status_code == 200,
              "rolling back takes the new place off phones but keeps it in the database")
        check(not any(e["id"] == lane["id"] for e in p4["edges"]), "after a rollback today's closures still apply")
        check(c.post("/api/admin/rollback", json={"release_id": 999999}).status_code == 404, "rolling back to an unknown version → 404")
        acts = [e["action"] for e in c.get("/api/admin/audit?limit=50").json()]
        check("data.publish" in acts and "data.rollback" in acts, "publishing and rollbacks are in the audit log")

        # A lane recreated with a new id (street re-import) still gets its closure.
        c.post("/api/admin/rollback", json={"release_id": out.json()["release"]["id"]})
        from app.db import Edge as _E, SessionLocal as _SL

        _db = _SL()
        try:
            row = _db.get(_E, lane["id"])
            clone = {k: getattr(row, k) for k in ("from_code", "to_code", "distance_m", "source", "path_json",
                                                   "passage_kind", "verification")}
            _db.delete(row)
            _db.flush()
            _db.add(_E(**clone, walkable=True, blocked=True))
            _db.commit()
        finally:
            _db.close()
        check(not any({e["from_code"], e["to_code"]} == {lane["from_code"], lane["to_code"]} for e in pack()["edges"]),
              "a closure reaches phones even when the lane was recreated with a new id")
        _cfg_keep = __import__("app.services.pack_builder", fromlist=["KEEP_RELEASES"])
        _cfg_keep.KEEP_RELEASES = 3
        for i in range(4):
            c.post("/api/admin/publish", json={"note": f"prune {i}"})
        _cfg_keep.KEEP_RELEASES = 20
        vers = c.get("/api/admin/releases").json()["releases"]
        check(len(vers) == 3 and vers[0]["active"], "old versions are pruned (the newest ones and the live one are kept)")
        lane = next(e for e in c.get("/api/edges").json()
                    if {e["from_code"], e["to_code"]} == {lane["from_code"], lane["to_code"]})

        # Leave the data as it was.
        vc.post("/api/volunteer/edge-status", json={"from_code": lane["from_code"], "to_code": lane["to_code"], "blocked": False})
        c.post("/api/admin/verify", json={"target": "place", "code": victim["code"], "status": "volunteer_verified"})
    finally:
        _cfg.publish_mode = ""

# Facility status, access and QR board codes (Phase 5).
with TestClient(app, headers=ADMIN) as c:
    import re as _re

    def pack_node(code):
        c.post("/api/pack/build")
        return next((n for n in c.get("/api/pack/latest/json").json()["nodes"] if n["code"] == code), None)

    place = next(n for n in c.get("/api/pack/latest/json").json()["nodes"]
                 if n["code"].startswith("KUMBH-") and n.get("verification") != "rejected")
    pc = place["code"]
    body = {"code": pc, "status": "closed", "hours": 2, "note": "crowd control"}
    check(c.post("/api/admin/place-status", json=body, headers={"Authorization": ""}).status_code == 401
          and c.post("/api/admin/place-status", json=body, headers=VOL2).status_code == 403,
          "facility status needs an operator or admin (anonymous 401, volunteer 403)")
    r = c.post("/api/admin/place-status", json=body, headers=OPER)
    n = pack_node(pc)
    check(r.status_code == 200 and n["op_status"] == "closed" and n["op_status_note"] == "crowd control"
          and n["op_status_until"] and "op_status_by" not in n,
          "an operator marks a facility closed for 2 h; phones get the status, its expiry and note (not who set it)")
    c.post("/api/admin/place-status", json={"code": pc, "status": "unknown"})
    check(pack_node(pc)["op_status"] is None, "clearing the status removes the claim")
    check(c.post("/api/admin/place-status", json={**body, "hours": 0}).status_code == 422
          and c.post("/api/admin/place-status", json={**body, "status": "maybe"}).status_code == 422,
          "a status needs a known value and a validity of more than 0 hours")
    dated = [x["verified_at"] for x in c.get("/api/pack/latest/json").json()["nodes"] if x.get("verified_at")]
    check(n.get("source") in ("volunteer", "osm", "admin") and dated and all(_re.fullmatch(r"\d{4}-\d{2}-\d{2}", d) for d in dated),
          f"places carry their source and only the DAY they were checked ({len(dated)} dated, e.g. {dated[:1]})")

    check(c.post("/api/admin/place-access", json={"code": pc, "step_free": True}, headers=OPER).status_code == 403,
          "access details need an admin")
    c.post("/api/admin/place-access", json={"code": pc, "step_free": True, "access": "restricted", "access_note": "women only"})
    n = pack_node(pc)
    check(n["step_free"] is True and n["access"] == "restricted" and n["access_note"] == "women only",
          "step-free access and restrictions reach the pack")

    check(c.post("/api/admin/board", json={"code": pc}, headers=VOL2).status_code == 403, "board codes need an admin")
    b1 = c.post("/api/admin/board", json={"code": pc}).json()
    b2 = c.post("/api/admin/board", json={"code": pc}).json()
    check(b1["created"] and not b2["created"] and b1["board_code"] == b2["board_code"]
          and _re.fullmatch(r"[2-9A-HJKMNP-Z]{5}", b1["board_code"]),
          f"a place gets one stable 5-character board code without look-alike letters ({b1['board_code']})")
    check(pack_node(pc)["board_code"] == b1["board_code"], "the board code is in the pack (works offline)")
    junction = next(x["code"] for x in c.get("/api/nodes").json() if x["code"].startswith("OSM-J"))
    check(c.post("/api/admin/board", json={"code": junction}).status_code == 404, "hidden junctions cannot have boards")
    from app.db import QrNode as _Q, SessionLocal as _S
    from sqlalchemy.exc import IntegrityError as _IE

    other = next(x["code"] for x in c.get("/api/nodes").json()
                 if x["code"].startswith("KUMBH-") and x["code"] != pc and not x["code"].startswith("OSM-J"))
    _db = _S()
    try:
        _db.query(_Q).filter(_Q.code == other).update({_Q.board_code: b1["board_code"]})
        _db.commit()
        dup_ok = False
    except _IE:
        _db.rollback()
        dup_ok = True
    finally:
        _db.close()
    check(dup_ok, "the database refuses two places with the same board code")
    old_code = b1["board_code"]
    r = c.post("/api/admin/board/retire", json={"code": pc})
    b3 = c.post("/api/admin/board", json={"code": pc}).json()
    check(r.status_code == 200 and pack_node(pc)["board_code"] == b3["board_code"] and b3["board_code"] != old_code,
          "a board on the wrong place is retired; the place gets a new code; the old one is not reused")
    c.post("/api/admin/verify", json={"target": "place", "code": other, "status": "rejected", "note": "test"})
    check(c.post("/api/admin/board", json={"code": other}).status_code == 400, "a rejected place cannot get a board")
    c.post("/api/admin/verify", json={"target": "place", "code": other, "status": "unverified"})
    check(any(e["action"] == "board.create" for e in c.get("/api/admin/audit?limit=100").json())
          and any(e["action"] == "place.status" for e in c.get("/api/admin/audit?limit=100").json()),
          "board codes and status changes are in the audit log")

    # With manual publishing, a status change is live at once and is not "waiting to publish".
    _cfg.publish_mode = "manual"
    try:
        c.post("/api/admin/publish", json={"note": "status test baseline"})
        c.post("/api/admin/place-status", json={"code": pc, "status": "limited", "hours": 1}, headers=OPER)
        live = pack_node(pc)
        waiting = c.get("/api/admin/releases").json()["draft"]
        check(live["op_status"] == "limited" and waiting["places_changed"] == 0,
              "manual publishing: a status change reaches phones at once and is not 'waiting to publish'")
        c.post("/api/admin/place-status", json={"code": pc, "status": "unknown"})
        # Retiring a wrong board must not wait for publishing either.
        code_now = c.post("/api/admin/board", json={"code": pc}).json()["board_code"]
        c.post("/api/admin/publish", json={"note": "board baseline"})
        check(pack_node(pc)["board_code"] == code_now, "manual publishing: the published board code is on phones")
        c.post("/api/admin/board/retire", json={"code": pc})
        check(not any(x.get("board_code") == code_now for x in c.get("/api/pack/latest/json").json()["nodes"]),
              "manual publishing: a retired board stops working on phones at once (no publish needed)")
    finally:
        _cfg.publish_mode = ""

# SOS alerts (Phase 6): truthful states, never duplicated, operator-only details.
with TestClient(app) as anon:
    from uuid import uuid4 as _uuid

    cid = str(_uuid())
    body = {"client_id": cid, "kind": "medical", "note": "father fainted near the steps", "lat": 20.0072,
            "lon": 73.7925, "accuracy_m": 9, "place_code": None, "lang": "mr", "device": "sos-phone-0001"}
    r1 = anon.post("/api/sos", json=body)
    r2 = anon.post("/api/sos", json=body)
    check(r1.status_code == 201 and r1.json()["status"] == "received" and r1.json()["duplicate"] is False
          and r2.status_code == 200 and r2.json()["duplicate"] is True and r2.json()["id"] == r1.json()["id"],
          "an SOS is stored once (201); sending it again returns the same alert (200), never a duplicate")
    st = anon.get(f"/api/sos/{cid}").json()
    check(set(st) == {"id", "status", "received_at", "ack_at", "ack_message", "resolved_at"} and "note" not in st and "lat" not in st,
          "the sending phone can read only its alert's state (no note, no location)")
    check(anon.get(f"/api/sos/{_uuid()}").status_code == 404, "an unknown alert id → 404")
    check(anon.post("/api/sos", json={**body, "client_id": str(_uuid()), "kind": "party"}).status_code == 422
          and anon.post("/api/sos", json={**body, "client_id": "short"}).status_code == 422,
          "an SOS needs a known kind and a random id from the phone")
    check(anon.get("/api/ops/sos").status_code == 401 and anon.get("/api/ops/sos", headers=VOL2).status_code == 403,
          "only operators and admins see SOS alerts (anonymous 401, volunteer 403)")
    lst = anon.get("/api/ops/sos", headers=OPER).json()
    mine = next(a for a in lst if a["id"] == r1.json()["id"])
    check(mine["note"] == body["note"] and mine["lat"] == body["lat"] and mine["status"] == "received",
          "an operator sees the alert with its note and location")
    a = anon.post(f"/api/ops/sos/{mine['id']}/ack", json={"message": "A volunteer is coming to the steps"}, headers=OPER)
    st = anon.get(f"/api/sos/{cid}").json()
    check(a.status_code == 200 and st["status"] == "acknowledged" and st["ack_message"] == "A volunteer is coming to the steps"
          and st["ack_at"], "after an operator acknowledges, the phone sees 'acknowledged' with the operator's message")
    anon.post(f"/api/ops/sos/{mine['id']}/resolve", json={}, headers=OPER)
    check(anon.get(f"/api/sos/{cid}").json()["status"] == "resolved"
          and not any(x["id"] == mine["id"] for x in anon.get("/api/ops/sos", headers=OPER).json())
          and anon.post(f"/api/ops/sos/{mine['id']}/ack", json={}, headers=OPER).status_code == 409,
          "a resolved alert leaves the open list and cannot be acknowledged again")
    statuses = []
    for i in range(7):
        statuses.append(anon.post("/api/sos", json={**body, "client_id": str(_uuid()), "device": "sos-flood-0002"}).status_code)
    check(statuses.count(201) == 5 and statuses[-1] == 429, f"5 new alerts per phone per hour, then 429 ({statuses})")
    # Many phones behind one carrier address: never refused, only marked.
    crowd = [anon.post("/api/sos", json={**body, "client_id": str(_uuid()), "device": f"crowd-phone-{i:04d}"})
             for i in range(70)]
    flagged = [a for a in anon.get("/api/ops/sos", headers=OPER).json() if a["flood_suspect"]]
    check(all(r.status_code == 201 for r in crowd) and len(flagged) >= 10,
          f"70 SOS from different phones on one network address are all accepted; those past 60 an hour are marked ({len(flagged)} marked)")
    ops = anon.get("/api/ops/sos", headers=OPER).json()
    check(ops.index(next(a for a in ops if a["flood_suspect"])) > ops.index(next(a for a in ops if not a["flood_suspect"])),
          "marked (possible flood) alerts are listed after the others, not dropped")
    # Audit fixes: every open alert is listed (no cut at 200), and the time "Send" was pressed is kept.
    from datetime import datetime as _dt4, timedelta as _td4

    first_cid = str(_uuid())
    asked = (_dt4.utcnow() - _td4(hours=3)).isoformat() + "Z"
    first = anon.post("/api/sos", json={**body, "client_id": first_cid, "device": "sos-early-0004", "created_at": asked}).json()
    future = anon.post("/api/sos", json={**body, "client_id": str(_uuid()), "device": "sos-clock-0005",
                                         "created_at": (_dt4.utcnow() + _td4(days=1)).isoformat() + "Z"}).json()
    ancient = anon.post("/api/sos", json={**body, "client_id": str(_uuid()), "device": "sos-clock-0006",
                                          "created_at": "2020-01-01T00:00:00Z"}).json()
    for i in range(220):
        anon.post("/api/sos", json={**body, "client_id": str(_uuid()), "device": f"many-phone-{i:04d}"})
    ops = anon.get("/api/ops/sos", headers=OPER).json()
    mine_row = next((a for a in ops if a["id"] == first["id"]), None)
    check(len(ops) > 220 and mine_row is not None,
          f"all open alerts are listed: the oldest is not pushed out by 220 newer ones ({len(ops)} listed)")
    future_row = next((a for a in ops if a["id"] == future["id"]), None)
    ancient_row = next((a for a in ops if a["id"] == ancient["id"]), None)
    check(mine_row is not None and (mine_row["asked_at"] or "").startswith(asked[:13])
          and future_row is not None and future_row["asked_at"] is None
          and ancient_row is not None and ancient_row["asked_at"] is None,
          "an alert sent late from the phone shows when 'Send' was pressed; a clearly wrong clock (future, years back) is ignored")
    for a in ops:  # back to a short list for the checks below
        if a["id"] != first["id"]:
            anon.post(f"/api/ops/sos/{a['id']}/resolve", json={}, headers=OPER)
    old_cid = str(_uuid())
    old_id = anon.post("/api/sos", json={**body, "client_id": old_cid, "device": "sos-old-0003"}).json()["id"]
    from app.db import SessionLocal as _S3, SosAlert as _SA3
    from datetime import datetime as _dt3, timedelta as _td3

    _db = _S3()
    _db.query(_SA3).filter(_SA3.id == old_id).update({_SA3.created_at: _dt3.utcnow() - _td3(hours=49)})
    _db.commit()
    _db.close()
    anon.get("/api/ops/sos", headers=OPER)
    check(anon.get(f"/api/sos/{old_cid}").json()["status"] == "expired"
          and not any(a["id"] == old_id for a in anon.get("/api/ops/sos", headers=OPER).json()),
          "an alert nobody resolved for 48 h is closed as 'expired' (then deleted after the retention time)")
    log = anon.get("/api/admin/audit?limit=50", headers=ADMIN).json()
    sos_log = [e for e in log if e["action"].startswith("sos.")]
    check(sos_log and not any("fainted" in e["summary"] or "20.00" in e["summary"] for e in sos_log),
          "SOS audit entries hold no note or location")
    from app.db import SessionLocal as _S2, SosAlert as _SA
    from datetime import datetime as _dt, timedelta as _td

    _db = _S2()
    _db.query(_SA).filter(_SA.id == mine["id"]).update({_SA.resolved_at: _dt.utcnow() - _td(days=8)})
    _db.commit()
    _db.close()
    anon.get("/api/ops/sos", headers=OPER)
    check(anon.get(f"/api/sos/{cid}").status_code == 404, "a resolved alert is deleted after 7 days (location gone)")

# Lost-person cases (Phase 6): operators only, minimal data, history, retention.
with TestClient(app) as anon:
    case = {"person_name": "Sunita", "approx_age": 9, "description": "Girl, red frock, white sandals",
            "languages": "Marathi", "last_seen_note": "near Ramkund steps", "reporter_name": "Mother",
            "reporter_contact": "98765 43210"}
    check(anon.post("/api/ops/cases", json=case).status_code == 401
          and anon.post("/api/ops/cases", json=case, headers=VOL2).status_code == 403
          and anon.get("/api/ops/cases", headers=VOL2).status_code == 403,
          "cases need an operator or admin (anonymous 401, volunteer 403)")
    r = anon.post("/api/ops/cases", json=case, headers=OPER)
    cs = r.json()
    ref = cs["case_ref"]
    check(r.status_code == 201 and _re.fullmatch(r"LP-[2-9A-HJKMNP-Z]{5}", ref) and cs["status"] == "NEW"
          and cs["is_child"] is True and cs["history"][0]["action"] == "created",
          f"an operator opens a case: a case number ({ref}), NEW, marked as a child (age 9), history started")
    listed = next(x for x in anon.get("/api/ops/cases", headers=OPER).json() if x["case_ref"] == ref)
    check(listed["reporter_contact"].startswith("••••") and listed["reporter_contact"].endswith("10")
          and anon.get(f"/api/ops/cases/{ref}", headers=OPER).json()["reporter_contact"] == "98765 43210",
          "a child's contact number is masked in lists, shown only when the case is opened")
    v = cs["version"]
    check(anon.post(f"/api/ops/cases/{ref}/status", json={"to": "REUNITED", "version": v}, headers=OPER).status_code == 400,
          "marking a case REUNITED needs a note")
    ok1 = anon.post(f"/api/ops/cases/{ref}/status", json={"to": "UNDER_REVIEW", "version": v}, headers=OPER)
    stale = anon.post(f"/api/ops/cases/{ref}/status", json={"to": "ESCALATED", "note": "x", "version": v}, headers=OPER)
    check(ok1.status_code == 200 and stale.status_code == 409,
          "two operators changing the same case: the second, stale change is refused (409), not overwritten")
    v = ok1.json()["version"]
    upd = anon.put(f"/api/ops/cases/{ref}", json={**case, "description": "Girl, red frock, white sandals, braided hair",
                                                     "version": v}, headers=OPER)
    check(upd.status_code == 200 and "braided" in upd.json()["description"]
          and anon.put(f"/api/ops/cases/{ref}", json={**case, "version": v}, headers=OPER).status_code == 409,
          "editing details needs the current version")
    v = upd.json()["version"]
    check(anon.post(f"/api/ops/cases/{ref}/status", json={"to": "NEW", "version": v}, headers=OPER).status_code == 400,
          "a case cannot go back to NEW")
    r = anon.post(f"/api/ops/cases/{ref}/status", json={"to": "REUNITED", "note": "met mother at help desk 3", "version": v}, headers=OPER)
    v = r.json()["version"]
    r = anon.post(f"/api/ops/cases/{ref}/status", json={"to": "CLOSED", "note": "family left", "version": v}, headers=OPER)
    d = r.json()
    check(r.status_code == 200 and d["status"] == "CLOSED" and d["closed_at"] and d["allowed"] == []
          and [h["to"] for h in d["history"] if h["action"] == "status"] == ["UNDER_REVIEW", "REUNITED", "CLOSED"],
          "the case is reunited then closed; every step is in its history")
    check(anon.post(f"/api/ops/cases/{ref}/status", json={"to": "UNDER_REVIEW", "version": d["version"]}, headers=OPER).status_code == 400
          and anon.post(f"/api/ops/cases/{ref}/status", json={"to": "UNDER_REVIEW", "version": d["version"]}, headers=ADMIN).status_code == 200,
          "a closed case is final for operators; only an admin can reopen it")
    d = anon.get(f"/api/ops/cases/{ref}", headers=OPER).json()
    anon.post(f"/api/ops/cases/{ref}/status", json={"to": "CLOSED", "note": "closed again", "version": d["version"]}, headers=OPER)
    log = [e for e in anon.get("/api/admin/audit?limit=100", headers=ADMIN).json() if e["target"] == f"case:{ref}"]
    check(log and not any(w in e["summary"] for e in log for w in ("Sunita", "98765", "frock", "Mother")),
          "case audit entries hold the case number and statuses only — no names, contacts or descriptions")
    check(anon.get("/api/ops/cases?q=frock", headers=OPER).json() == []
          and any(x["case_ref"] == ref for x in anon.get("/api/ops/cases?status=CLOSED&q=frock", headers=OPER).json()),
          "operators can search cases (open by default; closed on request)")
    from app.db import LostCase as _LC, LostCaseEvent as _LE

    _db = _S2()
    _db.query(_LC).filter(_LC.case_ref == ref).update({_LC.closed_at: _dt.utcnow() - _td(days=31)})
    _db.commit()
    cid_ = _db.query(_LC.id).filter(_LC.case_ref == ref).scalar()
    _db.close()
    anon.get("/api/ops/cases", headers=OPER)
    _db = _S2()
    left = _db.query(_LE).filter(_LE.case_id == cid_).count()
    _db.close()
    check(anon.get(f"/api/ops/cases/{ref}", headers=OPER).status_code == 404 and left == 0,
          "a closed case and its history are deleted after 30 days")
    _cfg.cases_enabled = ""
    _cfg.setu_env = "production"
    try:
        off = anon.get("/api/ops/cases", headers=OPER).status_code
    finally:
        _cfg.setu_env = "development"
    check(off == 404, "lost-person cases are off on a production server until an authority approves (CASES_ENABLED=1)")

# Operations summary (Phase 7): counts only, operators and admins.
with TestClient(app) as anon:
    check(anon.get("/api/ops/summary").status_code == 401 and anon.get("/api/ops/summary", headers=VOL2).status_code == 403,
          "the operations summary needs an operator or admin")
    sm = anon.get("/api/ops/summary", headers=OPER).json()
    flat = json.dumps(sm)
    check({"sos", "cases", "facilities", "boards", "closed_lanes", "pending_visitor_reports"} <= set(sm)
          and isinstance(sm["sos"]["unacknowledged"], int) and isinstance(sm["boards"], int)
          and "fainted" not in flat and "Sunita" not in flat and "lat" not in flat,
          f"the operations summary has counts only, no personal data ({sm['sos']}, boards {sm['boards']})")

# Sign-in guessing across many phone numbers from one network address is limited.
with TestClient(app) as anon:
    from app.db import LoginFailure as _LF, SessionLocal as _S4

    _db = _S4()
    _db.query(_LF).delete()  # earlier wrong-PIN checks came from the same test address
    _db.commit()
    _db.close()
    codes = [anon.post("/api/auth/login", json={"phone": f"91000{i:05d}", "pin": "000000"}).status_code for i in range(32)]
    check(codes[:29].count(401) == 29 and codes[-1] == 429,
          f"after 30 wrong sign-ins from one network address in 15 min → 429 ({codes[-3:]})")

    _db = _S4()
    _db.query(_LF).delete()
    _db.commit()
    _db.close()
    check(anon.post("/api/auth/login", json={"phone": "9000000004", "pin": "618274"}).status_code == 200,
          "once the window has passed, sign-in works again")

print("\nALL OK" if ok else "\nSOME FAILED")
sys.exit(0 if ok else 1)
