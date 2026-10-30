/**
 * Obstacle-aware offline routing scenario tests.
 * Run: npx --yes tsx src/lib/runRoutingTests.ts
 */
import {
  buildPathInstructions,
  edgeKey,
  findRoute,
  isEdgeNavigable,
  edgeTraversalCost,
  validateRoute,
  type RouteOptions,
} from "../src/lib/router";
import type { GraphEdge, OfflinePack, QrNode } from "../src/lib/types";
import {
  evaluateArrival,
  nextNavState,
} from "../src/lib/navigation";
import { placesByDistance, suggestStart } from "../src/lib/nearest";
import { mapRoadParts, routeLine } from "../src/lib/mapData";
import { ON_ROUTE_M, reachedPlace, routeProgress, offRouteLimitM } from "../src/lib/progress";
import { INITIAL_GPS_FILTER, filterFix } from "../src/lib/gpsFilter";
import { OFFICIAL_PLACES, officialWarnRadiusM } from "../src/lib/officialPlaces";
import { KUMBH_BOUNDS } from "../src/lib/mapArea";
import { haversineM, isFieldVerified, isRegisteredLocation, isUsablePack } from "../src/lib/types";
import { en } from "../src/i18n/en";
import { hi } from "../src/i18n/hi";
import { mr } from "../src/i18n/mr";
import { formatDist, guessLang, translate } from "../src/i18n/messages";
import { instructionLines, turnText } from "../src/i18n/instructions";
import {
  JUMP_M,
  WALK_SPEED_MPS,
  backOnRoute,
  goOffRoute,
  initialSimState,
  pathLength,
  pointAlong,
  startWalk,
  stepSim,
  followNewPath,
  type LonLat,
} from "../src/lib/location/simulationWalk";
import { fetchNewerPack } from "../src/lib/packSync";
import { checkStored, isQuotaError, packChecksum } from "../src/lib/packStore";
import { dismissOutboxItem, flushOutbox, sendOrQueue, type OutboxItem, type OutboxStore, type Sender } from "../src/lib/outbox";
import { BUNDLED_SIGNATURE, FALLBACK_PACK } from "../src/lib/fallbackPack";
import { officialPlaceFor } from "../src/lib/officialPlaces";

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
  assert(a.arrived && a.reason === "same_board", "T9 start is destination");
  const b = evaluateArrival({
    startCode: "MID",
    destCode: "DEST",
    onFinalLeg: true,
    destReachable: true,
    distanceToDestM: 1.5,
    gpsAccuracyM: 8,
  });
  assert(b.arrived && b.reason === "proximity", "T9 proximity within GPS radius");
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

// Test 11 — lane to a place missing from the pack must not crash A*
{
  const p = pack([
    edge("START", "GHOST", 5),
    edge("START", "MID", 11),
    edge("MID", "DEST", 11),
  ]);
  let r: ReturnType<typeof findRoute> | null = null;
  try {
    r = findRoute(p, "START", "DEST");
  } catch {
    r = null;
  }
  assert(!!r && r.valid && r.codes.join(",") === "START,MID,DEST", "T11 dangling edge ignored");
}

// Test 12 — total distance is metres, not weighted cost
{
  const p = pack([edge("START", "DEST", 100, { cost_mult: 2, verified: true })]);
  const r = findRoute(p, "START", "DEST");
  assert(r.valid && r.totalDistanceM === 100, "T12 totalDistanceM is real metres");
}

// Test 13 — duplicate lanes: instructions describe the lane A* used
{
  const p = pack([
    edge("START", "DEST", 500),
    edge("DEST", "START", 22),
  ]);
  const ins = buildPathInstructions(p, ["START", "DEST"]);
  assert(ins[0]?.text.includes("22"), "T13 duplicate lane → shorter one described");
}

// Test 14 — a run of small bends still adds up to a turn
{
  const A = node("A", 19.0, 73.0);
  const B = node("B", 19.0, 73.0);
  const C = node("C", 19.0, 73.0);
  const D = node("D", 19.0, 73.0);
  const E = node("E", 19.0, 73.0);
  const p = pack(
    [
      edge("A", "B", 10, { heading_ab: 0, heading_ba: 180 }),
      edge("B", "C", 10, { heading_ab: 25, heading_ba: 205 }),
      edge("C", "D", 10, { heading_ab: 50, heading_ba: 230 }),
      edge("D", "E", 10, { heading_ab: 75, heading_ba: 255 }),
    ],
    [A, B, C, D, E]
  );
  const ins = buildPathInstructions(p, ["A", "B", "C", "D", "E"]);
  assert(ins.some((i) => i.kind === "right"), "T14 gradual bends produce a turn");
}

// Test 15 — NO_ROUTE recovers when a route comes back
{
  assert(
    nextNavState("NO_ROUTE", "ROUTE_OK") === "NAVIGATING",
    "T15 NO_ROUTE → NAVIGATING on ROUTE_OK"
  );
}

