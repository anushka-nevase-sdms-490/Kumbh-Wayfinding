import {
  bearingDeg,
  haversineM,
  isFieldVerified,
  isRegisteredLocation,
  type GraphEdge,
  type OfflinePack,
  type QrNode,
} from "./types";

export type RouteResult = {
  codes: string[];
  totalDistanceM: number;
  nodes: QrNode[];
  valid: boolean;
  reason?: string;
};

export type RouteOptions = {
  /** Extra edge keys "A|B" (sorted) to treat as non-navigable this session. */
  blockedKeys?: Set<string>;
  /** Prefer paths with at least this clearance (m); lower clearance costs more. */
  preferClearanceM?: number;
};

type Link = { to: string; cost: number; edge: GraphEdge };

export function edgeKey(a: string, b: string): string {
  const A = a.toUpperCase();
  const B = b.toUpperCase();
  return A < B ? `${A}|${B}` : `${B}|${A}`;
}

/** True if this edge may be used for offline navigation. */
export function isEdgeNavigable(
  e: GraphEdge,
  blockedKeys?: Set<string>
): boolean {
  if (e.walkable === false) return false;
  if (e.blocked === true) return false;
  const door = (e.door_state ?? "none").toLowerCase();
  if (door === "closed") return false;
  // Glass walls are never walkable transitions.
  const kind = (e.passage_kind ?? "corridor").toLowerCase();
  if (kind === "glass_wall" || kind === "wall") return false;
  if (blockedKeys?.has(edgeKey(e.from_code, e.to_code))) return false;
  return true;
}

/** Path cost with safety-buffer preference (low clearance ⇒ higher cost). */
export function edgeTraversalCost(
  e: GraphEdge,
  preferClearanceM = 1.0
): number {
  let cost = Math.max(1, e.distance_m) * Math.max(1, e.cost_mult ?? 1);
  // Trust order: checked on the ground > reviewed on maps > imported / unverified.
  if (isFieldVerified(e)) cost *= 0.85;
  else if (e.verification === "remotely_reviewed") cost *= 0.95;
  const clearance = e.clearance_m;
  if (typeof clearance === "number" && clearance < preferClearanceM) {
    // Soft penalty — still usable, but A* prefers wider corridors.
    cost *= 1 + (preferClearanceM - clearance) * 1.5;
  }
  const door = (e.door_state ?? "none").toLowerCase();
  if (door === "unknown") cost *= 1.15;
  if ((e.passage_kind ?? "").toLowerCase() === "door") cost *= 1.05;
  return cost;
}

export function buildAdjacency(
  pack: OfflinePack,
  options: RouteOptions = {}
): Map<string, Link[]> {
  const adj = new Map<string, Link[]>();
  const prefer = options.preferClearanceM ?? 1.0;
  const known = new Set(pack.nodes.map((n) => n.code.toUpperCase()));
  const add = (from: string, to: string, edge: GraphEdge) => {
    const list = adj.get(from) ?? [];
    list.push({ to, cost: edgeTraversalCost(edge, prefer), edge });
    adj.set(from, list);
  };
  for (const e of pack.edges) {
    if (!isEdgeNavigable(e, options.blockedKeys)) continue;
    const from = e.from_code.toUpperCase();
    const to = e.to_code.toUpperCase();
    // A lane to a place missing from the pack would crash the A* heuristic.
    if (!known.has(from) || !known.has(to)) continue;
    add(from, to, e);
    if (e.bidirectional !== false) add(to, from, e);
  }
  return adj;
}

function reconstruct(
  came: Map<string, string>,
  cameEdge: Map<string, GraphEdge>,
  to: string,
  byCode: Map<string, QrNode>
): RouteResult {
  const codes: string[] = [];
  let c: string | undefined = to;
  let metres = 0;
  while (c) {
    codes.unshift(c);
    // Sum real lane lengths — gScore is a weighted cost, not metres.
    metres += cameEdge.get(c)?.distance_m ?? 0;
    c = came.get(c);
  }
  const nodes = codes.map((code) => byCode.get(code)!);
  return {
    codes,
    totalDistanceM: metres,
    nodes,
    valid: codes.length >= 1,
  };
}

