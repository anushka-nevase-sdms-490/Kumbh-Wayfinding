import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Device heading (degrees clockwise from north).
 *
 * Sensor fusion (what your TL expects):
 * - Gyroscope → fast, responsive turn tracking (high frequency)
 * - Compass / absolute orientation → absolute north (corrects gyro drift)
 *
 * Indoor magnetometer noise is filtered; gyro is never dropped.
 */

type Source = "none" | "manual" | "gyro" | "relative" | "absolute";

const RANK: Record<Source, number> = {
  none: 0,
  manual: 1,
  gyro: 2,
  relative: 3,
  absolute: 4,
};

const LABEL: Record<Source, string> = {
  none: "Waiting for sensors",
  manual: "Manual heading",
  gyro: "Gyroscope + compass",
  relative: "Device orientation",
  absolute: "Compass + gyroscope",
};

const INSECURE_NOTE = "Needs https for sensors — use Turn buttons";
const NO_SENSOR_NOTE = "No compass/gyro on this device — use Turn buttons";

/** How strongly compass corrects gyro (0 = gyro only, 1 = compass only). */
const COMPASS_BLEND = 0.04;
const PUBLISH_MS = 100;
const DEADZONE_DEG = 2.5;

function screenAngle(): number {
  const angle = window.screen?.orientation?.angle;
  if (typeof angle === "number") return angle;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === "number" ? legacy : 0;
}

function norm360(deg: number) {
  return ((deg % 360) + 360) % 360;
}

function shortestDelta(from: number, to: number) {
  return ((to - from + 540) % 360) - 180;
}

export function useDeviceHeading() {
  const secure = typeof window !== "undefined" && window.isSecureContext;

  const [heading, setHeading] = useState(0);
  const [source, setSource] = useState<Source>("none");
  const [note, setNote] = useState(secure ? LABEL.none : INSECURE_NOTE);

  const sourceRef = useRef<Source>("none");
  const fusedRef = useRef(0);
  const publishedRef = useRef(0);
  const lastPublishRef = useRef(0);
  const lastGyroTs = useRef<number | null>(null);
  const lastCompassRef = useRef<number | null>(null);
  const manualUntilRef = useRef(0);

  const publishUi = useCallback((deg: number, next: Source) => {
    const now = performance.now();
    if (now - lastPublishRef.current < PUBLISH_MS) return;
    if (Math.abs(shortestDelta(publishedRef.current, deg)) < DEADZONE_DEG) return;

    lastPublishRef.current = now;
    publishedRef.current = deg;
    if (RANK[next] >= RANK[sourceRef.current]) sourceRef.current = next;
    setSource(sourceRef.current);
    setNote(LABEL[sourceRef.current] === LABEL.gyro ? LABEL.gyro : LABEL[sourceRef.current]);
    // Prefer a combined label when both are active.
    if (lastCompassRef.current != null && sourceRef.current === "gyro") {
      setNote("Gyroscope + compass");
    } else if (sourceRef.current === "absolute") {
      setNote("Compass + gyroscope");
    }
    setHeading(deg);
  }, []);

  useEffect(() => {
    if (!secure) return;

    const onOrientation = (e: DeviceOrientationEvent) => {
      if (performance.now() < manualUntilRef.current) return;

      const compass = (
        e as DeviceOrientationEvent & { webkitCompassHeading?: number }
      ).webkitCompassHeading;

      let compassDeg: number | null = null;
      if (typeof compass === "number" && !Number.isNaN(compass)) {
        compassDeg = norm360(compass);
      } else if (typeof e.alpha === "number" && !Number.isNaN(e.alpha)) {
        const absolute =
          e.absolute === true || e.type === "deviceorientationabsolute";
        // Only trust absolute / iOS compass for north; relative alpha is OK to
        // seed fusion until gyro+compass lock.
        compassDeg = norm360(360 - e.alpha + screenAngle());
        if (!absolute && lastCompassRef.current == null) {
          // Seed fused heading once so gyro has a starting point.
          fusedRef.current = compassDeg;
          publishUi(compassDeg, "relative");
          return;
        }
        if (!absolute) return;
      }

      if (compassDeg == null) return;

      lastCompassRef.current = compassDeg;
      // Complementary filter: pull fused heading gently toward compass north.
      const delta = shortestDelta(fusedRef.current, compassDeg);
      fusedRef.current = norm360(fusedRef.current + delta * COMPASS_BLEND);
      publishUi(fusedRef.current, "absolute");
    };

    const onMotion = (e: DeviceMotionEvent) => {
      if (performance.now() < manualUntilRef.current) return;

      const rot = e.rotationRate;
      if (!rot || rot.alpha == null) return;

      const now = performance.now();
      if (lastGyroTs.current != null) {
        const dt = Math.min((now - lastGyroTs.current) / 1000, 0.08);
        // rotationRate.alpha: deg/s around Z; subtract so turn-right increases heading.
        fusedRef.current = norm360(fusedRef.current - rot.alpha * dt);
        publishUi(fusedRef.current, "gyro");
      }
      lastGyroTs.current = now;
    };

    window.addEventListener("deviceorientationabsolute", onOrientation, true);
    window.addEventListener("deviceorientation", onOrientation, true);
    window.addEventListener("devicemotion", onMotion, true);

    const idle = window.setTimeout(() => {
      if (sourceRef.current === "none") setNote(NO_SENSOR_NOTE);
    }, 3000);

    return () => {
      window.removeEventListener(
        "deviceorientationabsolute",
        onOrientation,
        true
      );
      window.removeEventListener("deviceorientation", onOrientation, true);
      window.removeEventListener("devicemotion", onMotion, true);
      window.clearTimeout(idle);
    };
  }, [secure, publishUi]);

  const requestPermission = useCallback(async () => {
    if (!secure) {
      setNote(INSECURE_NOTE);
      return;
    }
    const DOE = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<PermissionState>;
    };
    const DME = DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<PermissionState>;
    };
    try {
      if (typeof DOE.requestPermission === "function") {
        const granted = await DOE.requestPermission();
        if (granted !== "granted") {
          setNote("Sensor permission denied — use Turn buttons");
          return;
        }
      }
      if (typeof DME.requestPermission === "function") {
        await DME.requestPermission();
      }
    } catch {
      setNote("Sensor permission denied — use Turn buttons");
    }
  }, [secure]);

  const nudge = useCallback((delta: number) => {
    manualUntilRef.current = performance.now() + 2000;
    sourceRef.current = "manual";
    fusedRef.current = norm360(fusedRef.current + delta);
    publishedRef.current = fusedRef.current;
    setSource("manual");
    setNote(LABEL.manual);
    setHeading(fusedRef.current);
  }, []);

  return {
    heading,
    live: RANK[source] > RANK.manual,
    secure,
    note,
    requestPermission,
    nudge,
    setHeading,
  };
}
