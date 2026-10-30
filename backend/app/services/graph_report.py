"""
Checks on the routing graph (docs/ROUTING_GRAPH_VALIDATION.md): river and weir
crossings, disconnected parts, places with no lane, duplicates, over-long place
links and trust counts. Used by scripts/validate_graph.py and the admin map.
"""
from collections import Counter

from ..db import Edge, QrNode
from ..schemas import EdgeOut, QrNodeOut
from .osm_network import ATTACH_MAX_M, is_network_junction_code
from .pack_builder import _collect
from .river_guard import crossing_problem, load_water_index, river_crossings


def components(codes: set[str], edges: list[dict]) -> list[set[str]]:
    adj: dict[str, set[str]] = {c: set() for c in codes}
    for e in edges:
        if e["from_code"] in adj and e["to_code"] in adj:
            adj[e["from_code"]].add(e["to_code"])
            adj[e["to_code"]].add(e["from_code"])
    seen, out = set(), []
    for c in codes:
        if c in seen:
            continue
        comp, stack = set(), [c]
        seen.add(c)
        while stack:
            x = stack.pop()
            comp.add(x)
            for y in adj[x] - seen:
                seen.add(y)
                stack.append(y)
        out.append(comp)
    return sorted(out, key=len, reverse=True)


def validate(db) -> dict:
    water = load_water_index()
    nodes = [QrNodeOut.model_validate(n).model_dump(mode="json") for n in db.query(QrNode).all()]
    all_edges = [EdgeOut.model_validate(e).model_dump(mode="json") for e in db.query(Edge).all()]
    by_code = {n["code"]: n for n in nodes}
    places = {n["code"] for n in nodes if not is_network_junction_code(n["code"])}

    crossing = {"error": [], "warning": []}
    bridges = []
    for e in all_edges:
        if water is None:
            break
        names = river_crossings(e, by_code, water)
        if not names:
            continue
        info = {
            "lane": e["id"], "from": e["from_code"], "to": e["to_code"], "source": e["source"],
            "name": e.get("name"), "crosses": names,
        }
        problem = crossing_problem(e, by_code, water)
        if problem:
            crossing[problem].append(info)
        else:
            bridges.append(info)

    pack_nodes, pack_edges = _collect(db)
    pack_unsafe = [
        e["id"] for e in pack_edges if water is not None and crossing_problem(e, by_code, water) == "error"
    ]
    comps = components({n["code"] for n in pack_nodes}, pack_edges)
    main = comps[0] if comps else set()
    stranded = sorted(p for p in places if p not in main and any(p in c and len(c) > 1 for c in comps[1:]))
    no_lane = sorted(p for p in places if not any(p in (e["from_code"], e["to_code"]) for e in pack_edges))
    pairs = Counter(frozenset((e["from_code"], e["to_code"])) for e in all_edges)
    duplicates = [sorted(p) for p, k in pairs.items() if k > 1]
    # Possible duplicates: the same kind of place within 15 m, or the same real
    # name (not a generic "Parking" / "Toilet") within 150 m.
    from .osm_import import TYPE_LABEL
    from .pack_builder import haversine_m

    generic = {v.lower() for v in TYPE_LABEL.values()} | {"railway station"}

    visible = [n for n in nodes if n["code"] in places and n.get("verification") != "rejected"]
    norm = lambda s: " ".join((s or "").lower().replace("shri ", "").replace("sri ", "").split())  # noqa: E731
    dupes = []
    for i, a in enumerate(visible):
        for b in visible[i + 1:]:
            d = haversine_m(a["lat"], a["lon"], b["lat"], b["lon"])
            same_name = norm(a["name"]) == norm(b["name"]) and norm(a["name"]) not in generic
            if (a["node_type"] == b["node_type"] and d <= 15) or (same_name and d <= 150):
                dupes.append({"a": a["code"], "b": b["code"], "names": [a["name"], b["name"]], "m": round(d)})
    long_links = [
        {"lane": e["id"], "place": e["from_code"], "m": e["distance_m"]}
        for e in all_edges
        if e.get("passage_kind") == "connector" and e["distance_m"] > ATTACH_MAX_M + 1
    ]
    return {
        "water_data": water is not None and not water.empty,
        "places": len(places),
        "junctions": len(nodes) - len(places),
        "lanes": dict(Counter(f'{e["source"]}:{e.get("passage_kind")}' for e in all_edges)),
        "pack_lanes": len(pack_edges),
        "bridges": bridges,
        "river_crossing_errors": crossing["error"],
        "river_crossing_warnings": crossing["warning"],
        "pack_unsafe_lanes": pack_unsafe,
        "components": [len(c) for c in comps[:10]],
        "places_in_small_parts": stranded,
        "places_without_lane": no_lane,
        "duplicate_lanes": duplicates,
        "possible_duplicate_places": dupes,
        "place_trust": dict(Counter(n.get("verification", "unverified") for n in nodes if n["code"] in places)),
        "lane_trust": dict(Counter(e.get("verification", "unverified") for e in all_edges)),
        "long_links": long_links,
    }
