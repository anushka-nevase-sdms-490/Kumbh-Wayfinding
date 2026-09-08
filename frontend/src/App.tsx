import { useCallback, useEffect, useMemo, useState } from "react";
import { QrScanner } from "./components/QrScanner";
import { BoardQrGallery } from "./components/BoardQrGallery";
import { DirectionArrow } from "./components/DirectionArrow";
import { useDeviceHeading } from "./hooks/useDeviceHeading";
import { findRoute, edgeBetween } from "./lib/router";
import {
  TYPE_META,
  bearingDeg,
  normalizeCode,
  type OfflinePack,
  type QrNode,
} from "./lib/types";
import packFallback from "./data/pack.json";

type Step = "home" | "start" | "boards" | "destination" | "guide";

const API = import.meta.env.VITE_SETU_API ?? "http://localhost:8000";

export default function App() {
  const [pack, setPack] = useState<OfflinePack>(packFallback as OfflinePack);
  const [step, setStep] = useState<Step>("home");
  const [start, setStart] = useState<QrNode | null>(null);
  const [dest, setDest] = useState<QrNode | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [scanTarget, setScanTarget] = useState<"start" | "reanchor">("start");
  const heading = useDeviceHeading();

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 2000);

    (async () => {
      try {
        const res = await fetch(`${API}/api/pack/latest/json`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as OfflinePack;
        if (!cancelled && Array.isArray(data?.nodes) && data.nodes.length > 0) {
          setPack(data);
        }
      } catch {
        /* keep bundled pack */
      } finally {
        window.clearTimeout(timer);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, []);

  const destinations = useMemo(
    () =>
      (pack?.nodes ?? [])
        .filter((n) => n.node_type !== "junction")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [pack]
  );

  const route = useMemo(() => {
    if (!pack || !start || !dest) return null;
    return findRoute(pack, start.code, dest.code);
  }, [pack, start, dest]);

  const nextNode = route?.nodes[1] ?? dest;
  const bearingToNext =
    start && nextNode
      ? bearingDeg(start.lat, start.lon, nextNode.lat, nextNode.lon)
      : 0;
  const arrowDeg = (bearingToNext - heading.heading + 360) % 360;

  const handleScan = useCallback(
    (code: string) => {
      setShowScanner(false);
      const node = pack.nodes.find(
        (n) => n.code.toUpperCase() === normalizeCode(code)
      );
      if (!node) {
        alert(`Unknown board code: ${code}`);
        return;
      }
      setStart(node);
      if (scanTarget === "start") setStep("destination");
    },
    [pack, scanTarget]
  );

  const demoCodes = useMemo(
    () => pack.nodes.slice(0, 8).map((n) => ({ code: n.code, name: n.name })),
    [pack]
  );

  return (
    <div className="app">
      <div className="atmosphere" aria-hidden />

      {step === "home" && (
        <section className="screen home">
          <header className="home-top">
            <h1 className="brand">Routefinding</h1>
            <p className="lead">
              Satellite maps do not know these temporary lanes. Scan a QR board,
              choose where you are going, follow the arrow — no signal needed.
            </p>
          </header>
          <div className="home-visual" aria-hidden>
            <div className="path-glow" />
            <DirectionArrow rotationDeg={18} size={200} />
          </div>
          <div className="home-cta">
            <button
              type="button"
              className="btn primary"
              onClick={() => setStep("start")}
            >
              Find my way
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => setStep("boards")}
            >
              Show QR boards
            </button>
          </div>
        </section>
      )}

      {step === "boards" && (
        <BoardQrGallery
          nodes={pack.nodes}
          onBack={() => setStep("home")}
          onUseAsStart={(node) => {
            setStart(node);
            setStep("destination");
          }}
        />
      )}

      {step === "start" && (
        <section className="screen flow">
          <TopBar
            title="Where are you?"
            subtitle="Scan a QR board with the camera, or open Show QR boards"
            onBack={() => setStep("home")}
          />
          <button
            type="button"
            className="btn primary block"
            onClick={() => {
              setScanTarget("start");
              setShowScanner(true);
            }}
          >
            Scan QR board (camera)
          </button>
          <button
            type="button"
            className="btn secondary block"
            onClick={() => setStep("boards")}
          >
            Show QR boards
          </button>
          <p className="section-label">Or tap your starting point</p>
          <div className="place-list">
            {pack.nodes.map((n) => (
              <button
                key={n.code}
                type="button"
                className={`place ${start?.code === n.code ? "active" : ""}`}
                onClick={() => {
                  setStart(n);
                  setStep("destination");
                }}
              >
                <span className="place-mark">
                  {TYPE_META[n.node_type]?.emoji ?? "·"}
                </span>
                <span>
                  <strong>{n.name}</strong>
                  <small>
                    {n.code} · {TYPE_META[n.node_type]?.label ?? n.node_type}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === "destination" && start && (
        <section className="screen flow">
          <TopBar
            title="Where to?"
            subtitle={`Starting from ${start.name}`}
            onBack={() => setStep("start")}
          />
          <div className="start-chip">
            Start · {start.name}
            <button type="button" onClick={() => setStep("start")}>
              Change
            </button>
          </div>
          <div className="dest-grid">
            {destinations.map((n) => (
              <button
                key={n.code}
                type="button"
                className="dest"
                disabled={n.code === start.code}
                onClick={() => {
                  setDest(n);
                  setStep("guide");
                  heading.requestPermission();
                }}
              >
                <span className="dest-icon">
                  {TYPE_META[n.node_type]?.emoji ?? "·"}
                </span>
                <strong>{n.name}</strong>
                <small>{TYPE_META[n.node_type]?.hint}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === "guide" && start && dest && route && (
        <section className="screen guide">
          <TopBar
            title={dest.name}
            subtitle={
              route.codes.length
                ? `${Math.round(route.totalDistanceM)} m along mela paths`
                : "No walkable path"
            }
            onBack={() => setStep("destination")}
            light
          />

          {!route.codes.length ? (
            <div className="empty-route">
              <p>No man-made path connects these boards yet.</p>
              <button
                type="button"
                className="btn primary"
                onClick={() => setStep("destination")}
              >
                Pick another place
              </button>
            </div>
          ) : (
            <>
              <div className="guide-stage">
                <p className="follow">Follow the arrow</p>
                <DirectionArrow rotationDeg={arrowDeg} size={240} />
                <p className="next-line">
                  Next: <strong>{nextNode?.name}</strong>
                </p>
                <p className="sensor-line">
                  {heading.live ? "●" : "○"} {heading.note} ·{" "}
                  {Math.round(heading.heading)}°
                </p>
              </div>

              <div className="route-panel">
                <p className="section-label light">Your route (QR to QR)</p>
                <ol className="route-steps">
                  {route.nodes.map((n, i) => {
                    const edge =
                      i < route.nodes.length - 1
                        ? edgeBetween(
                            pack.edges,
                            route.codes[i],
                            route.codes[i + 1]
                          )
                        : null;
                    return (
                      <li key={n.code}>
                        <span className="dot" />
                        <div>
                          <strong>
                            {i === 0
                              ? "You are here — "
                              : i === route.nodes.length - 1
                                ? "Destination — "
                                : ""}
                            {n.name}
                          </strong>
                          {edge && (
                            <small>
                              then {Math.round(edge.distance_m)} m ·{" "}
                              {edge.surface}
                            </small>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>

                <div className="guide-actions">
                  <button
                    type="button"
                    className="btn soft"
                    onClick={() => {
                      setScanTarget("reanchor");
                      setShowScanner(true);
                    }}
                  >
                    Rescan board
                  </button>
                  <button
                    type="button"
                    className="btn soft"
                    onClick={() => heading.nudge(-20)}
                  >
                    Turn left
                  </button>
                  <button
                    type="button"
                    className="btn soft"
                    onClick={() => heading.nudge(20)}
                  >
                    Turn right
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {showScanner && (
        <QrScanner
          onClose={() => setShowScanner(false)}
          onScan={handleScan}
          demoCodes={demoCodes}
        />
      )}
    </div>
  );
}

function TopBar({
  title,
  subtitle,
  onBack,
  light,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
  light?: boolean;
}) {
  return (
    <div className={`topbar ${light ? "light" : ""}`}>
      <button type="button" className="back" onClick={onBack} aria-label="Back">
        ←
      </button>
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}
