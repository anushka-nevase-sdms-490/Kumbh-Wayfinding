import type { Fix, LocationProvider } from "./types";

/** The phone's own GPS (navigator.geolocation), unchanged. */
export const RealGPSProvider: LocationProvider = {
  kind: "real",
  available: () => typeof navigator !== "undefined" && !!navigator.geolocation,
  watch(onFix, onError) {
    if (!this.available()) {
      onError();
      return () => undefined;
    }
    const id = navigator.geolocation.watchPosition(
      (p) =>
        onFix({
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracyM: p.coords.accuracy ?? 40,
          timestamp: p.timestamp || Date.now(),
        } satisfies Fix),
      () => onError(),
      { enableHighAccuracy: true, maximumAge: 1500, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  },
};