// Test 16 — nearest place from GPS (start screen)
{
  // ~1.11 m per 1e-5 deg latitude
  const P1 = node("P1", 19.0, 73.0, "Ghat");
  const P2 = node("P2", 19.0002, 73.0, "Camp"); // ~22 m north of P1
  const P3 = node("P3", 19.003, 73.0, "Gate"); // ~333 m north of P1
  const nodes = [P3, P2, P1];
  const here = { lat: 19.00001, lon: 73.0 }; // ~1 m from P1

  const sorted = placesByDistance(nodes, here);
  assert(sorted.map((p) => p.node.code).join(",") === "P1,P2,P3", "T16 sorted nearest first");

  const good = suggestStart(nodes, { ...here, accuracyM: 8 });
  assert(
    good.kind === "near" && good.candidates.length === 1 && good.candidates[0].node.code === "P1" && !good.approximate,
    "T16 good fix → single confident suggestion"
  );

  const close = suggestStart(nodes, { ...here, accuracyM: 25 });
  assert(
    close.kind === "near" && close.candidates.map((c) => c.node.code).join(",") === "P1,P2",
    "T16 close call → both candidates shown"
  );

  const approx = suggestStart([P1, P3], { ...here, accuracyM: 60 });
  assert(approx.kind === "near" && approx.approximate, "T16 30–100 m fix → approximate");

  const weak = suggestStart(nodes, { ...here, accuracyM: 150 });
  assert(weak.kind === "none" && weak.reason === "weak_fix", "T16 >100 m fix → no suggestion");

  const far = suggestStart([P3], { ...here, accuracyM: 8 });
  assert(far.kind === "far" && far.nearest.node.code === "P3", "T16 nearest >100 m → 'far', not suggested");

  assert(suggestStart(nodes, null).kind === "none", "T16 no fix → no suggestion");
}

// Test 17 — map route line follows the recorded walk, in travel direction
{
  const walk = JSON.stringify([
    { lat: 19.0, lon: 73.0 },
    { lat: 19.00005, lon: 73.00003 }, // bend
    { lat: 19.0001, lon: 73.0 },
  ]);
  const p = pack([edge("START", "MID", 12, { path_json: walk }), edge("MID", "DEST", 11)]);
  const fwd = routeLine(p, ["START", "MID", "DEST"]);
  assert(
    fwd.length === 4 && fwd[1][0] === 73.00003 && fwd[3][1] === 19.0002,
    "T17 forward line uses the walk then a straight leg"
  );
  const back = routeLine(p, ["DEST", "MID", "START"]);
  assert(
    back.length === 4 && back[2][0] === 73.00003 && back[3][1] === 19.0,
    "T17 reverse direction reverses the walk"
  );
  const bad = pack([edge("START", "MID", 12, { path_json: "not json" })]);
  assert(routeLine(bad, ["START", "MID"]).length === 2, "T17 bad path_json → straight line");
}

// Test 18 — where the visitor is along the route (START → MID → DEST, due north, ~11 m legs)
{
  const p = pack([edge("START", "MID", 11), edge("MID", "DEST", 11)]);
  const codes = ["START", "MID", "DEST"];
  const a = routeProgress(p, codes, { lat: 19.00005, lon: 73.0 }); // halfway up leg 0
  assert(
    !!a && Math.abs(a.toNextM - 5.5) < 1 && Math.abs(a.remainingM - 16.5) < 1 && a.offRouteM < 1,
    "T18 halfway along the current lane"
  );
  const quarter = routeProgress(p, codes, { lat: 19.000025, lon: 73.0 });
  assert(!!quarter && !reachedPlace(quarter, 25), "T18 a quarter along a short lane is not 'reached'");
  // Ramkund → Lane corner is only ~21 m: standing at the start must not count as reached.
  const short = pack([edge("START", "MID", 21)], [START, node("MID", 19.00019, 73.0)]);
  const atStart = routeProgress(short, ["START", "MID"], { lat: 19.0, lon: 73.0 });
  assert(!!atStart && !reachedPlace(atStart, 25), "T18 at the start of a 21 m lane is not 'reached'");
  const atMid = routeProgress(p, codes, { lat: 19.0001, lon: 73.0 });
  assert(!!atMid && reachedPlace(atMid, 5), "T18 at the next place → reached");
  const past = routeProgress(p, codes, { lat: 19.00015, lon: 73.0 }); // just past MID, on lane 2
  assert(!!past && past.offRouteM < 1, "T18 just past a place is not off route");
  const d = routeProgress(p, codes, { lat: 19.0001, lon: 73.0006 }); // ~63 m east
  assert(!!d && d.offRouteM > offRouteLimitM(10), "T18 far from the line → off route");
  assert(offRouteLimitM(40) === 60, "T18 off-route limit widens with poor accuracy");
}

// Test 18b — river: C is 30 m across from A, the walk goes A → bridge B (500 m) → C.
// GPS noise near A must not skip to B and fake an arrival at C.
{
  const dLat = 1 / 111320;
  const dLon = 1 / (111320 * Math.cos((20 * Math.PI) / 180));
  const A = node("A", 20, 73.79);
  const B = node("B", 20 + 500 * dLat, 73.79 + 15 * dLon);
  const C = node("C", 20, 73.79 + 30 * dLon);
  const p = pack([edge("A", "B", 500), edge("B", "C", 500)], [A, B, C]);
  for (const east of [5, 14, 16, 20]) {
    const pr = routeProgress(p, ["A", "B", "C"], { lat: 20, lon: 73.79 + east * dLon });
    assert(
      !!pr && !reachedPlace(pr, 8) && pr.remainingM > 900,
      `T18b ${east} m east of A: still before the bridge, ~1 km to go`
    );
  }
}

// Test 18c — GPS missed the moment the visitor passed a place: still advances.
{
  const dLat = 1 / 111320;
  const A = node("A", 20, 73.79);
  const B = node("B", 20 + 100 * dLat, 73.79);
  const C = node("C", 20 + 300 * dLat, 73.79);
  const D = node("D", 20 + 500 * dLat, 73.79);
  const p = pack([edge("A", "B", 100), edge("B", "C", 200), edge("C", "D", 200)], [A, B, C, D]);
  for (const past of [40, 120]) {
    const pr = routeProgress(p, ["A", "B", "C", "D"], { lat: 20 + (100 + past) * dLat, lon: 73.79 });
    assert(!!pr && reachedPlace(pr, 8), `T18c ${past} m past B (fix missed at B) → B counts as reached`);
  }
  const before = routeProgress(p, ["A", "B", "C", "D"], { lat: 20 + 60 * dLat, lon: 73.79 });
  assert(!!before && !reachedPlace(before, 8), "T18c 40 m before B → not reached");
}

