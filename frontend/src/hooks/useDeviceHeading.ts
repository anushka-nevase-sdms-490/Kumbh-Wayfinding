import { useEffect, useState } from "react";

/** Device heading from browser sensors (gyro / compass). Degrees from north. */
export function useDeviceHeading() {
  const [heading, setHeading] = useState(0);
  const [live, setLive] = useState(false);
  const [note, setNote] = useState("Waiting for sensors");

  useEffect(() => {
    let gyroHeading = 0;
    let lastTs: number | null = null;

    const onOrientation = (e: DeviceOrientationEvent) => {
      const abs = (e as DeviceOrientationEvent & { webkitCompassHeading?: number })
        .webkitCompassHeading;
      if (typeof abs === "number") {
        setHeading(abs);
        setLive(true);
        setNote("Compass heading");
        return;
      }
      if (e.absolute && typeof e.alpha === "number") {
        setHeading((360 - e.alpha) % 360);
        setLive(true);
        setNote("Device orientation");
      }
    };

    const onMotion = (e: DeviceMotionEvent) => {
      const rot = e.rotationRate;
      if (!rot || rot.alpha == null) return;
      const now = performance.now();
      if (lastTs != null) {
        const dt = (now - lastTs) / 1000;
        // alpha ≈ yaw rate deg/s on many phones
        gyroHeading = (gyroHeading - rot.alpha * dt + 360) % 360;
        setHeading(gyroHeading);
        setLive(true);
        setNote("Gyroscope tracking");
      }
      lastTs = now;
    };

    window.addEventListener("deviceorientation", onOrientation);
    window.addEventListener("devicemotion", onMotion);

    return () => {
      window.removeEventListener("deviceorientation", onOrientation);
      window.removeEventListener("devicemotion", onMotion);
    };
  }, []);

  async function requestPermission() {
    const DOE = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<PermissionState>;
    };
    const DME = DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<PermissionState>;
    };
    try {
      if (typeof DOE.requestPermission === "function") {
        await DOE.requestPermission();
      }
      if (typeof DME.requestPermission === "function") {
        await DME.requestPermission();
      }
      setNote("Sensors enabled");
    } catch {
      setNote("Sensor permission denied — use Turn buttons");
    }
  }

  function nudge(delta: number) {
    setHeading((h) => (h + delta + 360) % 360);
    setNote("Manual heading");
  }

  return { heading, live, note, requestPermission, nudge, setHeading };
}
