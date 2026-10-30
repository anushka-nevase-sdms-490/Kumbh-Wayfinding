"""
Import OpenStreetMap data into the Setu database.

  .venv/bin/python scripts/import_osm.py all                # places, water, network (first setup)
  .venv/bin/python scripts/import_osm.py water              # rivers / weirs / water areas (river safety)
  .venv/bin/python scripts/import_osm.py places  [--dry-run] [--prune] [--from-file F]
  .venv/bin/python scripts/import_osm.py network [--dry-run] [--force] [--from-file F]
  add --saved to use the newest saved answer in data/osm/ instead of Overpass

`places` adds ghats, temples, hospitals… ; `network` adds the pilot zone's roads
and footpaths as unverified lanes and joins every place to them (run it again
after new places are registered or imported).

Fetches from Overpass (one query per kind) and saves the raw answer in
data/osm/<kind>-<date>.json. When Overpass is unreachable (it is often at
capacity) the newest saved answer is used instead, so a setup works offline
once the data has been fetched. Then it upserts places / lanes and rebuilds the
pack if anything changed. Volunteer-confirmed places are never changed.
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.error
import urllib.request
import time
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.db import QrNode, SessionLocal, init_db  # noqa: E402
from app.services.osm_import import (  # noqa: E402
    import_places,
    load_official_points,
    overpass_places_query,
    parse_places,
)
from app.services.osm_network import (  # noqa: E402
    MissingWaterData,
    PackTooBig,
    import_network,
    is_network_junction_code,
    overpass_network_query,
    overpass_water_query,
)
from app.services.water import parse_water  # noqa: E402
from app.config import publishing_manual, settings  # noqa: E402
from app.services.pack_builder import ensure_current_pack  # noqa: E402

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "SetuKumbhWayfinding/0.1 (Kumbh Innovation Challenge prototype)"
RAW_DIR = os.environ.get("OSM_DIR") or os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "data", "osm"))


def fetch_overpass(query: str) -> dict:
    """One query; the public server is often at capacity, so back off and retry."""
    data = urllib.parse.urlencode({"data": query}).encode()
    wait = 30
    for attempt in range(4):
        req = urllib.request.Request(OVERPASS_URL, data=data, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=240) as res:
                return json.load(res)
        except urllib.error.HTTPError as exc:
            if exc.code not in (429, 502, 503, 504) or attempt == 3:
                raise
            delay = int(exc.headers.get("Retry-After") or wait)
            print(f"Overpass busy ({exc.code}); retrying in {delay} s")
            time.sleep(delay)
            wait *= 2
    raise RuntimeError("unreachable")


def newest_saved(kind: str, raw_dir: str = RAW_DIR) -> str | None:
    """The most recent saved Overpass answer for `kind` (places / network)."""
    if not os.path.isdir(raw_dir):
        return None
    names = sorted(n for n in os.listdir(raw_dir) if n.startswith(f"{kind}-") and n.endswith(".json"))
    return os.path.join(raw_dir, names[-1]) if names else None


def load_raw(kind: str, from_file: str | None, saved_only: bool, raw_dir: str) -> dict:
    """Overpass answer: a given file, the newest saved one, or a fresh fetch (saved)."""
    if from_file:
        return json.load(open(from_file, encoding="utf-8"))
    if saved_only and newest_saved(kind, raw_dir):
        path = newest_saved(kind, raw_dir)
        print(f"Using saved {kind} data: {path}")
        return json.load(open(path, encoding="utf-8"))
    # Nothing saved yet (or a fresh fetch asked for): fetch, else the newest saved.
    query = {
        "places": overpass_places_query,
        "network": overpass_network_query,
        "water": overpass_water_query,
    }[kind]()
    try:
        raw = fetch_overpass(query)
    except (OSError, urllib.error.URLError, RuntimeError, ValueError) as exc:
        print(f"Overpass not reachable ({exc}); using the newest saved data.")
    else:
        os.makedirs(raw_dir, exist_ok=True)
        path = os.path.join(raw_dir, f"{kind}-{datetime.utcnow():%Y%m%d}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(raw, f)
        print(f"Saved Overpass answer → {path}")
        return raw
    path = newest_saved(kind, raw_dir)
    if path is None:
        raise SystemExit(
            f"No saved {kind} data in {raw_dir} and Overpass is not reachable — try again later."
        )
    print(f"Using saved {kind} data: {path}")
    return json.load(open(path, encoding="utf-8"))


def run(kind: str, raw: dict, *, dry_run: bool, prune: bool, force: bool, water_raw: dict | None = None) -> int:
    init_db()
    db = SessionLocal()
    try:
        if kind == "places":
            places = parse_places(raw.get("elements", []), official=load_official_points())
            print(f"{len(places)} places from {len(raw.get('elements', []))} OSM features")
            report = import_places(db, places, prune=prune)
        else:
            water = parse_water(water_raw.get("elements", [])) if water_raw else None
            if water is not None:
                print(f"Water: {len(water.lines)} river/canal/weir lines, {len(water.areas)} water areas")
            try:
                report = import_network(
                    db, raw.get("elements", []), water=water, force=force,
                    allow_without_water=water_raw is None,
                )
            except (PackTooBig, MissingWaterData) as exc:
                db.rollback()
                print(exc)
                return 1
            for b in report.blocked_crossings:
                print(f"  left out: way {b['way']} {b['highway']} {b['name'] or ''} — {b['reason']}")
            for r in report.connectors_rejected:
                state = "joined to another street" if r["joined"] else "NOT joined (no safe street within 60 m)"
                print(f"  place {r['place']}: nearest link {r['reason']} → {state}")
        print(report.summary())
        if dry_run:
            db.rollback()
            print("Dry run — nothing written.")
            return 0
        db.commit()
        row = ensure_current_pack(db)
        # Hidden road junctions are nodes too: count them apart from real places
        # (both from the pack itself, which is what phones get).
        with open(row.file_path, encoding="utf-8") as f:
            pack_codes = [n["code"] for n in json.load(f)["nodes"]]
        junctions = sum(1 for code in pack_codes if is_network_junction_code(code))
        print(
            f"Pack {row.version}: {len(pack_codes) - junctions} places, "
            f"{junctions} junctions, {row.edge_count} lanes"
        )
        if publishing_manual(settings):
            print("Publishing is manual: phones keep the published version until an admin publishes "
                  "(admin map → Data versions, or scripts/publish_data.py).")
    finally:
        db.close()
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("kind", choices=["all", "places", "water", "network"])
    ap.add_argument("--dry-run", action="store_true", help="show what would change, write nothing")
    ap.add_argument("--prune", action="store_true", help="delete unconfirmed, unused OSM places gone from OSM")
    ap.add_argument("--force", action="store_true", help="network: allow a pack over 2 MB")
    ap.add_argument("--from-file", help="replay a saved Overpass answer instead of fetching")
    ap.add_argument("--saved", action="store_true", help="use the newest saved answer; fetch only kinds never saved")
    ap.add_argument("--no-water-check", action="store_true",
                    help="network: build without river safety checks (NOT for real use)")
    ap.add_argument("--raw-dir", default=RAW_DIR, help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    if args.kind == "all" and args.from_file:
        ap.error("--from-file needs places or network")

    # Places first (the network joins every place to the roads), water before
    # the network (river safety checks).
    kinds = ["places", "water", "network"] if args.kind == "all" else [args.kind]
    water_raw = None
    for kind in kinds:
        print(f"== {kind} ==")
        if kind == "water":
            water_raw = load_raw("water", args.from_file, args.saved, args.raw_dir)
            print(f"{len(water_raw.get('elements', []))} water features")
            continue
        raw = load_raw(kind, args.from_file, args.saved, args.raw_dir)
        if kind == "network" and water_raw is None and not args.no_water_check:
            water_raw = load_raw("water", None, args.saved, args.raw_dir)
        code = run(kind, raw, dry_run=args.dry_run, prune=args.prune, force=args.force,
                   water_raw=None if args.no_water_check else water_raw)
        if code:
            return code
    return 0


if __name__ == "__main__":
    sys.exit(main())
