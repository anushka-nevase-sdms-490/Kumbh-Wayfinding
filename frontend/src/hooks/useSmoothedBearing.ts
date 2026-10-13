import { useEffect, useRef, useState } from "react";

function norm360(deg: number) {
  return ((deg % 360) + 360) % 360;
}

function shortestDelta(from: number, to: number) {
  return ((to - from + 540) % 360) - 180;
}

/**
 * Snap + heavy smooth for the AR arrow.
 * Display updates in ~15° steps so small compass noise does not shake the arrow.
 */
export function useSmoothedBearing(targetDeg: number, active: boolean): number {
  const snap = (deg: number) => Math.round(norm360(deg) / 15) * 15 % 360;
  const [smooth, setSmooth] = useState(() => snap(targetDeg));
  const displayRef = useRef(smooth);
  const targetRef = useRef(snap(targetDeg));

  useEffect(() => {
    targetRef.current = snap(targetDeg);
  }, [targetDeg]);

  useEffect(() => {
    if (!active) {
      displayRef.current = targetRef.current;
      setSmooth(targetRef.current);
      return;
    }

    let raf = 0;
    let lastUi = 0;

    const tick = (now: number) => {
      const prev = displayRef.current;
      const target = targetRef.current;
      const delta = shortestDelta(prev, target);

      // Hold still unless the snapped target moved enough (hysteresis).
      if (Math.abs(delta) < 12) {
        raf = requestAnimationFrame(tick);
        return;
      }

      const next = norm360(prev + delta * 0.12);
      displayRef.current = next;

      if (now - lastUi > 50) {
        lastUi = now;
        // Round for React so we don't re-render on tiny floats.
        const rounded = Math.round(next);
        setSmooth((s) => (s === rounded ? s : rounded));
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return smooth;
}
