/**
 * The volunteer screens' GPS. Normally this is navigator.geolocation; while
 * the development simulation runs, positions come from it instead. The phone's
 * own geolocation is never patched or overwritten. In a production build
 * nothing ever calls setSimulatedPositions, so this is always the real GPS.
 */
import type { Fix, LocationProvider } from "./types";

let simulated: LocationProvider | null = null;

export function setSimulatedPositions(p: LocationProvider | null): void {
  simulated = p;
}

/** Positions are simulated: saved data must say so (the server keeps it unverified). */
export function positionsSimulated(): boolean {
  return simulated !== null;
}

function asPosition(f: Fix): GeolocationPosition {
  const coords = {
    latitude: f.lat,
    longitude: f.lon,
    accuracy: f.accuracyM,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
  };
  return { coords: { ...coords, toJSON: () => coords }, timestamp: f.timestamp, toJSON: () => ({ coords }) } as GeolocationPosition;
}

function timeoutError(): GeolocationPositionError {
  return { code: 3, message: "No simulated position (signal lost)", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };
}

const stops = new Map<number, () => void>();
let nextId = 1;

export const volunteerGeo = {
  available(): boolean {
    return simulated !== null || (typeof navigator !== "undefined" && !!navigator.geolocation);
  },
  getCurrentPosition(ok: PositionCallback, err?: PositionErrorCallback, opts?: PositionOptions): void {
    const sim = simulated;
    if (!sim) return navigator.geolocation.getCurrentPosition(ok, err, opts);
    let done = false;
    const stop = sim.watch((f) => {
      if (done) return;
      done = true;
      queueMicrotask(stop);
      ok(asPosition(f));
    }, () => {});
    setTimeout(() => {
      if (done) return;
      done = true;
      stop();
      err?.(timeoutError());
    }, opts?.timeout ?? 20000);
  },
  /** Ids of simulated watches are negative, so clearWatch knows which to stop. */
  watchPosition(ok: PositionCallback, err?: PositionErrorCallback, opts?: PositionOptions): number {
    const sim = simulated;
    if (!sim) return navigator.geolocation.watchPosition(ok, err, opts);
    const id = nextId++;
    stops.set(id, sim.watch((f) => ok(asPosition(f)), () => {}));
    return -id;
  },
  clearWatch(id: number): void {
    if (id < 0) {
      stops.get(-id)?.();
      stops.delete(-id);
    } else {
      navigator.geolocation.clearWatch(id);
    }
  },
};
