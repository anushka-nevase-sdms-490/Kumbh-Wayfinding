/**
 * Obstacle-aware offline routing scenario tests.
 * Run: npx --yes tsx src/lib/runRoutingTests.ts
 */
import {
  buildPathInstructions,
  edgeKey,
  findRoute,
  isEdgeNavigable,
  validateRoute,
  type RouteOptions,
} from "../src/lib/router";
import type { GraphEdge, OfflinePack, QrNode } from "../src/lib/types";
import {
  evaluateArrival,
  nextNavState,
} from "../src/lib/navigation";

function node(code: string, lat: number, lon: number, name = code): QrNode {
  return {
    id: 0,
    code,
    name,
    lat,
    lon,
    node_type: "landmark",
  };
}

function edge(
  from: string,
  to: string,
  distance_m: number,
  extra: Partial<GraphEdge> = {}
): GraphEdge {
  return {
    id: 0,
    from_code: from,
    to_code: to,
    distance_m,
    surface: "paved",
    bidirectional: true,
    walkable: true,
    blocked: false,
    door_state: "none",
    passage_kind: "corridor",
    cost_mult: 1,
    ...extra,
  };
}

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("OK:", msg);
  }
}

// Layout (approx meters via tiny lat deltas ~1m ≈ 1e-5 deg):
// START --e1-- MID --e2-- DEST
//   |                |
//  e3               e4 (around wall)
//   +------ CORNER --+

const START = node("START", 19.0, 73.0, "Start");
const MID = node("MID", 19.0001, 73.0, "Mid");
const DEST = node("DEST", 19.0002, 73.0, "Dest");
const CORNER = node("CORNER", 19.0001, 73.0001, "Corner");

function pack(edges: GraphEdge[], nodes: QrNode[] = [START, MID, DEST, CORNER]): OfflinePack {
  return { version: "test", signature: "t", nodes, edges };
}

// Test 1 — empty corridor
{
  const p = pack([edge("START", "DEST", 20)]);
  const r = findRoute(p, "START", "DEST");
  assert(r.valid && r.codes.join("-") === "START-DEST", "T1 empty corridor route");
  const instr = buildPathInstructions(p, r.codes);
  assert(
    instr.some((i) => /straight/i.test(i.text)),
    "T1 go-straight instruction"
  );
}

// Test 2 — wall straight ahead → alternate via corner
{
  const p = pack([
    edge("START", "DEST", 20, {
      walkable: false,
      passage_kind: "wall",
      obstacle_note: "wall",
    }),
    edge("START", "CORNER", 15),
    edge("CORNER", "DEST", 15),
  ]);
  const r = findRoute(p, "START", "DEST");
  assert(
    r.valid && r.codes.includes("CORNER") && !r.codes.includes("MID"),
    "T2 routes around wall via corner"
  );
  assert(validateRoute(p, r.codes).ok, "T2 validated alternate");
}

// Test 3 — desk blocking mid corridor
{
  const p = pack([
    edge("START", "MID", 10, { blocked: true, obstacle_note: "desk" }),
    edge("MID", "DEST", 10),
    edge("START", "CORNER", 12),
    edge("CORNER", "DEST", 12),
  ]);
  const r = findRoute(p, "START", "DEST");
  assert(
    r.valid && r.codes.join("-") === "START-CORNER-DEST",
    "T3 routes around desk"
  );
}

// Test 4 — closed door
{
  const p = pack([
    edge("START", "DEST", 8, {
      passage_kind: "door",
      door_state: "closed",
    }),
    edge("START", "CORNER", 10),
    edge("CORNER", "DEST", 10),
  ]);
  const r = findRoute(p, "START", "DEST");
  assert(r.valid && !edgeKey("START", "DEST").includes("x"), "T4 setup");
  assert(
    r.codes.join("-") === "START-CORNER-DEST",
    "T4 does not use closed door"
  );
}