// Test 19 — GPS filter: coarse seed, jump rejection, recovery
{
  const weak = filterFix(INITIAL_GPS_FILTER, { lat: 19.0, lon: 73.0, accuracyM: 500 });
  assert(weak.kind === "weak_seed" && weak.state.smooth === null, "T19 coarse first fix does not seed");
  const seed = filterFix(weak.state, { lat: 19.0, lon: 73.0, accuracyM: 8 });
  assert(seed.kind === "seed" && !!seed.state.smooth, "T19 good fix seeds");
  let st = seed.state;
  const far = { lat: 19.001, lon: 73.0, accuracyM: 25 }; // ~111 m away, poor accuracy
  const r1 = filterFix(st, far);
  st = r1.state;
  const r2 = filterFix(st, far);
  st = r2.state;
  const r3 = filterFix(st, far);
  assert(
    r1.kind === "jump_rejected" && r2.kind === "jump_rejected" && r3.kind === "reseed" && r3.state.smooth?.lat === 19.001,
    "T19 repeated jump is accepted on the 3rd fix (no lock-out)"
  );
  // Three rough jumps in different directions must not re-anchor on junk.
  let js = seed.state;
  let last = filterFix(js, { lat: 19.0027, lon: 73.0, accuracyM: 200 });
  js = last.state;
  last = filterFix(js, { lat: 18.9964, lon: 73.0, accuracyM: 200 });
  js = last.state;
  last = filterFix(js, { lat: 19.0045, lon: 73.0, accuracyM: 200 });
  assert(last.kind === "unseeded" && last.state.smooth === null, "T19 junk jumps reset instead of re-anchoring");
  const good = filterFix(last.state, { lat: 19.0, lon: 73.0, accuracyM: 8 });
  assert(good.kind === "seed" && good.pos?.lat === 19.0, "T19 next good fix seeds exactly");
  const snap = filterFix(seed.state, { lat: 19.001, lon: 73.0, accuracyM: 8 }); // accurate, 111 m away
  assert(snap.kind === "reseed" && snap.pos?.lat === 19.001, "T19 accurate far fix taken raw, not blended");
  const walk = filterFix(seed.state, { lat: 19.0001, lon: 73.0, accuracyM: 6 });
  assert(walk.kind === "smoothed" && (walk.pos!.lat - 19.0) / 0.0001 >= 0.6 - 1e-9, "T19 accurate fix moves most of the way");
}

// Test 20 — arrival radius sized for GPS
{
  const at15 = evaluateArrival({
    startCode: "MID", destCode: "DEST", onFinalLeg: true, destReachable: true,
    distanceToDestM: 15, gpsAccuracyM: 10,
  });
  const at40 = evaluateArrival({
    startCode: "MID", destCode: "DEST", onFinalLeg: true, destReachable: true,
    distanceToDestM: 40, gpsAccuracyM: 10,
  });
  const noisy = evaluateArrival({
    startCode: "MID", destCode: "DEST", onFinalLeg: true, destReachable: true,
    distanceToDestM: 5, gpsAccuracyM: 60,
  });
  assert(at15.arrived && !at40.arrived && !noisy.arrived, "T20 arrive within ~20 m, not at 40 m or with ±60 m GPS");
}

// Test 21 — official places: inside the map area, every position has a source
{
  const [w, so, e, n] = KUMBH_BOUNDS;
  assert(
    OFFICIAL_PLACES.every((p) => p.lon >= w && p.lon <= e && p.lat >= so && p.lat <= n),
    "T21 every official place lies inside the offline map area"
  );
  assert(
    OFFICIAL_PLACES.every((p) => p.coordSource.length > 0),
    "T21 every official position records its source"
  );
  const ramkund = OFFICIAL_PLACES.find((p) => p.id === "ramkund")!;
  assert(
    ramkund.coordQuality === "osm" && officialWarnRadiusM(ramkund) === 200 &&
      officialWarnRadiusM(OFFICIAL_PLACES.find((p) => p.id === "civil-hospital")!) === 50 &&
      officialWarnRadiusM(OFFICIAL_PLACES.find((p) => p.id === "adgaon-parking")!) === 2000,
    "T21 warn radius: 50 m OSM points, wider for grounds, loose for unconfirmed"
  );
}

// ── T22: offline pack on the phone — what may replace it ──
{
  const good = { version: "v1", signature: "abc", nodes: [node("P1", 20, 73.8)], edges: [] };
  assert(isUsablePack(good), "T22 pack with a placed node is usable");
  assert(!isUsablePack({ ...good, nodes: [] }), "T22 empty pack is not usable");
  assert(!isUsablePack({ ...good, nodes: [{ ...good.nodes[0], lat: NaN }] }), "T22 node without a position is not usable");
  assert(!isUsablePack({ ...good, nodes: [{ ...good.nodes[0], code: "" }] }), "T22 node without a code is not usable");
  assert(!isUsablePack({ nodes: good.nodes, edges: [] }), "T22 pack without a signature is not usable");
  assert(!isUsablePack(null), "T22 nothing is not usable");
}

