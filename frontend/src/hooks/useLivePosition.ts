import { useEffect, useRef, useState } from "react";

export type LivePos = {
  lat: number;
  lon: number;
  accuracyM: number;
  updatedAt: number;
  /** True only when accuracy is good enough to steer the arrow. */
  usable: boolean;
};

const MAX_USEFUL_ACCURACY_M = 28;
const MAX_JUMP_M = 35;

function haversineM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLon = toR(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Live GPS while navigating. Filters noisy indoor fixes so the arrow does not
 * spin and we never treat a bad jump as “arrived”.
 */
export function useLivePosition(active: boolean): {
  pos: LivePos | null;
  note: string;
} {
  const [pos, setPos] = useState<LivePos | null>(null);
  const [note, setNote] = useState("Waiting for GPS…");
  const smoothRef = useRef<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    if (!active) {
      setPos(null);
      setNote("");
      smoothRef.current = null;
      return;
    }
    if (!navigator.geolocation) {
      setNote("No GPS — direction uses last scanned board");
      return;
    }

    setNote("Getting GPS…");
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const accuracyM = p.coords.accuracy ?? 40;
        const rawLat = p.coords.latitude;
        const rawLon = p.coords.longitude;

        const prev = smoothRef.current;
        if (prev) {
          const jump = haversineM(prev.lat, prev.lon, rawLat, rawLon);
          // Ignore wild indoor GPS teleports.
          if (jump > MAX_JUMP_M && accuracyM > 15) {
            setNote(`GPS jump ignored (±${Math.round(accuracyM)} m)`);
            return;
          }
        }

        // EMA toward new fix; trust good accuracy more.
        const alpha = accuracyM <= 15 ? 0.45 : accuracyM <= 28 ? 0.25 : 0.12;
        const next = prev
          ? {
              lat: prev.lat + (rawLat - prev.lat) * alpha,
              lon: prev.lon + (rawLon - prev.lon) * alpha,
            }
          : { lat: rawLat, lon: rawLon };
        smoothRef.current = next;

        const usable = accuracyM <= MAX_USEFUL_ACCURACY_M;
        setPos({
          lat: next.lat,
          lon: next.lon,
          accuracyM,
          updatedAt: Date.now(),
          usable,
        });
        setNote(
          usable
            ? `Live GPS ±${Math.round(accuracyM)} m`
            : `GPS too noisy ±${Math.round(accuracyM)} m — using board`
        );
      },
      () => {
        setNote("GPS unavailable — direction uses last scanned board");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1500,
        timeout: 15000,
      }
    );

    return () => {
      navigator.geolocation.clearWatch(id);
    };
  }, [active]);

  return { pos, note };
}
