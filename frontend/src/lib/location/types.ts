/** One position report, from the real GPS or from the simulation. */
export type Fix = { lat: number; lon: number; accuracyM: number; timestamp: number };

/**
 * Where positions come from. The app reads the phone's GPS through
 * RealGPSProvider; the development-only simulation (simulation.ts) is a
 * separate provider and never touches navigator.geolocation.
 */
export interface LocationProvider {
  readonly kind: "real" | "simulation";
  /** Whether this provider can give positions at all on this device. */
  available(): boolean;
  /** Start reporting; returns a function that stops. */
  watch(onFix: (fix: Fix) => void, onError: () => void): () => void;
}