// ── T23: built-in fallback pack — only OSM-matched official places, no lanes ──
{
  const fb = FALLBACK_PACK;
  assert(isUsablePack(fb) && fb.signature === BUNDLED_SIGNATURE, "T23 fallback pack is usable and marked bundled");
  assert(
    fb.nodes.length === OFFICIAL_PLACES.filter((p) => p.coordQuality === "osm").length,
    "T23 fallback has every OSM-matched official place"
  );
  assert(
    fb.nodes.every((n) => {
      const p = officialPlaceFor(n);
      return !!p && p.coordQuality === "osm" && p.lat === n.lat && p.lon === n.lon;
    }),
    "T23 each fallback place is an OSM official place at its exact position (no approximate ones)"
  );
  assert(fb.edges.length === 0, "T23 fallback has no lanes");
  assert(
    fb.nodes.every(
      (n) => n.lon >= KUMBH_BOUNDS[0] && n.lat >= KUMBH_BOUNDS[1] && n.lon <= KUMBH_BOUNDS[2] && n.lat <= KUMBH_BOUNDS[3]
    ),
    "T23 fallback places are inside the offline map"
  );
  assert(
    new Set(fb.nodes.map((n) => n.code)).size === fb.nodes.length && fb.nodes.every((n) => n.id < 0),
    "T23 fallback codes are unique and ids never clash with database ids"
  );
  assert(
    fb.nodes.every((a) => fb.nodes.every((b) => a === b || !findRoute(fb, a.code, b.code).valid)),
    "T23 no route between fallback places (no straight-line lanes)"
  );
}

// ── T24: map roads (OSM lanes) — hidden junctions, preference, directions, speed ──
{
  assert(
    !isRegisteredLocation({ code: "OSM-J123" }) && !isRegisteredLocation({ code: "OSM-A7" }) &&
      isRegisteredLocation({ code: "OSM-N42" }) && isRegisteredLocation({ code: "KUMBH-A01" }) &&
      isRegisteredLocation({ code: "OSM-AMBAD" }),
    "T24 map junctions are hidden; map places and volunteer places are listed"
  );

  const osm = (from: string, to: string, d: number, extra: Partial<GraphEdge> = {}) =>
    edge(from, to, d, { source: "osm", verified: false, cost_mult: 1.3, ...extra });
  // A and B are 105 m apart; the map road through J1 is 106 m. The walked lane
  // goes round something, so it is longer than the straight line.
  const nodesAB = [node("A", 20, 73.8), node("B", 20, 73.801), node("OSM-J1", 20.00005, 73.8005, "")];
  const walked = { verified: true };
  const road = [osm("A", "OSM-J1", 53), osm("OSM-J1", "B", 53)];
  let r = findRoute(pack([edge("A", "B", 140, walked), ...road], nodesAB), "A", "B");
  assert(r.codes.join(">") === "A>B", "T24 walked lane wins over a map road up to ~1.5× shorter");
  r = findRoute(pack([edge("A", "B", 170, walked), ...road], nodesAB), "A", "B");
  assert(r.codes.join(">") === "A>OSM-J1>B", "T24 a much shorter map road is used");

  // A named street that curves (each leg leaves the way the last arrived): no turns.
  const curvy = pack(
    [
      osm("A", "OSM-J1", 50, { name: "MG Road", heading_ab: 0, heading_ba: 200 }),
      osm("OSM-J1", "OSM-J2", 50, { name: "MG Road", heading_ab: 20, heading_ba: 240 }),
      osm("OSM-J2", "B", 50, { name: "MG Road", heading_ab: 60, heading_ba: 260 }),
    ],
    [node("A", 20, 73.8), node("OSM-J1", 20.0004, 73.8001, ""), node("OSM-J2", 20.0008, 73.8003, ""), node("B", 20.001, 73.8007, "Ghat")]
  );
  let ins = buildPathInstructions(curvy, ["A", "OSM-J1", "OSM-J2", "B"]);
  assert(
    ins.length === 2 && ins[0].kind === "straight" && ins[0].detail === "along MG Road toward Ghat",
    "T24 curving street → one 'go straight along MG Road toward Ghat'"
  );
  // A real turn at a junction onto a named street; "toward" skips the unnamed junction.
  const turn = pack(
    [
      osm("A", "OSM-J1", 50, { name: "MG Road", heading_ab: 0, heading_ba: 180 }),
      osm("OSM-J1", "B", 50, { name: "Ganga Ghat Road", heading_ab: 90, heading_ba: 270 }),
    ],
    [node("A", 20, 73.8), node("OSM-J1", 20.00045, 73.8, ""), node("B", 20.00045, 73.80048, "Ghat")]
  );
  ins = buildPathInstructions(turn, ["A", "OSM-J1", "B"]);
  assert(
    ins[0].detail === "along MG Road toward Ghat" && ins[1].text === "Turn right onto Ganga Ghat Road",
    "T24 turn at a junction names the street; 'toward' names the next real place"
  );

  const mixed = pack(
    [edge("A", "B", 100, { verified: true }), osm("B", "OSM-J1", 30), osm("OSM-J1", "C", 30)],
    [node("A", 20, 73.8), node("B", 20, 73.801), node("OSM-J1", 20.0002, 73.8013, ""), node("C", 20.0004, 73.8016)]
  );
  const parts = mapRoadParts(mixed, ["A", "B", "OSM-J1", "C"]);
  assert(
    parts.length === 1 && parts[0].length === 3 && parts[0][0][0] === 73.801,
    "T24 only the map-road part of the route is dashed (one joined line)"
  );

  // Speed: a 55×55 grid of map junctions (~3000 places, ~6000 lanes).
  const N = 55;
  const gridNodes: QrNode[] = [];
  const gridEdges: GraphEdge[] = [];
  const id = (i: number, j: number) => `OSM-J${i * N + j}`;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      gridNodes.push(node(id(i, j), 20 + i * 0.0005, 73.78 + j * 0.0005, ""));
      if (j + 1 < N) gridEdges.push(osm(id(i, j), id(i, j + 1), 52));
      if (i + 1 < N) gridEdges.push(osm(id(i, j), id(i + 1, j), 55));
    }
  }
  const grid = pack(gridEdges, gridNodes);
  let t0 = performance.now();
  r = findRoute(grid, id(0, 0), id(N - 1, N - 1));
  const coldMs = performance.now() - t0;
  t0 = performance.now();
  for (let k = 0; k < 10; k++) findRoute(grid, id(k, 0), id(N - 1, N - 1 - k));
  const warmMs = (performance.now() - t0) / 10;
  assert(r.valid && r.codes.length === 2 * N - 1, "T24 grid route found");
  assert(warmMs < 30 && coldMs < 300, `T24 A* on ~3000 junctions: ${warmMs.toFixed(1)} ms per route (first ${coldMs.toFixed(0)} ms)`);
}

