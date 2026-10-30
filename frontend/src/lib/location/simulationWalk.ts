/**
 * Movement of the simulated walker — pure functions (no timers, no React), so
 * tests can drive them second by second. Coordinates: [lon, lat] like the map.
 */
import { haversineM } from "../types";

export type LonLat = [number, number];

/** Normal walking speed in a crowd (m/s); the panel multiplies it. */
export const WALK_SPEED_MPS = 1.3;
/** How far a simulated GPS jump throws the position (m). */
export const JUMP_M = 120;

export type SimState = {
  /** The app's current route line (what a visitor would follow). */
  route: LonLat[];
  /** The line being walked (the route, or a detour back to it). */
  path: LonLat[];
  /** Metres walked along `path`. */
  along: number;
  /** True position of the walker. */
  pos: { lat: number; lon: number };
  playing: boolean;
  speedX: number;
  accuracyM: number;
  noise: boolean;
  /** Walking away from the route (heading set when it started). */
  offRoute: { bearingDeg: number } | null;
  /** No position reports (signal lost) — the walker keeps moving. */
  lost: boolean;
  /** One report thrown far away, then normal again. */
  jumpPending: boolean;
  arrived: boolean;
};

export function pathLength(path: LonLat[]): number {
  let m = 0;
  for (let i = 1; i < path.length; i++) {
    m += haversineM(path[i - 1][1], path[i - 1][0], path[i][1], path[i][0]);
  }
  return m;
}

/** Point `meters` along the path (clamped to its ends). */
export function pointAlong(path: LonLat[], meters: number): { lat: number; lon: number } {
  if (path.length === 0) return { lat: 0, lon: 0 };
  let left = Math.max(0, meters);
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1];
    const [bx, by] = path[i];
    const seg = haversineM(ay, ax, by, bx);
    if (left <= seg && seg > 0) {
      const t = left / seg;
      return { lat: ay + (by - ay) * t, lon: ax + (bx - ax) * t };
    }
    left -= seg;
  }
  const [lx, ly] = path[path.length - 1];
  return { lat: ly, lon: lx };
}

/** Metres along the path of the point nearest to `pos` (local flat frame). */
export function nearestAlong(path: LonLat[], pos: { lat: number; lon: number }): number {
  const kx = 111320 * Math.cos((pos.lat * Math.PI) / 180);
  const ky = 111320;
  let best = Infinity;
  let bestAlong = 0;
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const ax = (path[i - 1][0] - pos.lon) * kx;
    const ay = (path[i - 1][1] - pos.lat) * ky;
    const bx = (path[i][0] - pos.lon) * kx;
    const by = (path[i][1] - pos.lat) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const seg = Math.hypot(dx, dy);
    const t = seg > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (seg * seg))) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) {
      best = d;
      bestAlong = walked + t * seg;
    }
    walked += seg;
  }
  return bestAlong;
}

/** Move a point `meters` towards `bearingDeg` (small distances). */
export function offset(p: { lat: number; lon: number }, bearingDeg: number, meters: number) {
  const b = (bearingDeg * Math.PI) / 180;
  return {
    lat: p.lat + (meters * Math.cos(b)) / 111320,
    lon: p.lon + (meters * Math.sin(b)) / (111320 * Math.cos((p.lat * Math.PI) / 180)),
  };
}

function bearingAt(path: LonLat[], along: number): number {
  const a = pointAlong(path, along);
  const b = pointAlong(path, along + 5);
  const y = (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180);
  const x = b.lat - a.lat;
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function initialSimState(pos: { lat: number; lon: number }): SimState {
  return {
    route: [],
    path: [],
    along: 0,
    pos,
    playing: false,
    speedX: 1,
    accuracyM: 8,
    noise: true,
    offRoute: null,
    lost: false,
    jumpPending: false,
    arrived: false,
  };
}

/** Start walking along `path` from its beginning (the route's start). */
export function startWalk(s: SimState, path: LonLat[]): SimState {
  if (path.length < 2) return s;
  return {
    ...s,
    route: path,
    path,
    along: 0,
    pos: pointAlong(path, 0),
    playing: true,
    arrived: false,
    offRoute: null,
  };
}

/**
 * The route changed (reroute, or the app moved on to the next place): keep
 * walking from where the walker is — straight to the nearest point of the new
 * line first if it is more than a few metres away.
 */
export function followNewPath(s: SimState, path: LonLat[]): SimState {
  if (path.length < 2) return s;
  // Still wandering off: remember the new route for when the walker turns back.
  if (s.offRoute) return { ...s, route: path };
  const along = nearestAlong(path, s.pos);
  const onLine = pointAlong(path, along);
  const gap = haversineM(s.pos.lat, s.pos.lon, onLine.lat, onLine.lon);
  if (gap < 3) {
    // Already at the end of the new line (e.g. the last few metres): stay arrived.
    const arrived = s.arrived && along >= pathLength(path) - 1;
    return { ...s, route: path, path, along, arrived };
  }
  // Detour: walk back to the line, then on along it.
  const rest = remainingFrom(path, along);
  const detour: LonLat[] = [[s.pos.lon, s.pos.lat], [onLine.lon, onLine.lat], ...rest.slice(1)];
  return { ...s, route: path, path: detour, along: 0, arrived: false };
}

function remainingFrom(path: LonLat[], along: number): LonLat[] {
  const out: LonLat[] = [];
  const start = pointAlong(path, along);
  out.push([start.lon, start.lat]);
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    walked += haversineM(path[i - 1][1], path[i - 1][0], path[i][1], path[i][0]);
    if (walked > along) out.push(path[i]);
  }
  return out;
}

export type StepResult = { state: SimState; fix: { lat: number; lon: number; accuracyM: number } | null };

/**
 * Advance the walker by `dt` seconds and produce this second's position
 * report (null while the signal is lost). `rand` returns 0..1 (injectable).
 */
export function stepSim(s: SimState, dt: number, rand: () => number = Math.random): StepResult {
  let next = s;
  if (s.playing && !s.arrived) {
    const meters = WALK_SPEED_MPS * s.speedX * dt;
    if (s.offRoute) {
      next = { ...s, pos: offset(s.pos, s.offRoute.bearingDeg, meters) };
    } else if (s.path.length >= 2) {
      const total = pathLength(s.path);
      const along = Math.min(total, s.along + meters);
      next = { ...s, along, pos: pointAlong(s.path, along), arrived: along >= total };
      if (next.arrived) next.playing = false;
    }
  }
  if (next.lost) return { state: next, fix: null };
  let reported = next.pos;
  if (next.jumpPending) {
    reported = offset(next.pos, rand() * 360, JUMP_M);
    next = { ...next, jumpPending: false };
  } else if (next.noise) {
    // Scatter within roughly the accuracy circle (most fixes well inside it).
    reported = offset(next.pos, rand() * 360, rand() * next.accuracyM * 0.6);
  }
  return { state: next, fix: { ...reported, accuracyM: next.accuracyM } };
}

/** Start walking off the route, at a right angle to it. */
export function goOffRoute(s: SimState): SimState {
  const heading = s.path.length >= 2 ? bearingAt(s.path, s.along) : 0;
  return { ...s, offRoute: { bearingDeg: (heading + 90) % 360 } };
}

/** Stop wandering: walk straight back to the (latest) route and go on along it. */
export function backOnRoute(s: SimState): SimState {
  return followNewPath({ ...s, offRoute: null }, s.route);
}
