import {
  bearingDeg,
  haversineM,
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
  if (e.verified) {
    // Prefer volunteer-walked corridors over guessed links.
    cost *= 0.85;
  }
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
  const add = (from: string, to: string, edge: GraphEdge) => {
    const list = adj.get(from) ?? [];
    list.push({ to, cost: edgeTraversalCost(edge, prefer), edge });
    adj.set(from, list);
  };
  for (const e of pack.edges) {
    if (!isEdgeNavigable(e, options.blockedKeys)) continue;
    const from = e.from_code.toUpperCase();
    const to = e.to_code.toUpperCase();
    add(from, to, e);
    if (e.bidirectional !== false) add(to, from, e);
  }
  return adj;
}

function reconstruct(
  came: Map<string, string>,
  to: string,
  byCode: Map<string, QrNode>,
  gScore: Map<string, number>
): RouteResult {
  const codes: string[] = [];
  let c: string | undefined = to;
  while (c) {
    codes.unshift(c);
    c = came.get(c);
  }
  const nodes = codes.map((code) => byCode.get(code)!);
  return {
    codes,
    totalDistanceM: gScore.get(to) ?? 0,
    nodes,
    valid: codes.length >= 1,
  };
}

/** A* on navigable board↔board paths only (never through closed doors / blocks). */
export function findRoute(
  pack: OfflinePack,
  fromCode: string,
  toCode: string,
  options: RouteOptions = {}
): RouteResult {
  const from = fromCode.toUpperCase();
  const to = toCode.toUpperCase();
  const byCode = new Map(pack.nodes.map((n) => [n.code.toUpperCase(), n]));
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

  const adj = buildAdjacency(pack, options);
  const h = (code: string) => {
    const a = byCode.get(code)!;
    const b = byCode.get(to)!;
    return haversineM(a.lat, a.lon, b.lat, b.lon);
  };

  const open: { code: string; f: number }[] = [{ code: from, f: h(from) }];
  const gScore = new Map<string, number>([[from, 0]]);
  const came = new Map<string, string>();
  const closed = new Set<string>();

  while (open.length) {
    open.sort((a, b) => a.f - b.f);
    const current = open.shift()!;
    if (current.code === to) {
      return reconstruct(came, to, byCode, gScore);
    }
    if (closed.has(current.code)) continue;
    closed.add(current.code);

    for (const link of adj.get(current.code) ?? []) {
      if (closed.has(link.to)) continue;
      const tent = (gScore.get(current.code) ?? Infinity) + link.cost;
      if (tent < (gScore.get(link.to) ?? Infinity)) {
        came.set(link.to, current.code);
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
  return edges.find(
    (e) =>
      (e.from_code.toUpperCase() === A && e.to_code.toUpperCase() === B) ||
      (e.bidirectional !== false &&
        e.from_code.toUpperCase() === B &&
        e.to_code.toUpperCase() === A)
  );
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

export type PathInstruction = {
  text: string;
  detail: string;
  distanceM: number;
  kind: "straight" | "left" | "right" | "arrive" | "start";
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
      },
    ];
  }

  const raw: { heading: number; dist: number; toName: string }[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const e = edgeBetween(pack.edges, a.code, b.code);
    const dist = e?.distance_m ?? haversineM(a.lat, a.lon, b.lat, b.lon);
    raw.push({
      heading: legHeading(pack, a, b),
      dist,
      toName: b.name,
    });
  }

  // Merge consecutive legs with small heading change.
  type Merged = { heading: number; dist: number; toName: string };
  const merged: Merged[] = [];
  for (const leg of raw) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(normDelta(last.heading, leg.heading)) < 28) {
      last.dist += leg.dist;
      last.toName = leg.toName;
      last.heading = leg.heading;
    } else {
      merged.push({ ...leg });
    }
  }

  const out: PathInstruction[] = [];
  for (let i = 0; i < merged.length; i++) {
    const leg = merged[i];
    const meters = Math.max(1, Math.round(leg.dist));
    if (i === 0) {
      out.push({
        text: `Go straight for approximately ${meters} meters`,
        detail: `toward ${leg.toName}`,
        distanceM: leg.dist,
        kind: "straight",
      });
      continue;
    }
    const turn = normDelta(merged[i - 1].heading, leg.heading);
    const side = turn < 0 ? "left" : "right";
    const mag = Math.abs(turn);
    if (mag < 28) {
      out.push({
        text: `Continue for approximately ${meters} meters`,
        detail: `toward ${leg.toName}`,
        distanceM: leg.dist,
        kind: "straight",
      });
    } else {
      out.push({
        text: mag > 120 ? `Turn around, then go ${meters} m` : `Turn ${side}`,
        detail:
          mag > 120
            ? `then toward ${leg.toName}`
            : `then continue ~${meters} m toward ${leg.toName}`,
        distanceM: leg.dist,
        kind: side === "left" ? "left" : "right",
      });
    }
  }

  const dest = nodes[nodes.length - 1];
  out.push({
    text: "Your destination is ahead",
    detail: dest.name,
    distanceM: 0,
    kind: "arrive",
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
