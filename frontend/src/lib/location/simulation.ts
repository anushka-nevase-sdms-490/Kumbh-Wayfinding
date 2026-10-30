/**
 * Development-only location provider: a simulated visitor walking the real
 * route in Nashik, one position report per second like a phone's GPS. Its
 * reports go through the same GPS filter, route progress, arrival and
 * reroute logic as real ones. It never touches navigator.geolocation.
 */
import type { Fix, LocationProvider } from "./types";
import {
  backOnRoute,
  followNewPath,
  goOffRoute,
  initialSimState,
  pointAlong,
  startWalk,
  stepSim,
  type LonLat,
  type SimState,
} from "./simulationWalk";

const TICK_MS = 1000;

export class SimulationLocationProvider implements LocationProvider {
  readonly kind = "simulation" as const;
  private state: SimState;
  private lastFix: Fix | null = null;
  private readonly watchers = new Set<(fix: Fix) => void>();
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(start: { lat: number; lon: number }) {
    this.state = initialSimState(start);
  }

  available(): boolean {
    return true;
  }

  watch(onFix: (fix: Fix) => void): () => void {
    this.watchers.add(onFix);
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    // A first report straight away, like a phone that already has a fix.
    queueMicrotask(() => this.report(onFix));
    return () => {
      this.watchers.delete(onFix);
      if (this.watchers.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  /** For the panel (useSyncExternalStore). */
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getState = (): SimState => this.state;
  getLastFix = (): Fix | null => this.lastFix;

  private set(next: SimState) {
    this.state = next;
    this.listeners.forEach((cb) => cb());
  }

  private report(onFix?: (fix: Fix) => void) {
    const { state, fix } = stepSim(this.state, 0);
    this.set(state);
    if (!fix) return;
    this.lastFix = { ...fix, timestamp: Date.now() };
    if (onFix) onFix(this.lastFix);
    else this.watchers.forEach((w) => w(this.lastFix!));
  }

  private tick() {
    const { state, fix } = stepSim(this.state, TICK_MS / 1000);
    this.set(state);
    if (!fix) return;
    this.lastFix = { ...fix, timestamp: Date.now() };
    this.watchers.forEach((w) => w(this.lastFix!));
  }

  // ── Controls ──
  placeAt(lat: number, lon: number) {
    this.set({ ...this.state, pos: { lat, lon }, path: [], along: 0, playing: false, arrived: false, offRoute: null });
    this.report();
  }
  walk(route: LonLat[]) {
    this.set(startWalk(this.state, route));
    this.report();
  }
  /** The app's route changed (reroute / next place): keep walking along the new one. */
  followRoute(route: LonLat[]) {
    if (this.state.path.length === 0 && !this.state.playing) {
      this.set({ ...this.state, route });
      return;
    }
    this.set(followNewPath(this.state, route));
  }
  play() {
    this.set({ ...this.state, playing: !this.state.arrived });
  }
  pause() {
    this.set({ ...this.state, playing: false });
  }
  /** Back to the start of the route, standing. */
  reset() {
    const r = this.state.route;
    const start = r.length ? pointAlong(r, 0) : this.state.pos;
    this.set({ ...this.state, path: [], along: 0, pos: start, playing: false, arrived: false, offRoute: null, lost: false });
    this.report();
  }
  setSpeed(x: number) {
    this.set({ ...this.state, speedX: x });
  }
  setAccuracy(m: number) {
    this.set({ ...this.state, accuracyM: m });
  }
  setNoise(on: boolean) {
    this.set({ ...this.state, noise: on });
  }
  jump() {
    this.set({ ...this.state, jumpPending: true });
  }
  setOffRoute(on: boolean) {
    this.set(on ? goOffRoute(this.state) : backOnRoute(this.state));
  }
  setLost(on: boolean) {
    this.set({ ...this.state, lost: on });
  }
  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.watchers.clear();
  }
}