// ── T25: Hindi and Marathi text ──
{
  const holes = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  const keys = Object.keys(en) as (keyof typeof en)[];
  const badHi = keys.filter((k) => holes(hi[k]) !== holes(en[k]));
  const badMr = keys.filter((k) => holes(mr[k]) !== holes(en[k]));
  assert(badHi.length === 0 && badMr.length === 0, `T25 placeholders match English (hi: ${badHi}, mr: ${badMr})`);
  assert(
    Object.keys(hi).length === keys.length && Object.keys(mr).length === keys.length,
    "T25 hi and mr have exactly the English keys"
  );
  const hindiInMarathi = keys.filter((k) => /अभी|हैं|क्या|कैसे|यहाँ|वहाँ|नहीं/.test(mr[k]));
  assert(hindiInMarathi.length === 0, `T25 no Hindi words in Marathi (${hindiInMarathi})`);
  assert(keys.every((k) => !/[०-९]/.test(hi[k] + mr[k])), "T25 Latin digits only");

  assert(formatDist("mr", 120) === "120 मी" && formatDist("hi", 1460) === "1.5 किमी" && formatDist("en", 80) === "80 m",
    "T25 distances in each language");
  assert(translate("mr", "pack.from", { time: "29 Oct", count: 5 }).includes("5") &&
    translate("en", "guide.toGo", { dist: "1 km" }) === "1 km to go", "T25 placeholders are filled");
  assert(guessLang(["mr-IN", "en"]) === "mr" && guessLang(["hi"]) === "hi" && guessLang(["ta-IN"]) === "en",
    "T25 phone language → app language");

  const turnIns = { text: "", detail: "", distanceM: 133, kind: "right" as const, turn: "right" as const, street: "MG Road", toCode: "G" };
  assert(turnText("mr", turnIns) === "उजवीकडे MG Road वर वळा" && turnText("en", { ...turnIns, street: null }) === "Turn right",
    "T25 turn wording");
  const line = instructionLines("hi", { text: "", detail: "", distanceM: 58, kind: "straight", first: true, toCode: "G" }, () => "रामकुंड");
  assert(line.text === "58 मी सीधे जाएँ" && line.detail === "रामकुंड की ओर", "T25 instruction wording with the place's local name");
}

// ── T30: volunteer screens in Hindi and Marathi ──
{
  const volKeys = (Object.keys(en) as (keyof typeof en)[]).filter((k) => k.startsWith("vol."));
  // Same as English only where the word is the same in every language.
  const same = new Set(["vol.login.pin"]);
  const untranslated = volKeys.filter((k) => !same.has(k) && (hi[k] === en[k] || mr[k] === en[k]));
  assert(volKeys.length > 200 && untranslated.length === 0,
    `T30 all ${volKeys.length} volunteer texts are translated (left in English: ${untranslated})`);
  const latinOnly = volKeys.filter((k) => !same.has(k) && !/[\u0900-\u097F]/.test(hi[k] + mr[k]));
  assert(latinOnly.length === 0, `T30 every volunteer text has Devanagari in hi and mr (${latinOnly})`);
  assert(translate("mr", "vol.outbox.waitingMany", { n: 3 }) === "3 बदल पाठवायचे बाकी आहेत" &&
    translate("hi", "vol.label.walk", { from: "रामकुंड", to: "कालाराम" }) === "रास्ता रामकुंड → कालाराम",
    "T30 queued-change labels are shown in the volunteer's language");
}

