/**
 * Geometry for the map: route line along walked lanes, GPS accuracy circle.
 * Pure functions (no MapLibre) so they can be tested.
 */
import { edgeBetween } from "./router";
import { isFieldVerified, type OfflinePack } from "./types";

export type LonLat = [number, number];

type PathPoint = { lat: number; lon: number };

function parsePath(raw: unknown): PathPoint[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list.filter(
    (p): p is PathPoint =>
      !!p && typeof p.lat === "number" && typeof p.lon === "number"
  );
}

type Leg = { coords: LonLat[]; mapRoad: boolean };

/**
 * Each leg of the route as a line: the volunteer's recorded walk (or the map
 * road's shape) when the lane has one, reversed when travelled the other way,
 * otherwise a straight segment between the two places.
 */
function routeLegs(pack: OfflinePack, codes: string[]): Leg[] {
  const byCode = new Map(pack.nodes.map((n) => [n.code.toUpperCase(), n]));
  const legs: Leg[] = [];
  for (let i = 0; i < codes.length - 1; i++) {
    const a = byCode.get(codes[i].toUpperCase());
    const b = byCode.get(codes[i + 1].toUpperCase());
    if (!a || !b) continue;
    const edge = edgeBetween(pack.edges, a.code, b.code);
    const coords: LonLat[] = [[a.lon, a.lat]];
    let walk = parsePath(edge?.path_json);
    if (edge && walk.length >= 2) {
      const forward = edge.from_code.toUpperCase() === a.code.toUpperCase();
      if (!forward) walk = [...walk].reverse();
      for (const p of walk) coords.push([p.lon, p.lat]);
    }
    coords.push([b.lon, b.lat]);
    // Dashed: anything not checked on the ground (map roads, unwalked links).
    legs.push({ coords, mapRoad: !!edge && !isFieldVerified(edge) });
  }
  return legs;
}

function joinLine(target: LonLat[], coords: LonLat[]) {
  for (const p of coords) {
    const last = target[target.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) target.push(p);
  }
}

/** Line through the route's places, along walked lanes and map roads. */
export function routeLine(pack: OfflinePack, codes: string[]): LonLat[] {
  const byCode = new Map(pack.nodes.map((n) => [n.code.toUpperCase(), n]));
  const line: LonLat[] = [];
  if (codes.length === 1) {
    const a = byCode.get(codes[0].toUpperCase());
    if (a) line.push([a.lon, a.lat]);
    return line;
  }
  for (const leg of routeLegs(pack, codes)) joinLine(line, leg.coords);
  return line;
}

/**
 * The parts of the route nobody has checked on the ground — map roads and
 * unwalked links (drawn dashed, with a warning). Consecutive ones form one line.
 */
export function mapRoadParts(pack: OfflinePack, codes: string[]): LonLat[][] {
  const parts: LonLat[][] = [];
  let current: LonLat[] | null = null;
  for (const leg of routeLegs(pack, codes)) {
    if (!leg.mapRoad) {
      current = null;
      continue;
    }
    if (!current) {
      current = [];
      parts.push(current);
    }
    joinLine(current, leg.coords);
  }
  return parts;
}

/** Polygon approximating a circle of `radiusM` metres around a point. */
export function circlePolygon(lon: number, lat: number, radiusM: number, steps = 48): LonLat[] {
  const out: LonLat[] = [];
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    out.push([lon + dLon * Math.cos(t), lat + dLat * Math.sin(t)]);
  }
  return out;
}

/** [[west, south], [east, north]] around a set of points, or null. */
export function boundsOf(points: LonLat[]): [LonLat, LonLat] | null {
  if (points.length === 0) return null;
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [lon, lat] of points) {
    w = Math.min(w, lon);
    e = Math.max(e, lon);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  return [
    [w, s],
    [e, n],
  ];
}
