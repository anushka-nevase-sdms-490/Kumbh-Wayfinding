import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { normalizeCode } from "../lib/types";
import "./QrScanner.css";

type Props = {
  onScan: (code: string) => void;
  onClose: () => void;
  demoCodes?: { code: string; name: string }[];
  title?: string;
  helpText?: string;
  /** Unique DOM id when multiple scanners exist in the app. */
  readerId?: string;
  placeholder?: string;
};

export function QrScanner({
  onScan,
  onClose,
  demoCodes = [],
  title = "Scan QR board",
  helpText = "Allow camera when Chrome asks. Point at a Routefinding QR.",
  readerId = "routefinding-qr-reader",
  placeholder = "e.g. KUMBH-A01",
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [manual, setManual] = useState("");
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    let cancelled = false;
    let scanner: Html5Qrcode | null = null;

    const boot = window.setTimeout(async () => {
      const el = document.getElementById(readerId);
      if (!el) {
        setError("Scanner box missing. Use a board button below.");
        return;
      }

      try {
        scanner = new Html5Qrcode(readerId);
        scannerRef.current = scanner;

        const onDecoded = (decoded: string) => {
          if (cancelled) return;
          cancelled = true;
          const code = normalizeCode(decoded);
          scanner
            ?.stop()
            .catch(() => undefined)
            .finally(() => onScanRef.current(code));
        };

        try {
          await scanner.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 240, height: 240 } },
            onDecoded,
            () => undefined
          );
        } catch {
          await scanner.start(
            { facingMode: "user" },
            { fps: 10, qrbox: { width: 240, height: 240 } },
            onDecoded,
            () => undefined
          );
        }

        if (!cancelled) {
          setCameraReady(true);
          setError(null);
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        const denied =
          /NotAllowed|Permission|denied|NotFound|secure/i.test(msg) ||
          msg.toLowerCase().includes("camera");
        setCameraReady(false);
        setError(
          denied
            ? "Camera is blocked. Allow camera in the browser, then retry. Or type a code below."
            : `Camera failed (${msg}). Use a board button / type a code below.`
        );
      }
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(boot);
      const s = scannerRef.current;
      scannerRef.current = null;
      if (s) {
        s.stop()
          .then(() => s.clear())
          .catch(() => undefined);
      }
    };
  }, [readerId]);

  function submitManual() {
    const code = normalizeCode(manual);
    if (!code) return;
    onScan(code);
  }

  return (
    <div className="qr-overlay" role="dialog" aria-label={title}>
      <div className="qr-sheet">
        <div className="qr-top">
          <h2>{title}</h2>
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <p className="qr-help">{helpText}</p>

        <div id={readerId} className="qr-box" />

        {cameraReady ? (
          <p className="qr-status ok">Camera on — point at a QR code</p>
        ) : (
          <p className="qr-status">{error ?? "Starting camera…"}</p>
        )}

        {error && (
          <button type="button" className="btn-retry" onClick={onClose}>
            Close and allow camera, then scan again
          </button>
        )}

        {demoCodes.length > 0 && (
          <>
            <p className="qr-demo-label">Or tap a code</p>
            <div className="qr-demo-grid">
              {demoCodes.map((d) => (
                <button
                  key={d.code}
                  type="button"
                  className="qr-demo-btn"
                  onClick={() => onScan(d.code)}
                >
                  <strong>{d.name}</strong>
                  <span>{d.code}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <p className="qr-demo-label">Or type code</p>
        <div className="qr-manual">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder={placeholder}
            onKeyDown={(e) => e.key === "Enter" && submitManual()}
          />
          <button type="button" className="ghost" onClick={submitManual}>
            Go
          </button>
        </div>
      </div>
    </div>
  );
}
