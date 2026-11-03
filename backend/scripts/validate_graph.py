"""
Check the routing graph in the database (see docs/ROUTING_GRAPH_VALIDATION.md).

  .venv/bin/python scripts/validate_graph.py            # human-readable report
  .venv/bin/python scripts/validate_graph.py --json F   # also write the details to F

Reports: lanes by source, bridges, lanes crossing a river/weir (errors are left
out of the pack, warnings are recorded volunteer walks worth a look),
disconnected parts, places with no lane, duplicate lanes and over-long place
links. Exit code 1 when a lane in the *pack* still crosses water unsafely, or
when there is no water data to check against.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.db import SessionLocal, init_db  # noqa: E402
from app.services.graph_report import validate  # noqa: E402
from app.services.osm_network import ATTACH_MAX_M  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", help="write the full report to this file")
    args = ap.parse_args()
    init_db()
    db = SessionLocal()
    try:
        r = validate(db)
    finally:
        db.close()
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(r, f, indent=2, ensure_ascii=False)
    print(f"Places {r['places']}, junctions {r['junctions']}, lanes {sum(r['lanes'].values())} "
          f"({', '.join(f'{k} {v}' for k, v in sorted(r['lanes'].items()))}); in the pack {r['pack_lanes']}")
    if not r["water_data"]:
        print("WARNING: no water data (run scripts/import_osm.py water) — river checks NOT done")
    print(f"River/weir crossings: {len(r['bridges'])} on bridges, "
          f"{len(r['river_crossing_errors'])} unsafe (left out of the pack), "
          f"{len(r['river_crossing_warnings'])} recorded walks to review")
    for x in r["river_crossing_errors"][:20]:
        print(f"  unsafe: lane {x['lane']} {x['from']}↔{x['to']} ({x['source']}) crosses {', '.join(x['crosses'])}")
    for x in r["river_crossing_warnings"][:20]:
        print(f"  review: lane {x['lane']} {x['from']}↔{x['to']} crosses {', '.join(x['crosses'])}")
    print(f"Connected parts (largest first): {r['components']}")
    print(f"Places with no lane: {len(r['places_without_lane'])}; in a small separate part: {len(r['places_in_small_parts'])}")
    print(f"Duplicate lanes: {len(r['duplicate_lanes'])}; place links over {ATTACH_MAX_M:.0f} m: {len(r['long_links'])}")
    print(f"Trust — places: {r['place_trust']}; lanes: {r['lane_trust']}")
    print(f"Possible duplicate places (same kind ≤15 m or same name ≤150 m): {len(r['possible_duplicate_places'])}")
    for d in r["possible_duplicate_places"][:15]:
        print(f"  {d['a']} / {d['b']}: {d['names'][0]} / {d['names'][1]} ({d['m']} m)")
    if not r["water_data"] and sum(r["lanes"].values()) > 0:
        print("FAIL: river checks could not run (no water data) — run scripts/import_osm.py water")
        return 1
    if r["pack_unsafe_lanes"]:
        print(f"FAIL: {len(r['pack_unsafe_lanes'])} lanes in the pack cross water unsafely")
        return 1
    print("OK: no lane in the pack crosses water except on an approved bridge")
    return 0


if __name__ == "__main__":
    sys.exit(main())
