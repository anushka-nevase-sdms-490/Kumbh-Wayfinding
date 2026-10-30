import { useEffect, useRef, useState } from "react";
import { INITIAL_GPS_FILTER, filterFix, type GpsFilterState } from "../lib/gpsFilter";
import { RealGPSProvider } from "../lib/location/realGps";
import type { LocationProvider } from "../lib/location/types";

export type LivePos = {
  lat: number;
  lon: number;
  accuracyM: number;
  updatedAt: number;
  /** True only when accuracy is good enough to navigate by. */
  usable: boolean;
};

const MAX_USEFUL_ACCURACY_M = 28;
/**
 * No report for this long: tell the visitor the signal may be lost (under
 * tents, between buildings). Long, because some phones (likely iOS) send few
 * or no reports while standing still.
 */
export const GPS_LOST_AFTER_MS = 30_000;

/** GPS status line, as a message key (worded in the visitor's language). */
export type GpsNote = {
  key:
    | "gps.waiting"
    | "gps.none"
    | "gps.getting"
    | "gps.jump"
    | "gps.weak"
    | "gps.live"
    | "gps.noisy"
    | "gps.unavailable"
    | "gps.lost";
  acc?: number;
};

/**
 * Live GPS for the start screen and while navigating, from the real GPS or the
 * development simulation. Filters noisy fixes, and says when reports stop.
 */
export function useLivePosition(
  active: boolean,
  provider: LocationProvider = RealGPSProvider
): {
  pos: LivePos | null;
  note: GpsNote | null;
} {
  const [pos, setPos] = useState<LivePos | null>(null);
  const [note, setNote] = useState<GpsNote | null>({ key: "gps.waiting" });
  const filterRef = useRef<GpsFilterState>(INITIAL_GPS_FILTER);

  useEffect(() => {
    // A new source (real GPS ↔ simulation) starts from scratch.
    filterRef.current = INITIAL_GPS_FILTER;
    setPos(null);
    if (!active) {
      setNote(null);
      return;
    }
    if (!provider.available()) {
      setNote({ key: "gps.none" });
      return;
    }

    setNote({ key: "gps.getting" });
    let lastFixAt = 0;
    const lostTimer = setInterval(() => {
      // Only a note: the last position stays in use (a phone standing still
      // may simply not report), and the next report clears it.
      if (lastFixAt && Date.now() - lastFixAt > GPS_LOST_AFTER_MS) {
        setNote({ key: "gps.lost" });
      }
    }, 2000);
    const stop = provider.watch(
      ({ lat: rawLat, lon: rawLon, accuracyM }) => {
        lastFixAt = Date.now();
        const result = filterFix(filterRef.current, {
          lat: rawLat,
          lon: rawLon,
          accuracyM,
        });
        filterRef.current = result.state;
        if (result.kind === "jump_rejected" || !result.pos) {
          setNote({ key: "gps.jump", acc: Math.round(accuracyM) });
          return;
        }
        if (result.kind === "weak_seed" || result.kind === "unseeded") {
          // Shown (the start screen says "GPS weak") but not trusted yet.
          setPos({
            lat: rawLat,
            lon: rawLon,
            accuracyM,
            updatedAt: Date.now(),
            usable: false,
          });
          setNote({ key: "gps.weak", acc: Math.round(accuracyM) });
          return;
        }
        const next = result.pos;

        const usable = accuracyM <= MAX_USEFUL_ACCURACY_M;
        setPos({
          lat: next.lat,
          lon: next.lon,
          accuracyM,
          updatedAt: Date.now(),
          usable,
        });
        setNote({ key: usable ? "gps.live" : "gps.noisy", acc: Math.round(accuracyM) });
      },
      () => {
        setNote({ key: "gps.unavailable" });
      }
    );
    return () => {
      clearInterval(lostTimer);
      stop();
    };
  }, [active, provider]);

  return { pos, note };
}