// ── T26: Nashik simulation mode — the simulated walker and the real navigation logic ──
{
  // Repeatable "random" numbers for noise and jumps.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const dist = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
    haversineM(a.lat, a.lon, b.lat, b.lon);

  // A ── J1 ── J2 ── B, ~110 m legs going east then north (like a street with a turn).
  const A = node("A", 20.0, 73.79, "Ramkund Ghat");
  const J1 = node("OSM-J1", 20.0, 73.79105, "");
  const J2 = node("OSM-J2", 20.0, 73.7921, "");
  const B = node("B", 20.001, 73.7921, "Kalaram Mandir");
  const lane = (a: QrNode, b: QrNode) =>
    edge(a.code, b.code, haversineM(a.lat, a.lon, b.lat, b.lon), {
      source: "osm",
      path_json: JSON.stringify([{ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }]),
    });
  const simPack = pack([lane(A, J1), lane(J1, J2), lane(J2, B)], [A, J1, J2, B]);
  const route = findRoute(simPack, "A", "B");
  const line = routeLine(simPack, route.codes) as LonLat[];
  const total = pathLength(line);
  assert(route.valid && Math.abs(total - route.totalDistanceM) < 2, "T26 simulated walk follows the router's route line");

  // Pure walking maths.
  let st = startWalk(initialSimState({ lat: 0, lon: 0 }), line);
  assert(dist(st.pos, { lat: A.lat, lon: A.lon }) < 0.5, "T26 Start puts the walker at the route's start");
  st = stepSim({ ...st, noise: false }, 10, rand).state;
  assert(Math.abs(st.along - WALK_SPEED_MPS * 10) < 0.01, "T26 walks at walking speed (1.3 m/s)");
  st = stepSim({ ...st, speedX: 5, noise: false }, 10, rand).state;
  assert(Math.abs(st.along - WALK_SPEED_MPS * 60) < 0.01, "T26 speed control multiplies the pace");
  const lost = stepSim({ ...st, lost: true }, 1, rand);
  assert(lost.fix === null && lost.state.along > st.along, "T26 lost signal: no reports, the walker keeps moving");
  const jumped = stepSim({ ...st, jumpPending: true, noise: false, playing: false }, 1, rand);
  assert(Math.abs(dist(jumped.fix!, st.pos) - JUMP_M) < 1 && !jumped.state.jumpPending, "T26 GPS jump: one report ~120 m away");
  const noisy = Array.from({ length: 50 }, () => stepSim({ ...st, playing: false, noise: true, accuracyM: 10 }, 1, rand).fix!);
  assert(noisy.every((f) => dist(f, st.pos) <= 6.01), "T26 noise stays inside the accuracy circle");

  // Off route and back.
  let off = goOffRoute({ ...st, noise: false });
  for (let i = 0; i < 40; i++) off = stepSim(off, 1, rand).state;
  const prog = routeProgress(simPack, route.codes, off.pos)!;
  assert(prog.offRouteM > offRouteLimitM(8), `T26 'walk off route' leaves the route (${Math.round(prog.offRouteM)} m away)`);
  let back = backOnRoute(off);
  for (let i = 0; i < 60; i++) back = stepSim(back, 1, rand).state;
  assert(routeProgress(simPack, route.codes, back.pos)!.offRouteM < 5, "T26 'back to route' walks back onto the line");
  // A new route (e.g. after a reroute) is followed from where the walker is.
  const moved = followNewPath({ ...st }, line.slice(1) as LonLat[]);
  assert(dist(pointAlong(moved.path, 0), st.pos) < 1 || moved.along > 0, "T26 a changed route is picked up from the walker's position");

  // End to end, headless: simulated fixes → GPS filter → progress → next place → arrival.
  seed = 11;
  let sim = startWalk({ ...initialSimState({ lat: A.lat, lon: A.lon }), accuracyM: 8, noise: true }, line);
  let filter = INITIAL_GPS_FILTER;
  let codes = [...route.codes];
  const visited: string[] = [];
  let arrivedAt = -1;
  for (let t = 1; t <= 600 && arrivedAt < 0; t++) {
    const r = stepSim(sim, 1, rand);
    sim = r.state;
    if (!r.fix) continue;
    const f = filterFix(filter, { ...r.fix, accuracyM: r.fix.accuracyM });
    filter = f.state;
    if (!f.pos || f.kind === "weak_seed" || f.kind === "unseeded") continue;
    const p = routeProgress(simPack, codes, f.pos);
    if (!p) continue;
    if (codes.length >= 3 && reachedPlace(p, r.fix.accuracyM)) {
      visited.push(codes[1]);
      codes = codes.slice(1);
      continue;
    }
    // App.tsx: arrive on the final lane, within 20 m along it, while on the lane.
    if (codes.length === 2 && p.offRouteM <= Math.max(ON_ROUTE_M, r.fix.accuracyM) && p.remainingM <= 20) {
      arrivedAt = t;
    }
  }
  assert(visited.join(",") === "OSM-J1,OSM-J2", `T26 walking with GPS noise passes each junction in order (${visited})`);
  const expected = (total - 20) / WALK_SPEED_MPS;
  assert(arrivedAt > 0 && Math.abs(arrivedAt - expected) < 25, `T26 arrival detected near the destination (${arrivedAt} s, ~${Math.round(expected)} s expected)`);
}

// ── T27: trust levels — field-verified lanes preferred, everything else dashed ──
{
  const base = edge("A", "B", 100);
  const cost = (extra: Partial<GraphEdge>) => edgeTraversalCost({ ...base, ...extra });
  assert(
    cost({ verification: "volunteer_verified" }) === 85 && cost({ verification: "officially_verified" }) === 85 &&
      cost({ verification: "remotely_reviewed" }) === 95 && cost({ verification: "osm_imported" }) === 100 &&
      cost({ verification: "unverified" }) === 100,
    "T27 routing cost: on-site verified 0.85 < reviewed on maps 0.95 < imported / unverified"
  );
  assert(
    isFieldVerified({ verified: true }) && !isFieldVerified({ verified: true, source: "osm" }) &&
      !isFieldVerified({ verified: true, verification: "rejected" }) && !isFieldVerified({}),
    "T27 older packs: a walked volunteer lane counts as verified; trust level wins when present"
  );
  const n3 = [node("A", 20, 73.8), node("B", 20, 73.801), node("C", 20, 73.802)];
  const tp = pack(
    [edge("A", "B", 105, { verification: "volunteer_verified" }), edge("B", "C", 105, { verification: "remotely_reviewed" })],
    n3
  );
  assert(mapRoadParts(tp, ["A", "B", "C"]).length === 1, "T27 a reviewed-on-maps lane is still drawn dashed (not checked on site)");
  const straight = pack([edge("A", "B", 105, { verification: "unverified" })], n3);
  assert(mapRoadParts(straight, ["A", "B"]).length === 1, "T27 an unwalked volunteer link is drawn dashed");
  const walked = pack([edge("A", "B", 105, { verification: "volunteer_verified" })], n3);
  assert(mapRoadParts(walked, ["A", "B"]).length === 0, "T27 a walked lane is drawn solid");
}

