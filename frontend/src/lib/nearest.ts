/**
 * "Where am I?" from GPS: nearest registered places to a live fix.
 * Pure functions so they can be tested without a browser.
 */
import { haversineM, isRegisteredLocation, type QrNode } from "./types";

/** Fix at least this accurate counts as a confident "you're near X". */
export const GOOD_FIX_M = 30;
/** Fixes worse than this are not used to suggest a place at all. */
export const WEAK_FIX_M = 100;
/** A place farther than this is not suggested as "you are here". */
export const MAX_SUGGEST_M = 100;

export type PlaceDistance = { node: QrNode; distanceM: number };

export type Fix = { lat: number; lon: number; accuracyM: number };

/** Registered places sorted nearest-first. */
export function placesByDistance(
  nodes: QrNode[],
  pos: { lat: number; lon: number }
): PlaceDistance[] {
  return nodes
    .filter(isRegisteredLocation)
    .map((node) => ({
      node,
      distanceM: haversineM(pos.lat, pos.lon, node.lat, node.lon),
    }))
    .sort((a, b) => a.distanceM - b.distanceM);
}

/**
 * Off the route: where the new route starts. Only points near the walker (map
 * junctions count: the nearest road point is usually the best restart) — the
 * phone has no river data, so a restart farther away could be across the
 * Godavari or behind a wall. None near enough → null (head back to the route).
 */
export const REROUTE_MAX_M = 50;

export function rerouteStart(
  nodes: QrNode[],
  pos: { lat: number; lon: number },
  destCode: string,
  canReach: (code: string) => boolean,
  maxM: number = REROUTE_MAX_M,
  candidates = 25
): PlaceDistance | null {
  return (
    nodes
      .filter((n) => Number.isFinite(n.lat) && Number.isFinite(n.lon) && n.code !== destCode)
      .map((node) => ({ node, distanceM: haversineM(pos.lat, pos.lon, node.lat, node.lon) }))
      .filter((d) => d.distanceM <= maxM)
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, candidates)
      .find((d) => canReach(d.node.code)) ?? null
  );
}

export type StartSuggestion =
  | { kind: "none"; reason: "no_fix" | "weak_fix" | "no_places" }
  /** Nearest place is farther than MAX_SUGGEST_M. */
  | { kind: "far"; nearest: PlaceDistance }
  /**
   * One or more candidates. More than one when GPS cannot tell them apart
   * (second place within the fix's accuracy of the first).
   */
  | { kind: "near"; candidates: PlaceDistance[]; approximate: boolean };

/** Decide what the start screen suggests for a live fix. Never auto-picks. */
export function suggestStart(nodes: QrNode[], fix: Fix | null): StartSuggestion {
  if (!fix) return { kind: "none", reason: "no_fix" };
  if (fix.accuracyM > WEAK_FIX_M) return { kind: "none", reason: "weak_fix" };
  const sorted = placesByDistance(nodes, fix);
  if (sorted.length === 0) return { kind: "none", reason: "no_places" };
  const nearest = sorted[0];
  if (nearest.distanceM > MAX_SUGGEST_M) return { kind: "far", nearest };
  const candidates = sorted
    .slice(0, 3)
    .filter(
      (p, i) =>
        i === 0 ||
        (p.distanceM <= MAX_SUGGEST_M &&
          p.distanceM - nearest.distanceM <= fix.accuracyM)
    );
  return {
    kind: "near",
    candidates,
    approximate: fix.accuracyM > GOOD_FIX_M,
  };
}

/** Human distance: "45 m" / "1.2 km". */
export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
