/**
 * Offline navigation state machine for QR-board wayfinding.
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

export const DEFAULT_DESTINATION_RADIUS_M = 2;

export type ArrivalCheck = {
  arrived: boolean;
  reason?: "scanned" | "proximity" | "same_board";
};

/**
 * Arrival only if:
 * - scanned destination board, OR
 * - on final navigable leg AND GPS within radius AND destination still graph-reachable
 *   from the last scanned board (prevents “through the wall” false arrival).
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
    maxAccuracyM = 20,
  } = args;

  if (!startCode || !destCode) return { arrived: false };
  if (startCode.toUpperCase() === destCode.toUpperCase()) {
    return { arrived: true, reason: "scanned" };
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
      return current === "REROUTING" || current === "ROUTING"
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
