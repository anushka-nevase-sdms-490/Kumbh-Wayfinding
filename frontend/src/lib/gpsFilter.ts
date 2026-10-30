/**
 * Smoothing for raw GPS fixes. Pure function so it can be tested; the
 * useLivePosition hook keeps the state between fixes.
 */
import { haversineM } from "./types";

/** Don't anchor on a coarse first fix — it would distort everything after it. */
export const MAX_SEED_ACCURACY_M = 30;
/** A sudden move farther than this with poor accuracy looks like GPS noise… */
export const MAX_JUMP_M = 35;
/** …unless it repeats: after this many in a row the visitor really moved. */
export const MAX_REJECTS = 3;

export type GpsFilterState = {
  smooth: { lat: number; lon: number } | null;
  rejects: number;
};

export const INITIAL_GPS_FILTER: GpsFilterState = { smooth: null, rejects: 0 };

export type RawFix = { lat: number; lon: number; accuracyM: number };

export type FilterResult = {
  state: GpsFilterState;
  /** Position to show; null when the fix was rejected as a jump. */
  pos: { lat: number; lon: number } | null;
  kind: "weak_seed" | "seed" | "smoothed" | "jump_rejected" | "reseed" | "unseeded";
};

export function filterFix(state: GpsFilterState, fix: RawFix): FilterResult {
  const raw = { lat: fix.lat, lon: fix.lon };
  const prev = state.smooth;
  if (!prev) {
    if (fix.accuracyM > MAX_SEED_ACCURACY_M) {
      // Show it (marked unusable by the caller) but keep waiting for a good fix.
      return { state, pos: raw, kind: "weak_seed" };
    }
    return { state: { smooth: raw, rejects: 0 }, pos: raw, kind: "seed" };
  }

  const jump = haversineM(prev.lat, prev.lon, fix.lat, fix.lon);
  if (jump > MAX_JUMP_M) {
    // An accurate fix far away is the truth: take it as is, don't blend it.
    if (fix.accuracyM <= 15) return { state: { smooth: raw, rejects: 0 }, pos: raw, kind: "reseed" };
    if (state.rejects + 1 < MAX_REJECTS) {
      return { state: { smooth: prev, rejects: state.rejects + 1 }, pos: null, kind: "jump_rejected" };
    }
    // Jumps keep coming: the old position is stale. Re-anchor only on a fix
    // good enough to seed from; otherwise start over and wait for one.
    if (fix.accuracyM <= MAX_SEED_ACCURACY_M) {
      return { state: { smooth: raw, rejects: 0 }, pos: raw, kind: "reseed" };
    }
    return { state: INITIAL_GPS_FILTER, pos: raw, kind: "unseeded" };
  }

  // Trust accurate fixes more, so walking does not lag behind.
  const alpha =
    fix.accuracyM <= 10 ? 0.6 : fix.accuracyM <= 15 ? 0.45 : fix.accuracyM <= 28 ? 0.25 : 0.12;
  const next = {
    lat: prev.lat + (fix.lat - prev.lat) * alpha,
    lon: prev.lon + (fix.lon - prev.lon) * alpha,
  };
  return { state: { smooth: next, rejects: 0 }, pos: next, kind: "smoothed" };
}