// Test 5 — open door
{
  const p = pack([
    edge("START", "DEST", 8, {
      passage_kind: "door",
      door_state: "open",
      clearance_m: 1.2,
    }),
  ]);
  const r = findRoute(p, "START", "DEST");
  assert(r.valid && r.codes.join("-") === "START-DEST", "T5 open door allowed");
}

// Test 6 — glass wall
{
  const glass = edge("START", "DEST", 5, {
    passage_kind: "glass_wall",
    walkable: false,
  });
  assert(!isEdgeNavigable(glass), "T6 glass wall not navigable");
  const p = pack([
    glass,
    edge("START", "CORNER", 9),
    edge("CORNER", "DEST", 9),
  ]);
  const r = findRoute(p, "START", "DEST");
  assert(r.codes.includes("CORNER"), "T6 routes around glass wall");
}

// Test 7 — multiple obstacles + clearance preference
{
  const p = pack([
    edge("START", "MID", 10, { clearance_m: 0.4, cost_mult: 1 }),
    edge("MID", "DEST", 10, { clearance_m: 0.4 }),
    edge("START", "CORNER", 14, { clearance_m: 1.5 }),
    edge("CORNER", "DEST", 14, { clearance_m: 1.5 }),
  ]);
  const r = findRoute(p, "START", "DEST", { preferClearanceM: 1.0 });
  assert(
    r.valid && r.codes.includes("CORNER"),
    "T7 prefers wider clearance path"
  );
}

// Test 8 — user reports obstacle → session block → reroute
{
  const p = pack([
    edge("START", "MID", 10),
    edge("MID", "DEST", 10),
    edge("START", "CORNER", 12),
    edge("CORNER", "DEST", 12),
  ]);
  const blocked: RouteOptions = {
    blockedKeys: new Set([edgeKey("START", "MID")]),
  };
  const r = findRoute(p, "START", "DEST", blocked);
  assert(r.codes.join("-") === "START-CORNER-DEST", "T8 reroute after block");
  assert(
    nextNavState("NAVIGATING", "OBSTACLE") === "REROUTING",
    "T8 state → REROUTING"
  );
  assert(nextNavState("REROUTING", "REROUTE_OK") === "NAVIGATING", "T8 resume");
}

// Test 9 — destination reached
{
  const a = evaluateArrival({
    startCode: "DEST",
    destCode: "DEST",
    onFinalLeg: true,
    destReachable: true,
    distanceToDestM: 0,
  });
  assert(a.arrived && a.reason === "scanned", "T9 scanned arrival");
  const b = evaluateArrival({
    startCode: "MID",
    destCode: "DEST",
    onFinalLeg: true,
    destReachable: true,
    distanceToDestM: 1.5,
    gpsAccuracyM: 8,
  });
  assert(b.arrived && b.reason === "proximity", "T9 proximity ≤2m");
}

// Test 10 — destination blocked / through wall → no false arrival
{
  const a = evaluateArrival({
    startCode: "START",
    destCode: "DEST",
    onFinalLeg: false,
    destReachable: false,
    distanceToDestM: 1.0,
    gpsAccuracyM: 5,
  });
  assert(!a.arrived, "T10 no arrival when not final leg / unreachable");
  const p = pack([
    edge("START", "DEST", 5, { blocked: true }),
  ]);
  const r = findRoute(p, "START", "DEST");
  assert(!r.valid, "T10 no route when only link blocked");
  assert(
    nextNavState("ROUTING", "ROUTE_FAIL") === "NO_ROUTE",
    "T10 NO_ROUTE state"
  );
}

// Bonus — validate rejects closed segment still listed in codes
{
  const p = pack([
    edge("START", "DEST", 5, { door_state: "closed", passage_kind: "door" }),
  ]);
  const v = validateRoute(p, ["START", "DEST"]);
  assert(!v.ok, "validate rejects closed door segment");
}

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll navigation scenario tests passed.");
