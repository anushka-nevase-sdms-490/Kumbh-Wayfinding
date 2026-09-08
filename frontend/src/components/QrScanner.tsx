import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { normalizeCode } from "../lib/types";
import "./QrScanner.css";

type Props = {
  onScan: (code: string) => void;
  onClose: () => void;
  demoCodes?: { code: string; name: string }[];
};

const READER_ID = "routefinding-qr-reader";

export function QrScanner({ onScan, onClose, demoCodes = [] }: Props) {
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
      const el = document.getElementById(READER_ID);
      if (!el) {
        setError("Scanner box missing. Use a board button below.");
        return;
      }

      try {
        scanner = new Html5Qrcode(READER_ID);
        scannerRef.current = scanner;

        // Prefer back camera; fall back to any camera
        try {
          await scanner.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 240, height: 240 } },
            (decoded) => {
              if (cancelled) return;
              cancelled = true;
              const code = normalizeCode(decoded);
              scanner
                ?.stop()
                .catch(() => undefined)
                .finally(() => onScanRef.current(code));
            },
            () => undefined
          );
        } catch {
          await scanner.start(
            { facingMode: "user" },
            { fps: 10, qrbox: { width: 240, height: 240 } },
            (decoded) => {
              if (cancelled) return;
              cancelled = true;
              const code = normalizeCode(decoded);
              scanner
                ?.stop()
                .catch(() => undefined)
                .finally(() => onScanRef.current(code));
            },
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
            ? "Camera is blocked. Click the camera icon in the Chrome address bar → Allow, then tap Retry. Or use a board button / type a code below."
            : `Camera failed (${msg}). Use a board button below.`
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
  }, []);

  function submitManual() {
    const code = normalizeCode(manual);
    if (!code) return;
    onScan(code);
  }

  return (
    <div className="qr-overlay" role="dialog" aria-label="Scan QR board">
      <div className="qr-sheet">
        <div className="qr-top">
          <h2>Scan QR board</h2>
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <p className="qr-help">
          Allow camera when Chrome asks. Point at a Routefinding QR. If camera
          is blocked, click the <strong>camera icon</strong> next to the URL →
          Allow.
        </p>

        <div id={READER_ID} className="qr-box" />

        {cameraReady ? (
          <p className="qr-status ok">Camera on — point at a QR code</p>
        ) : (
          <p className="qr-status">{error ?? "Starting camera…"}</p>
        )}

        {error && (
          <button
            type="button"
            className="btn-retry"
            onClick={() => {
              setError(null);
              onClose();
            }}
          >
            Close and allow camera, then tap Scan again
          </button>
        )}

        {demoCodes.length > 0 && (
          <>
            <p className="qr-demo-label">Or tap a board code</p>
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

        <p className="qr-demo-label">Or type board code</p>
        <div className="qr-manual">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="e.g. SETU-A01"
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
