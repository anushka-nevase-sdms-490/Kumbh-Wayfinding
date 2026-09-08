import { useEffect, useState } from "react";
import { phoneAppBase, phoneAppBaseSync } from "../lib/network";

/** LAN HTTPS origin for QRs that phones can open (not localhost). */
export function usePhoneAppBase(): string {
  const [base, setBase] = useState(phoneAppBaseSync);

  useEffect(() => {
    let cancelled = false;
    void phoneAppBase().then((url) => {
      if (!cancelled) setBase(url);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return base;
}
