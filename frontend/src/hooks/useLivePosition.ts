import { useEffect, useState } from "react";

export type LivePos = {
  lat: number;
  lon: number;
  accuracyM: number;
  updatedAt: number;
};

/**
 * Live GPS while navigating — bearing must come from where the phone is now,
 * not only from the last scanned board (which points through walls/glass).
 */
export function useLivePosition(active: boolean): {
  pos: LivePos | null;
  note: string;
} {
  const [pos, setPos] = useState<LivePos | null>(null);
  const [note, setNote] = useState("Waiting for GPS…");

  useEffect(() => {
    if (!active) {
      setPos(null);
      setNote("");
      return;
    }
    if (!navigator.geolocation) {
      setNote("No GPS — direction uses last scanned board");
      return;
    }

    setNote("Getting GPS…");
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setPos({
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracyM: p.coords.accuracy ?? 30,
          updatedAt: Date.now(),
        });
        setNote(
          p.coords.accuracy && p.coords.accuracy > 40
            ? `GPS ±${Math.round(p.coords.accuracy)} m (move outdoors if wrong)`
            : "Live GPS"
        );
      },
      () => {
        setNote("GPS unavailable — direction uses last scanned board");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 20000,
      }
    );

    return () => {
      navigator.geolocation.clearWatch(id);
    };
  }, [active]);

  return { pos, note };
}
