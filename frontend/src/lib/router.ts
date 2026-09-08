import { haversineM, type GraphEdge, type OfflinePack, type QrNode } from "./types";

export type RouteResult = {
  codes: string[];
  totalDistanceM: number;
  nodes: QrNode[];
};

type Link = { to: string; cost: number };

export function buildAdjacency(pack: OfflinePack): Map<string, Link[]> {
  const adj = new Map<string, Link[]>();
  const add = (from: string, to: string, cost: number) => {
    const list = adj.get(from) ?? [];
    list.push({ to, cost });
    adj.set(from, list);
  };
  for (const e of pack.edges) {
    add(e.from_code, e.to_code, e.distance_m);
    if (e.bidirectional !== false) add(e.to_code, e.from_code, e.distance_m);
  }
  return adj;
}

/** A* on man-made walkable paths (not satellite roads). */
export function findRoute(
  pack: OfflinePack,
  fromCode: string,
  toCode: string
): RouteResult {
  const from = fromCode.toUpperCase();
  const to = toCode.toUpperCase();
  const byCode = new Map(pack.nodes.map((n) => [n.code.toUpperCase(), n]));
  if (!byCode.has(from) || !byCode.has(to)) {
    return { codes: [], totalDistanceM: 0, nodes: [] };
  }
  if (from === to) {
    const n = byCode.get(from)!;
    return { codes: [from], totalDistanceM: 0, nodes: [n] };
  }

  const adj = buildAdjacency(pack);
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
      };
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

  return { codes: [], totalDistanceM: 0, nodes: [] };
}

export function edgeBetween(
  edges: GraphEdge[],
  a: string,
  b: string
): GraphEdge | undefined {
  return edges.find(
    (e) =>
      (e.from_code === a && e.to_code === b) ||
      (e.bidirectional !== false && e.from_code === b && e.to_code === a)
  );
}
