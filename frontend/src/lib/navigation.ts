/**
 * Offline navigation state machine for GPS map wayfinding.
 *
 * IDLE → ROUTING → NAVIGATING ⇄ REROUTING → ARRIVED | NO_ROUTE
 */

export type NavState =
  | "IDLE"
  | "ROUTING"
  | "NAVIGATING"
  | "REROUTING"
  | "ARRIVED"
  | "NO_ROUTE";

/** GPS is ±5–20 m outdoors, so "arrived" means within about 20 m. */
export const DEFAULT_DESTINATION_RADIUS_M = 20;

export type ArrivalCheck = {
  arrived: boolean;
  reason?: "proximity" | "same_board";
};

/**
 * Arrival only if:
 * - the start place is the destination, OR
 * - on final navigable leg AND GPS within radius AND destination still graph-reachable
 *   from the current place (prevents “through the wall” false arrival).
 */
export function evaluateArrival(args: {
  startCode: string | null | undefined;
  destCode: string | null | undefined;
  onFinalLeg: boolean;
  destReachable: boolean;
  distanceToDestM: number | null;
  destinationRadiusM?: number;
  gpsAccuracyM?: number | null;
  maxAccuracyM?: number;
}): ArrivalCheck {
  const {
    startCode,
    destCode,
    onFinalLeg,
    destReachable,
    distanceToDestM,
    destinationRadiusM = DEFAULT_DESTINATION_RADIUS_M,
    gpsAccuracyM = null,
    maxAccuracyM = 25,
  } = args;

  if (!startCode || !destCode) return { arrived: false };
  if (startCode.toUpperCase() === destCode.toUpperCase()) {
    return { arrived: true, reason: "same_board" };
  }
  if (!onFinalLeg || !destReachable) return { arrived: false };
  if (distanceToDestM == null) return { arrived: false };
  if (gpsAccuracyM != null && gpsAccuracyM > maxAccuracyM) {
    return { arrived: false };
  }
  if (distanceToDestM <= destinationRadiusM) {
    return { arrived: true, reason: "proximity" };
  }
  return { arrived: false };
}

export function nextNavState(
  current: NavState,
  event:
    | "START_ROUTE"
    | "ROUTE_OK"
    | "ROUTE_FAIL"
    | "OBSTACLE"
    | "REROUTE_OK"
    | "REROUTE_FAIL"
    | "ARRIVE"
    | "RESET"
): NavState {
  switch (event) {
    case "RESET":
      return "IDLE";
    case "START_ROUTE":
      return "ROUTING";
    case "ROUTE_OK":
      // NO_ROUTE recovers too: a pack reload can reopen a blocked lane.
      return current === "REROUTING" ||
        current === "ROUTING" ||
        current === "NO_ROUTE"
        ? "NAVIGATING"
        : current;
    case "ROUTE_FAIL":
      return "NO_ROUTE";
    case "OBSTACLE":
      return current === "NAVIGATING" || current === "REROUTING"
        ? "REROUTING"
        : current;
    case "REROUTE_OK":
      return "NAVIGATING";
    case "REROUTE_FAIL":
      return "NO_ROUTE";
    case "ARRIVE":
      return "ARRIVED";
    default:
      return current;
  }
}