/** A* on navigable board↔board paths only (never through closed doors / blocks). */
type Graph = { byCode: Map<string, QrNode>; adj: Map<string, Link[]> };
/** A pack is never changed in place (a new one replaces it), so its graph can be reused. */
const graphCache = new WeakMap<OfflinePack, Map<string, Graph>>();

function graphFor(pack: OfflinePack, options: RouteOptions): Graph {
  const key = `${[...(options.blockedKeys ?? [])].sort().join(",")}|${options.preferClearanceM ?? 1}`;
  let perPack = graphCache.get(pack);
  if (!perPack) {
    perPack = new Map();
    graphCache.set(pack, perPack);
  }
  let g = perPack.get(key);
  if (!g) {
    g = {
      byCode: new Map(pack.nodes.map((n) => [n.code.toUpperCase(), n])),
      adj: buildAdjacency(pack, options),
    };
    // Session blocks change rarely; don't keep every combination ever seen.
    if (perPack.size > 8) perPack.clear();
    perPack.set(key, g);
  }
  return g;
}

/** Min-heap on f for A* (thousands of map junctions — no re-sorting per step). */
class OpenSet {
  private items: { code: string; f: number }[] = [];
  get size() {
    return this.items.length;
  }
  push(item: { code: string; f: number }) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): { code: string; f: number } {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export function findRoute(
  pack: OfflinePack,
  fromCode: string,
  toCode: string,
  options: RouteOptions = {}
): RouteResult {
  const from = fromCode.toUpperCase();
  const to = toCode.toUpperCase();
  const { byCode, adj } = graphFor(pack, options);
  if (!byCode.has(from) || !byCode.has(to)) {
    return {
      codes: [],
      totalDistanceM: 0,
      nodes: [],
      valid: false,
      reason: "Unknown start or destination board",
    };
  }
  if (from === to) {
    const n = byCode.get(from)!;
    return { codes: [from], totalDistanceM: 0, nodes: [n], valid: true };
  }

  const goal = byCode.get(to)!;
  // Admissible: no lane costs less than 0.85 × its length (walked lanes).
  const h = (code: string) => {
    const a = byCode.get(code)!;
    return haversineM(a.lat, a.lon, goal.lat, goal.lon) * 0.85;
  };

  const open = new OpenSet();
  open.push({ code: from, f: h(from) });
  const gScore = new Map<string, number>([[from, 0]]);
  const came = new Map<string, string>();
  const cameEdge = new Map<string, GraphEdge>();
  const closed = new Set<string>();

  while (open.size) {
    const current = open.pop();
    if (current.code === to) {
      return reconstruct(came, cameEdge, to, byCode);
    }
    if (closed.has(current.code)) continue;
    closed.add(current.code);

    for (const link of adj.get(current.code) ?? []) {
      if (closed.has(link.to)) continue;
      const tent = (gScore.get(current.code) ?? Infinity) + link.cost;
      if (tent < (gScore.get(link.to) ?? Infinity)) {
        came.set(link.to, current.code);
        cameEdge.set(link.to, link.edge);
        gScore.set(link.to, tent);
        open.push({ code: link.to, f: tent + h(link.to) });
      }
    }
  }

  return {
    codes: [],
    totalDistanceM: 0,
    nodes: [],
    valid: false,
    reason: "Destination currently unreachable — no safe walkable path",
  };
}

export function edgeBetween(
  edges: GraphEdge[],
  a: string,
  b: string
): GraphEdge | undefined {
  const A = a.toUpperCase();
  const B = b.toUpperCase();
  const matches = edges.filter(
    (e) =>
      (e.from_code.toUpperCase() === A && e.to_code.toUpperCase() === B) ||
      (e.bidirectional !== false &&
        e.from_code.toUpperCase() === B &&
        e.to_code.toUpperCase() === A)
  );
  // Older data can hold duplicate lanes; describe the one A* would pick.
  let best: GraphEdge | undefined;
  for (const e of matches) {
    if (!best) {
      best = e;
      continue;
    }
    const nav = isEdgeNavigable(e);
    const bestNav = isEdgeNavigable(best);
    if (nav !== bestNav ? nav : edgeTraversalCost(e) < edgeTraversalCost(best)) {
      best = e;
    }
  }
  return best;
}

/** Real walk compass heading when leaving `from` toward `to` (path-aware). */
export function walkHeadingDeg(
  edges: GraphEdge[],
  from: string,
  to: string
): number | null {
  const e = edgeBetween(edges, from, to);
  if (!e) return null;
  const A = from.toUpperCase();
  const B = to.toUpperCase();
  if (e.from_code.toUpperCase() === A && e.to_code.toUpperCase() === B) {
    return typeof e.heading_ab === "number" ? e.heading_ab : null;
  }
  if (e.from_code.toUpperCase() === B && e.to_code.toUpperCase() === A) {
    return typeof e.heading_ba === "number" ? e.heading_ba : null;
  }
  return null;
}

export type RouteValidation = {
  ok: boolean;
  errors: string[];
};

/** Validate every hop before showing the route to the user. */
export function validateRoute(
  pack: OfflinePack,
  codes: string[],
  options: RouteOptions = {}
): RouteValidation {
  const errors: string[] = [];
  if (codes.length === 0) {
    return { ok: false, errors: ["Empty route"] };
  }
  if (codes.length === 1) return { ok: true, errors: [] };

  const byCode = new Map(pack.nodes.map((n) => [n.code.toUpperCase(), n]));
  for (const c of codes) {
    if (!byCode.has(c.toUpperCase())) {
      errors.push(`Unknown board on route: ${c}`);
    }
  }
  for (let i = 0; i < codes.length - 1; i++) {
    const a = codes[i];
    const b = codes[i + 1];
    const e = edgeBetween(pack.edges, a, b);
    if (!e) {
      errors.push(`No edge between ${a} and ${b}`);
      continue;
    }
    if (!isEdgeNavigable(e, options.blockedKeys)) {
      errors.push(
        `Non-navigable segment ${a}→${b}` +
          (e.blocked ? " (blocked)" : "") +
          (e.door_state === "closed" ? " (closed door)" : "") +
          (e.walkable === false ? " (not walkable)" : "")
      );
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Legs shorter than this (connectors onto the road) fold into a neighbour. */
const SHORT_LEG_M = 10;

export type PathInstruction = {
  /** English text (tests, fallback); the UI words it from the fields below. */
  text: string;
  detail: string;
  distanceM: number;
  kind: "straight" | "left" | "right" | "arrive" | "start";
  /** First instruction of the route ("go straight" rather than "continue"). */
  first?: boolean;
  turn?: "left" | "right" | "around";
  /** Street the stretch follows (map lanes with a name). */
  street?: string | null;
  /** Next real place ahead (hidden junctions skipped). */
  toCode?: string;
};

function normDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

function legHeading(
  pack: OfflinePack,
  a: QrNode,
  b: QrNode
): number {
  return (
    walkHeadingDeg(pack.edges, a.code, b.code) ??
    bearingDeg(a.lat, a.lon, b.lat, b.lon)
  );
}

/**
 * Turn-by-turn from the actual navigation path (not raw arrow flicker).
 * Consecutive nearly-straight legs are merged.
 */
export function buildPathInstructions(
  pack: OfflinePack,
  codes: string[]
): PathInstruction[] {
  const byCode = new Map(pack.nodes.map((n) => [n.code.toUpperCase(), n]));
  const nodes = codes
    .map((c) => byCode.get(c.toUpperCase()))
    .filter((n): n is QrNode => !!n);
  if (nodes.length === 0) return [];
  if (nodes.length === 1) {
    return [
      {
        text: "YOU REACHED YOUR DESTINATION",
        detail: nodes[0].name,
        distanceM: 0,
        kind: "arrive",
        toCode: nodes[0].code,
      },
    ];
  }

  // Hidden map junctions have no name: "toward" names the next real place.
  const visible = (n: QrNode) => isRegisteredLocation(n) && n.name.trim().length > 0;
  const ahead: QrNode[] = [];
  for (let i = nodes.length - 1, next = nodes[nodes.length - 1]; i >= 1; i--) {
    if (visible(nodes[i])) next = nodes[i];
    ahead[i - 1] = next;
  }

  type Leg = {
    /** Heading leaving the leg's start / arriving at its end (curved map roads differ). */
    heading: number;
    endHeading: number;
    dist: number;
    to: QrNode;
    street: string | null;
  };
  const raw: Leg[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const e = edgeBetween(pack.edges, a.code, b.code);
    const dist = e?.distance_m ?? haversineM(a.lat, a.lon, b.lat, b.lon);
    const heading = legHeading(pack, a, b);
    const back = walkHeadingDeg(pack.edges, b.code, a.code);
    raw.push({
      heading,
      endHeading: back == null ? heading : (back + 180) % 360,
      dist,
      to: ahead[i],
      street: e?.name?.trim() || null,
    });
  }

  // A few metres onto or off the road (a place's connector) is not a step of
  // its own: fold it into the leg after it (or, at the end, the one before).
  const legs: Leg[] = [];
  for (const leg of raw) {
    const last = legs[legs.length - 1];
    if (last && last.dist < SHORT_LEG_M) {
      legs[legs.length - 1] = { ...leg, dist: leg.dist + last.dist };
    } else {
      legs.push({ ...leg });
    }
  }
  if (legs.length > 1 && legs[legs.length - 1].dist < SHORT_LEG_M) {
    const tail = legs.pop()!;
    const last = legs[legs.length - 1];
    last.dist += tail.dist;
    last.to = tail.to;
  }

  // Merge consecutive legs that go on straight ahead. A run of small bends
  // still adds up to a turn (compared with the heading the stretch started
  // on) — except along one named street, which may curve.
  type Merged = Leg & { startHeading: number };
  const merged: Merged[] = [];
  for (const leg of legs) {
    const last = merged[merged.length - 1];
    const atJunction = last ? normDelta(last.endHeading, leg.heading) : 0;
    const sinceStart = last ? normDelta(last.startHeading, leg.heading) : 0;
    const sameStreet = !!last && !!leg.street && leg.street === last.street;
    if (last && Math.abs(atJunction) < 28 && (sameStreet || Math.abs(sinceStart) < 28)) {
      last.dist += leg.dist;
      last.to = leg.to;
      last.heading = leg.heading;
      last.endHeading = leg.endHeading;
    } else {
      merged.push({ ...leg, startHeading: leg.heading });
    }
  }

  const out: PathInstruction[] = [];
  for (let i = 0; i < merged.length; i++) {
    const leg = merged[i];
    const meters = Math.max(1, Math.round(leg.dist));
    const along = leg.street ? `along ${leg.street} ` : "";
    const base = { distanceM: leg.dist, street: leg.street, toCode: leg.to.code };
    if (i === 0) {
      out.push({
        ...base,
        text: `Go straight for approximately ${meters} meters`,
        detail: `${along}toward ${leg.to.name}`,
        kind: "straight",
        first: true,
      });
      continue;
    }
    const prev = merged[i - 1];
    const atJunction = normDelta(prev.endHeading, leg.startHeading);
    // A sharp turn where the legs meet, else the bends that added up since
    // the last stretch began.
    const turn =
      Math.abs(atJunction) >= 28 ? atJunction : normDelta(prev.startHeading, leg.startHeading);
    const side = turn < 0 ? "left" : "right";
    const mag = Math.abs(turn);
    if (mag < 28) {
      out.push({
        ...base,
        text: `Continue for approximately ${meters} meters`,
        detail: `${along}toward ${leg.to.name}`,
        kind: "straight",
      });
    } else {
      const onto = leg.street ? ` onto ${leg.street}` : "";
      out.push({
        ...base,
        text: mag > 120 ? `Turn around, then go ${meters} m` : `Turn ${side}${onto}`,
        detail:
          mag > 120
            ? `then ${along}toward ${leg.to.name}`
            : `then continue ~${meters} m toward ${leg.to.name}`,
        kind: side === "left" ? "left" : "right",
        turn: mag > 120 ? "around" : side,
      });
    }
  }

  const dest = nodes[nodes.length - 1];
  out.push({
    text: "Your destination is ahead",
    detail: dest.name,
    distanceM: 0,
    kind: "arrive",
    toCode: dest.code,
  });
  return out;
}

/** True if dest is graph-reachable from current board (obstacle-aware). */
export function isReachable(
  pack: OfflinePack,
  fromCode: string,
  toCode: string,
  options: RouteOptions = {}
): boolean {
  const r = findRoute(pack, fromCode, toCode, options);
  return r.valid && r.codes.length > 0;
}
