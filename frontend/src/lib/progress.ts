/**
 * Where the visitor is along their route, from live GPS.
 * Pure functions (no React) so they can be tested.
 */
import { routeLine, type LonLat } from "./mapData";
import { edgeBetween } from "./router";
import { haversineM, type OfflinePack } from "./types";

/** Within this many metres of the route line (or a place) counts as "on it". */
export const ON_ROUTE_M = 25;
/** Farther than this from the line (or 1.5× GPS accuracy) is off the route. */
export const OFF_ROUTE_M = 40;
/** Consecutive off-route fixes before rerouting (one bad fix is not enough). */
export const OFF_ROUTE_FIXES = 3;
/** "Reached the next place" when this close along the lane (or GPS accuracy). */
export const REACHED_M = 12;

export type RouteProgress = {
  /** Distance from the visitor to the route line (current or next lane). */
  offRouteM: number;
  /** Metres left along the current lane to the next place. */
  toNextM: number;
  /** Metres left along the route to the destination. */
  remainingM: number;
  /** Straight-line distance to the next place (to decide "reached it"). */
  nextPlaceM: number;
  /** Length of the current lane. */
  laneM: number;
  /** Distance to the current lane's line. */
  currentLaneM: number;
  /** Distance to the following lane's line (Infinity on the final lane). */
  followingLaneM: number;
};

type Nearest = { distM: number; alongM: number; lengthM: number };

/** Nearest point on a polyline, in a local metric frame around `pos`. */
function nearestOnLine(line: LonLat[], pos: { lat: number; lon: number }): Nearest {
  const kx = 111320 * Math.cos((pos.lat * Math.PI) / 180);
  const ky = 111320;
  const xy = line.map(([lon, lat]) => [(lon - pos.lon) * kx, (lat - pos.lat) * ky]);
  if (xy.length === 1) return { distM: Math.hypot(xy[0][0], xy[0][1]), alongM: 0, lengthM: 0 };
  let best: Nearest = { distM: Infinity, alongM: 0, lengthM: 0 };
  let walked = 0;
  for (let i = 0; i < xy.length - 1; i++) {
    const [ax, ay] = xy[i];
    const [bx, by] = xy[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const seg = Math.hypot(dx, dy);
    // Projection of the visitor (origin) onto the segment, clamped to it.
    const t = seg > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (seg * seg))) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.distM) best = { distM: d, alongM: walked + t * seg, lengthM: 0 };
    walked += seg;
  }
  best.lengthM = walked;
  return best;
}

/**
 * Locate the visitor on the route `codes` (first code = current place).
 *
 * Progress is measured on the current lane only: the visitor moves on to the
 * next place one at a time, when they actually reach it (see `reachedPlace`).
 * Matching against every lane would let GPS noise jump to a later lane that
 * happens to pass nearby — e.g. the far bank of a river — and fake an arrival.
 */
export function routeProgress(
  pack: OfflinePack,
  codes: string[],
  pos: { lat: number; lon: number }
): RouteProgress | null {
  if (codes.length < 2) return null;
  const byCode = new Map(pack.nodes.map((n) => [n.code.toUpperCase(), n]));
  const lane = (i: number) => {
    const a = codes[i];
    const b = codes[i + 1];
    const edge = edgeBetween(pack.edges, a, b);
    const na = byCode.get(a.toUpperCase());
    const nb = byCode.get(b.toUpperCase());
    const metres = edge?.distance_m ?? (na && nb ? haversineM(na.lat, na.lon, nb.lat, nb.lon) : 0);
    return { line: routeLine(pack, [a, b]), metres };
  };

  const current = lane(0);
  const near = nearestOnLine(current.line, pos);
  // Just past the next place the visitor is on the following lane — not off route.
  const following = codes.length > 2 ? nearestOnLine(lane(1).line, pos).distM : Infinity;

  const leftFraction = near.lengthM > 0 ? 1 - near.alongM / near.lengthM : 0;
  const toNextM = Math.max(0, leftFraction * current.metres);
  let laterM = 0;
  for (let i = 1; i < codes.length - 1; i++) laterM += lane(i).metres;

  const next = byCode.get(codes[1].toUpperCase());
  return {
    offRouteM: Math.min(near.distM, following),
    toNextM,
    remainingM: toNextM + laterM,
    nextPlaceM: next ? haversineM(pos.lat, pos.lon, next.lat, next.lon) : Infinity,
    laneM: current.metres,
    currentLaneM: near.distM,
    followingLaneM: following,
  };
}

/**
 * The visitor has reached the next place: near it along the lane, and never
 * before the lane's halfway point (short lanes would otherwise "arrive" at
 * the start), with a straight-line sanity check.
 *
 * Also when GPS missed the moment they passed it (fixes drop under tents and
 * crowds): the current lane is used up and they are clearly on the next one.
 */
export function reachedPlace(progress: RouteProgress, accuracyM: number): boolean {
  const alongM = Math.min(Math.max(REACHED_M, accuracyM), progress.laneM / 2);
  if (progress.toNextM > alongM) return false;
  const atPlace = progress.nextPlaceM <= Math.max(ON_ROUTE_M, accuracyM);
  const onFollowingLane =
    progress.followingLaneM <= Math.max(ON_ROUTE_M, accuracyM) &&
    progress.followingLaneM < progress.currentLaneM;
  return atPlace || onFollowingLane;
}

/** Off-route threshold for a fix: wider when GPS is less accurate. */
export function offRouteLimitM(accuracyM: number): number {
  return Math.max(OFF_ROUTE_M, accuracyM * 1.5);
}