// ── T28: offline storage — damaged copies detected, full storage recognised ──
{
  const p1 = { version: "v1", signature: "abc", nodes: [node("P1", 20, 73.8)], edges: [] };
  const sum = packChecksum(p1);
  assert(sum === packChecksum(JSON.parse(JSON.stringify(p1))) && /^[0-9a-f]{8}$/.test(sum),
    "T28 checksum is stable for the same pack");
  const damaged = JSON.parse(JSON.stringify(p1));
  damaged.nodes[0].lat = 20.0001;
  assert(packChecksum(damaged) !== sum, "T28 checksum changes when a coordinate changes");
  assert(checkStored({ pack: p1, savedAt: "2026-10-30T00:00:00Z", checksum: sum }) !== null,
    "T28 an undamaged saved copy is accepted");
  assert(checkStored({ pack: damaged, savedAt: "2026-10-30T00:00:00Z", checksum: sum }) === null,
    "T28 a damaged saved copy (checksum mismatch) is rejected");
  assert(checkStored({ pack: p1, savedAt: "2026-10-30T00:00:00Z" }) !== null,
    "T28 a copy saved before checksums still loads");
  assert(checkStored({ pack: { ...p1, nodes: [] }, savedAt: "x", checksum: "0" }) === null && checkStored(null) === null,
    "T28 an empty or missing copy is rejected");
  assert(
    isQuotaError({ name: "QuotaExceededError" }) && isQuotaError({ code: 22 }) &&
      isQuotaError({ name: "NS_ERROR_DOM_QUOTA_REACHED" }) && isQuotaError(new Error("Quota exceeded")) &&
      !isQuotaError(new Error("Network error")) && !isQuotaError(null),
    "T28 'storage full' is recognised in each browser's form"
  );
}

async function packSyncTests() {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  const serve = (routes: Record<string, unknown>) => {
    globalThis.fetch = (async (url: string) => {
      calls.push(url);
      if (!(url in routes)) throw new Error("offline");
      return { ok: true, json: async () => routes[url] } as Response;
    }) as typeof fetch;
  };
  const mine = { version: "v1", signature: "aaa", nodes: [node("P1", 20, 73.8)], edges: [] };
  const meta = (signature: string) => ({ version: "v2", signature, download_url: "/api/pack/download/v2" });
  const v2 = { ...mine, version: "v2", signature: "bbb", nodes: [node("P1", 20, 73.8), node("P2", 20, 73.81)] };

  calls.length = 0;
  serve({ "/api/pack/latest": meta("aaa"), "/api/pack/download/v2": v2 });
  let r = await fetchNewerPack("", mine);
  assert(r.kind === "same" && !calls.includes("/api/pack/download/v2"), "T22 same signature → no download");

  serve({ "/api/pack/latest": meta("bbb"), "/api/pack/download/v2": v2 });
  r = await fetchNewerPack("", mine);
  assert(r.kind === "newer" && r.pack.nodes.length === 2, "T22 new signature → newer pack downloaded");

  serve({ "/api/pack/latest": meta("ccc"), "/api/pack/download/v2": v2 });
  r = await fetchNewerPack("", mine);
  assert(r.kind === "rejected", "T22 download not matching the announced signature is rejected");

  serve({ "/api/pack/latest": meta("ddd"), "/api/pack/download/v2": { ...v2, signature: "ddd", nodes: [] } });
  r = await fetchNewerPack("", mine);
  assert(r.kind === "rejected", "T22 empty server pack never replaces the phone's pack");

  serve({});
  r = await fetchNewerPack("", mine);
  assert(r.kind === "unreachable", "T22 no network → keep the phone's pack");

  // Missing-route root cause: another program on the backend port answers 404.
  globalThis.fetch = (async () => ({ ok: false, status: 404, json: async () => ({ detail: "Not Found" }) }) as Response) as typeof fetch;
  r = await fetchNewerPack("", mine);
  assert(r.kind === "wrong_server" && r.status === 404, "T22 a 404 from another program is reported, not taken as offline");
  globalThis.fetch = (async () => ({ ok: false, status: 502, json: async () => ({}) }) as Response) as typeof fetch;
  r = await fetchNewerPack("", mine);
  assert(r.kind === "unreachable", "T22 a 5xx (server down behind the proxy) counts as no connection");
  serve({ "/api/pack/latest": { detail: "Not Found" } });
  r = await fetchNewerPack("", mine);
  assert(r.kind === "wrong_server", "T22 an answer that is not Setu pack info is reported");
  serve({ "/api/pack/latest": { ...meta("eee"), node_count: 0 } });
  r = await fetchNewerPack("", mine);
  assert(r.kind === "empty", "T22 a server with no places is reported as empty (data not set up)");
  globalThis.fetch = realFetch;
}
await packSyncTests();

