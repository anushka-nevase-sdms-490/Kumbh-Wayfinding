import { useEffect, useRef, useState } from "react";

/** Smooth a 0–360° angle without spinning the long way on wrap. */
export function useSmoothedBearing(targetDeg: number, active: boolean): number {
  const [smooth, setSmooth] = useState(() => ((targetDeg % 360) + 360) % 360);
  const valueRef = useRef(smooth);
  const targetRef = useRef(targetDeg);

  targetRef.current = ((targetDeg % 360) + 360) % 360;

  useEffect(() => {
    if (!active) {
      valueRef.current = targetRef.current;
      setSmooth(targetRef.current);
      return;
    }

    let raf = 0;
    const tick = () => {
      const prev = valueRef.current;
      const target = targetRef.current;
      let delta = ((target - prev + 540) % 360) - 180;
      if (Math.abs(delta) > 50) delta *= 0.12;
      else delta *= 0.16;
      const next = (prev + delta + 360) % 360;
      valueRef.current = next;
      setSmooth(next);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return smooth;
}
