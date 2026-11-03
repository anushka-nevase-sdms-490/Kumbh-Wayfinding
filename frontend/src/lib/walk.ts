/**
 * Recording a volunteer's walk along a lane. The walked length becomes the
 * lane's routing cost, so GPS wander must not add metres: a fix is kept only
 * when it is accurate enough and the volunteer has really moved since the
 * last kept one (standing still for minutes used to turn 200 m into 800 m).
 */
import { haversineM, osmConfirmRadiusM } from "./types";

export type WalkPoint = { lat: number; lon: number; heading_deg: number | null; t_ms: number };

/** A fix less accurate than this is not part of the walk. */
export const MAX_WALK_ACCURACY_M = 30;
/** The volunteer must have moved at least this far (or half the fix's accuracy). */
export const MIN_WALK_STEP_M = 4;
/** The walk must end this near the new place (saved where the volunteer stops). */
export const WALK_END_M = 40;

/** The walk with this fix added, or unchanged when the fix is too rough or adds no real movement. */
export function addWalkFix(walk: WalkPoint[], fix: WalkPoint, accuracyM: number): WalkPoint[] {
  if (!Number.isFinite(accuracyM) || accuracyM > MAX_WALK_ACCURACY_M) return walk;
  if (walk.length === 0) return [fix];
  const last = walk[walk.length - 1];
  const moved = haversineM(last.lat, last.lon, fix.lat, fix.lon);
  return moved >= Math.max(MIN_WALK_STEP_M, accuracyM / 2) ? [...walk, fix] : walk;
}

/**
 * Does the walk start at the chosen start place and end at the new place?
 * "start" / "end" names the end that is too far; null when both are fine.
 */
export function walkEndsProblem(
  walk: WalkPoint[],
  start: { code: string; lat: number; lon: number },
  end: { lat: number; lon: number }
): "start" | "end" | null {
  if (walk.length === 0) return null;
  const first = walk[0];
  const last = walk[walk.length - 1];
  if (haversineM(first.lat, first.lon, start.lat, start.lon) > Math.max(WALK_END_M, osmConfirmRadiusM(start.code))) {
    return "start";
  }
  if (haversineM(last.lat, last.lon, end.lat, end.lon) > WALK_END_M) return "end";
  return null;
}