// ── T29: volunteer offline queue — kept, sent once in order, refusals shown ──
async function outboxTests() {
  const mem = new Map<string, OutboxItem>();
  const store: OutboxStore = {
    list: async () => [...mem.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    put: async (i) => void mem.set(i.id, structuredClone(i)),
    remove: async (id) => void mem.delete(id),
  };
  const json = (status: number, data: unknown) => ({ ok: status < 300, status, json: async () => data }) as Response;
  const offline: Sender = async () => {
    throw new TypeError("Failed to fetch");
  };
  const sentKeys: string[] = [];
  const server: Sender = async (path, body, key) => {
    sentKeys.push(key);
    const b = body as Record<string, unknown>;
    if (path.endsWith("/register")) return json(200, { success: true, node: { code: "KUMBH-A7", name: b.location_name } });
    if (path.endsWith("/record-path")) return b.to_code === "KUMBH-A7" ? json(200, { success: true }) : json(400, { detail: "Unknown place" });
    if (path.endsWith("/edge-status")) return json(400, { detail: "Lane not found" });
    return json(200, {});
  };
  const VOL = 5;
  const r1 = await sendOrQueue("/api/volunteer/register", { location_name: "Ghat X" }, { label: "Register Ghat X" }, offline, store, VOL);
  assert(r1.kind === "queued" && mem.size === 1, "T29 a change made without internet is kept on the phone");
  const r2 = await sendOrQueue("/api/volunteer/record-path", { from_code: "A", to_code: null, waypoints: [] },
    { label: "Walk A → Ghat X", queueOnly: true, dependsOn: { id: r1.kind === "queued" ? r1.item.id : "", fields: ["to_code"] } },
    offline, store, VOL);
  await sendOrQueue("/api/volunteer/edge-status", { from_code: "A", to_code: "B" }, { label: "Block A–B" }, offline, store, VOL);
  assert(r2.kind === "queued" && mem.size === 3, "T29 a walk for a queued place waits for that place");

  let f = await flushOutbox(offline, store, VOL);
  assert(f.sent === 0 && f.waiting === 3, "T29 still offline: nothing lost, all 3 still waiting");
  f = await flushOutbox(server, store, 99);
  assert(f.sent === 0 && sentKeys.length === 0, "T29 another volunteer's sign-in does not send them");

  f = await flushOutbox(server, store, VOL);
  const left = [...mem.values()];
  assert(f.sent === 2 && f.refused === 1 && left.length === 1 && left[0].status === "refused" && left[0].error === "Lane not found",
    "T29 back online: place and walk sent, the refused block stays listed with the server's reason");
  assert(sentKeys[0] === (r1.kind === "queued" ? r1.item.id : "") && sentKeys.length === 3,
    "T29 each change is sent with its own Idempotency-Key, in order");
  f = await flushOutbox(server, store, VOL);
  assert(sentKeys.length === 3, "T29 a refused change is not resent");
  await dismissOutboxItem(left[0].id, store);
  assert(mem.size === 0, "T29 the volunteer can dismiss a refusal");

  // A refused place: its walk is not sent (it would point at nothing).
  const refuseAll: Sender = async () => json(400, { detail: "GPS too rough" });
  const p = await sendOrQueue("/api/volunteer/register", { location_name: "Y" }, { label: "Register Y" }, offline, store, VOL);
  await sendOrQueue("/api/volunteer/record-path", { to_code: null }, { label: "Walk to Y", queueOnly: true,
    dependsOn: { id: p.kind === "queued" ? p.item.id : "", fields: ["to_code"] } }, offline, store, VOL);
  f = await flushOutbox(refuseAll, store, VOL);
  assert(f.refused === 1 && [...mem.values()].every((x) => x.status === "refused") && mem.size === 2,
    "T29 when a queued place is refused, its walk is marked not sent instead of failing later");

  // Online: a refusal comes back at once (the volunteer fixes it now), nothing is queued.
  mem.clear();
  const now = await sendOrQueue("/api/volunteer/edge-status", {}, { label: "x" }, server, store, VOL);
  assert(now.kind === "refused" && now.message === "Lane not found" && mem.size === 0, "T29 an online refusal is shown at once");
  // 409: permanent (one-way lane) unless the server says Retry-After (still being saved).
  mem.clear();
  const oneWay: Sender = async (path) =>
    path.endsWith("/record-path")
      ? json(409, { detail: "Lane A→B is one-way; it cannot be walked B→A" })
      : json(200, { success: true });
  const w = await sendOrQueue("/api/volunteer/record-path", {}, { label: "Walk B → A" }, oneWay, store, VOL);
  assert(w.kind === "refused" && w.message.includes("one-way") && mem.size === 0,
    "T29 a permanent 409 (one-way lane) is shown at once, not queued");
  await sendOrQueue("/api/volunteer/record-path", {}, { label: "Walk B → A" }, offline, store, VOL);
  await sendOrQueue("/api/volunteer/edge-status", {}, { label: "Block C–D" }, offline, store, VOL);
  f = await flushOutbox(oneWay, store, VOL);
  assert(f.refused === 1 && f.sent === 1 && f.waiting === 0 && mem.size === 1,
    "T29 a permanent 409 in the queue is refused and the next change is still sent");
  mem.clear();
  const busy: Sender = async () =>
    ({ ok: false, status: 409, headers: new Headers({ "Retry-After": "5" }), json: async () => ({}) }) as Response;
  await sendOrQueue("/api/volunteer/edge-status", {}, { label: "x" }, offline, store, VOL);
  await sendOrQueue("/api/volunteer/edge-status", {}, { label: "y" }, offline, store, VOL);
  f = await flushOutbox(busy, store, VOL);
  assert(f.waiting === 2 && f.refused === 0, "T29 a 409 with Retry-After (still being saved) waits and the queue stops");
  mem.clear();
  const down: Sender = async () => json(502, {});
  const q = await sendOrQueue("/api/volunteer/edge-status", {}, { label: "x" }, down, store, VOL);
  assert(q.kind === "queued", "T29 server down (5xx) → kept for later");
}
await outboxTests();

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll navigation scenario tests passed.");
