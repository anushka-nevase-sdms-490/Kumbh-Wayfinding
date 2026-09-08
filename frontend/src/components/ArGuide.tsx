import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { normalizeCode } from "../lib/types";
import "./ArGuide.css";

type Props = {
  /** Where to walk, in degrees clockwise from straight ahead. */
  arrowDeg: number;
  nextName: string;
  distanceM: number;
  destName: string;
  arrived: boolean;
  sensorLive: boolean;
  sensorNote: string;
  /** Fired when a board QR comes into view — re-anchors the route. */
  onScan: (code: string) => void;
  onNudge: (delta: number) => void;
  onExit: () => void;
  onUseCompass: () => void;
};

const READER_ID = "routefinding-ar-cam";

/** Signed turn: negative is left, positive is right. */
function signedTurn(deg: number) {
  const d = ((deg % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
}

function instruction(deg: number, nextName: string) {
  const t = signedTurn(deg);
  const side = t < 0 ? "left" : "right";
  const mag = Math.abs(t);
  if (mag <= 15) return { text: "Go straight", detail: `towards ${nextName}` };
  if (mag <= 60) return { text: `Bear ${side}`, detail: `then straight on` };
  if (mag <= 120) return { text: `Turn ${side}`, detail: `${Math.round(mag)}° to your ${side}` };
  if (mag <= 165) return { text: `Sharp ${side}`, detail: `${Math.round(mag)}° to your ${side}` };
  return { text: "Turn around", detail: "the path is behind you" };
}

export function ArGuide(props: Props) {
  const {
    arrowDeg,
    nextName,
    distanceM,
    destName,
    arrived,
    sensorLive,
    sensorNote,
    onScan,
    onNudge,
    onExit,
    onUseCompass,
  } = props;

  const [camError, setCamError] = useState<string | null>(null);
  const [camReady, setCamReady] = useState(false);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    let stopped = false;
    let scanner: Html5Qrcode | null = null;
    // Same board decodes many times a second; only act on a genuine change.
    let lastCode = "";
    let lastAt = 0;

    const boot = window.setTimeout(async () => {
      if (!document.getElementById(READER_ID)) return;
      try {
        scanner = new Html5Qrcode(READER_ID, { verbose: false });
        await scanner.start(
          { facingMode: "environment" },
          // No qrbox: scan the whole frame so the view stays a clean camera
          // feed for the overlay rather than a cropped scanner window.
          { fps: 8, aspectRatio: 1.777 },
          (decoded) => {
            const code = normalizeCode(decoded);
            const now = Date.now();
            if (code === lastCode && now - lastAt < 4000) return;
            lastCode = code;
            lastAt = now;
            onScanRef.current(code);
          },
          () => undefined
        );
        if (!stopped) {
          setCamReady(true);
          setCamError(null);
        }
      } catch (err) {
        if (stopped) return;
        const msg = err instanceof Error ? err.message : String(err);
        setCamError(
          /NotAllowed|Permission|denied/i.test(msg)
            ? "Camera blocked — allow it in the address bar, or use Compass view."
            : `Camera unavailable (${msg})`
        );
      }
    }, 120);

    return () => {
      stopped = true;
      window.clearTimeout(boot);
      const s = scanner;
      if (s) {
        s.stop()
          .then(() => s.clear())
          .catch(() => undefined);
      }
    };
  }, []);

  const turn = signedTurn(arrowDeg);
  const { text, detail } = instruction(arrowDeg, nextName);
  const onCourse = Math.abs(turn) <= 15;

  return (
    <div className="ar">
      <div id={READER_ID} className="ar-cam" />
      {!camReady && !camError && <div className="ar-boot">Starting camera…</div>}
      {camError && (
        <div className="ar-boot error">
          <p>{camError}</p>
          <button type="button" className="ar-switch" onClick={onUseCompass}>
            Use compass view
          </button>
        </div>
      )}

      <div className="ar-overlay">
        <div className="ar-top">
          <button type="button" className="ar-back" onClick={onExit} aria-label="Back">
            ←
          </button>
          <div className="ar-dest">
            <strong>{destName}</strong>
            <span>{arrived ? "You have arrived" : `${Math.round(distanceM)} m to go`}</span>
          </div>
        </div>

        {arrived ? (
          <div className="ar-arrived">
            <div className="ar-arrived-mark">✓</div>
            <p>You have reached {destName}</p>
          </div>
        ) : (
          <>
            <div className={`ar-banner ${onCourse ? "straight" : ""}`}>
              <p className="ar-instruction">{text}</p>
              <p className="ar-detail">{detail}</p>
            </div>

            {/* Arrow lies flat on the ground plane, so it reads as part of
                the scene rather than a dial floating over it. */}
            <div className="ar-ground">
              <div className="ar-plane">
                <svg
                  viewBox="0 0 200 260"
                  className="ar-arrow"
                  style={{ transform: `rotateZ(${arrowDeg}deg)` }}
                  aria-hidden
                >
                  <defs>
                    <linearGradient id="arGrad" x1="0" y1="1" x2="0" y2="0">
                      <stop offset="0%" stopColor="#F0A05A" stopOpacity="0.35" />
                      <stop offset="100%" stopColor="#F0A05A" stopOpacity="1" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M100 10 L175 120 L128 120 L128 250 L72 250 L72 120 L25 120 Z"
                    fill="url(#arGrad)"
                    stroke="#1A2421"
                    strokeWidth="3"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>

            <p className="ar-next">
              Next board: <strong>{nextName}</strong>
            </p>
          </>
        )}

        <div className="ar-bottom">
          <p className="ar-sensor">
            {sensorLive ? "●" : "○"} {sensorNote}
          </p>
          {!sensorLive && (
            <div className="ar-nudge">
              <button type="button" onClick={() => onNudge(-20)}>
                ◀ Turn left
              </button>
              <button type="button" onClick={() => onNudge(20)}>
                Turn right ▶
              </button>
            </div>
          )}
          <p className="ar-hint">
            Point the camera at a board QR to update your position.
          </p>
          <button type="button" className="ar-switch subtle" onClick={onUseCompass}>
            Compass view
          </button>
        </div>
      </div>
    </div>
  );
}
