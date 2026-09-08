import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Device heading from browser sensors (compass / orientation / gyro).
 * Degrees clockwise from north.
 *
 * Browsers only deliver motion sensors to a *secure context* (https, or
 * localhost). Over plain http on a LAN IP the listeners attach fine and then
 * never fire — so we detect that up front instead of sitting silently at 0.
 */

type Source = "none" | "manual" | "gyro" | "relative" | "absolute";

/** Higher wins: a coarse source must never clobber a better one. */
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
  gyro: "Gyroscope tracking",
  relative: "Device orientation",
  absolute: "Compass heading",
};

const INSECURE_NOTE = "Needs https for sensors — use Turn buttons";
const NO_SENSOR_NOTE = "No compass on this device — use Turn buttons";

/** Screen rotation, so the arrow stays right when the phone is in landscape. */
function screenAngle(): number {
  const angle = window.screen?.orientation?.angle;
  if (typeof angle === "number") return angle;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === "number" ? legacy : 0;
}

export function useDeviceHeading() {
  const secure = typeof window !== "undefined" && window.isSecureContext;

  const [heading, setHeading] = useState(0);
  const [source, setSource] = useState<Source>("none");
  const [note, setNote] = useState(secure ? LABEL.none : INSECURE_NOTE);

  // Read inside event handlers without re-subscribing on every update.
  const sourceRef = useRef<Source>("none");
  const headingRef = useRef(0);
  const lastPublishRef = useRef(0);

  const publish = useCallback((deg: number, next: Source) => {
    if (RANK[next] < RANK[sourceRef.current]) return;
    const incoming = ((deg % 360) + 360) % 360;
    const prev = headingRef.current;
    let delta = incoming - prev;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    let smoothed = incoming;
    if (RANK[sourceRef.current] >= RANK.relative) {
      if (Math.abs(delta) > 55) {
        smoothed = (prev + Math.sign(delta) * 6 + 360) % 360;
      } else {
        smoothed = (prev + delta * 0.18 + 360) % 360;
      }
    }
    headingRef.current = smoothed;
    sourceRef.current = next;

    const now = performance.now();
    if (now - lastPublishRef.current < 90) return;
    lastPublishRef.current = now;
    setSource(next);
    setNote(LABEL[next]);
    setHeading(smoothed);
  }, []);

  useEffect(() => {
    if (!secure) return;

    let gyroHeading = 0;
    let lastTs: number | null = null;

    const onOrientation = (e: DeviceOrientationEvent) => {
      // iOS gives a true compass bearing directly.
      const compass = (
        e as DeviceOrientationEvent & { webkitCompassHeading?: number }
      ).webkitCompassHeading;
      if (typeof compass === "number" && !Number.isNaN(compass)) {
        publish(compass, "absolute");
        return;
      }

      if (typeof e.alpha !== "number" || Number.isNaN(e.alpha)) return;

      // alpha counts anticlockwise from north; a heading counts clockwise.
      const deg = 360 - e.alpha + screenAngle();

      // Plenty of Android phones report absolute:false on `deviceorientation`
      // but still track rotation usefully — accept it as a lower-ranked source
      // rather than ignoring it, which is what froze the arrow before.
      publish(deg, e.absolute || e.type === "deviceorientationabsolute" ? "absolute" : "relative");
    };

    const onMotion = (e: DeviceMotionEvent) => {
      // Last resort: integrate yaw rate. Responds to turning, but drifts and
      // is not north-referenced, so it stays below the orientation sources.
      const rot = e.rotationRate;
      if (!rot || rot.alpha == null) return;
      const now = performance.now();
      if (lastTs != null) {
        const dt = Math.min((now - lastTs) / 1000, 0.5);
        gyroHeading = gyroHeading - rot.alpha * dt;
        publish(gyroHeading, "gyro");
      }
      lastTs = now;
    };

    window.addEventListener("deviceorientationabsolute", onOrientation);
    window.addEventListener("deviceorientation", onOrientation);
    window.addEventListener("devicemotion", onMotion);

    // Nothing at all after a moment means the device has no usable sensors —
    // say so instead of leaving "Waiting for sensors" up forever.
    const idle = window.setTimeout(() => {
      if (sourceRef.current === "none") setNote(NO_SENSOR_NOTE);
    }, 2500);

    return () => {
      window.removeEventListener("deviceorientationabsolute", onOrientation);
      window.removeEventListener("deviceorientation", onOrientation);
      window.removeEventListener("devicemotion", onMotion);
      window.clearTimeout(idle);
    };
  }, [secure, publish]);

  /** iOS 13+ needs an explicit grant, triggered from a user gesture. */
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
    // Android has no such API — permission is implicit, so don't claim
    // anything happened; the listeners above will report the real state.
    if (typeof DOE.requestPermission !== "function") return;
    try {
      const granted = await DOE.requestPermission();
      if (typeof DME.requestPermission === "function") {
        await DME.requestPermission();
      }
      if (granted !== "granted") {
        setNote("Sensor permission denied — use Turn buttons");
      }
    } catch {
      setNote("Sensor permission denied — use Turn buttons");
    }
  }, [secure]);

  /** Turn left / Turn right buttons. */
  const nudge = useCallback((delta: number) => {
    // A live sensor would overwrite this on its next event, so only let the
    // buttons drive the arrow while nothing better is running.
    if (RANK[sourceRef.current] > RANK.manual) return;
    sourceRef.current = "manual";
    headingRef.current = (headingRef.current + delta + 360) % 360;
    setSource("manual");
    setNote((n) => (n === INSECURE_NOTE || n === NO_SENSOR_NOTE ? n : LABEL.manual));
    setHeading(headingRef.current);
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
