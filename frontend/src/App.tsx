import { useCallback, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { QrScanner } from "./components/QrScanner";
import { BoardQrGallery } from "./components/BoardQrGallery";
import { DirectionArrow } from "./components/DirectionArrow";
import { ArGuide } from "./components/ArGuide";
import { VolunteerRegisterForm } from "./components/VolunteerRegisterForm";
import "./components/Volunteer.css";
import { useDeviceHeading } from "./hooks/useDeviceHeading";
import { useLivePosition } from "./hooks/useLivePosition";
import { usePhoneAppBase } from "./hooks/usePhoneAppBase";
import { findRoute, edgeBetween } from "./lib/router";
import { apiBase } from "./lib/network";
import {
  TYPE_META,
  bearingDeg,
  haversineM,
  isRegisteredLocation,
  isVolunteerRegisterPayload,
  normalizeCode,
  volunteerRegisterLink,
  type OfflinePack,
  type QrNode,
} from "./lib/types";
import packFallback from "./data/pack.json";

type Mode = "gate" | "user" | "volunteer";
type UserStep = "home" | "start" | "boards" | "destination" | "guide";
type VolStep = "home" | "register";

const API = apiBase();

export default function App() {
  const phoneOrigin = usePhoneAppBase();
  const [mode, setMode] = useState<Mode>("gate");
  const [pack, setPack] = useState<OfflinePack>(packFallback as OfflinePack);
  const [step, setStep] = useState<UserStep>("home");
  const [volStep, setVolStep] = useState<VolStep>("home");
  const [start, setStart] = useState<QrNode | null>(null);
  const [dest, setDest] = useState<QrNode | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [scanTarget, setScanTarget] = useState<"start" | "reanchor">("start");
  const [guideView, setGuideView] = useState<"camera" | "compass">("camera");
  const heading = useDeviceHeading();

  const reloadPack = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/pack/latest/json`);
      if (!res.ok) return;
      const data = (await res.json()) as OfflinePack;
      if (Array.isArray(data?.nodes) && data.nodes.length > 0) {
        setPack(data);
      }
    } catch {
      /* keep current */
    }
  }, []);

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

  // Phone camera scanned a URL QR → open the right mode
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const modeParam = params.get("mode");
    const register = params.get("register");
    const board = params.get("board") || params.get("start");

    if (modeParam === "volunteer" || register === "1") {
      setMode("volunteer");
      setVolStep("register");
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }

    if (board && pack.nodes.length) {
      const node = pack.nodes.find(
        (n) => n.code.toUpperCase() === normalizeCode(board)
      );
      if (node) {
        setMode("user");
        setStart(node);
        setStep("destination");
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
  }, [pack]);

  /** Only volunteer-registered places (hide old SETU seed names). */
  const registeredPlaces = useMemo(
    () =>
      (pack?.nodes ?? [])
        .filter(isRegisteredLocation)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [pack]
  );

  const destinations = useMemo(
    () => registeredPlaces.filter((n) => n.code !== start?.code),
    [registeredPlaces, start]
  );

  const route = useMemo(() => {
    if (!pack || !start || !dest) return null;
    return findRoute(pack, start.code, dest.code);
  }, [pack, start, dest]);

  const nextNode = route?.nodes[1] ?? dest;
  const hasPath = !!route && route.codes.length >= 2;
  const liveNav = useLivePosition(mode === "user" && step === "guide" && hasPath);

  // Prefer live phone GPS for direction — board-only bearing points through glass/walls.
  const fromLat = liveNav.pos?.lat ?? start?.lat;
  const fromLon = liveNav.pos?.lon ?? start?.lon;

  const sameBoardArrive =
    !!route &&
    !!start &&
    !!dest &&
    route.codes.length === 1 &&
    start.code.toUpperCase() === dest.code.toUpperCase();

  const gpsArrive =
    !!liveNav.pos &&
    !!dest &&
    haversineM(liveNav.pos.lat, liveNav.pos.lon, dest.lat, dest.lon) <= 8;

  const arrived = sameBoardArrive || gpsArrive;

  const edgeLegM =
    hasPath
      ? (edgeBetween(pack.edges, route!.codes[0], route!.codes[1])?.distance_m ??
        0)
      : 0;

  const legDistanceM =
    fromLat != null && fromLon != null && nextNode
      ? haversineM(fromLat, fromLon, nextNode.lat, nextNode.lon)
      : edgeLegM;

  const bearingToNext =
    fromLat != null && fromLon != null && nextNode
      ? bearingDeg(fromLat, fromLon, nextNode.lat, nextNode.lon)
      : 0;
  const arrowDeg = (bearingToNext - heading.heading + 360) % 360;

  const handleUserScan = useCallback(
    (code: string) => {
      setShowScanner(false);
      if (isVolunteerRegisterPayload(code)) {
        alert(
          "That is the Volunteer Registration QR. Open Volunteer mode to use it."
        );
        return;
      }
      const normalized = normalizeCode(code);
      const node = pack.nodes.find(
        (n) => n.code.toUpperCase() === normalized
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

  const handleArScan = useCallback(
    (code: string) => {
      if (isVolunteerRegisterPayload(code)) return;
      const normalized = normalizeCode(code);
      const node = pack.nodes.find(
        (n) => n.code.toUpperCase() === normalized
      );
      if (node) setStart(node);
    },
    [pack]
  );

  const demoCodes = useMemo(
    () =>
      registeredPlaces
        .slice(0, 8)
        .map((n) => ({ code: n.code, name: n.name })),
    [registeredPlaces]
  );

  /* ─── Gate: User vs Volunteer ─── */
  if (mode === "gate") {
    return (
      <div className="app">
        <div className="atmosphere" aria-hidden />
        <section className="screen home">
          <header className="home-top">
            <h1 className="brand">Routefinding</h1>
            <p className="lead">
              Kumbh wayfinding — choose how you use this app.
            </p>
          </header>
          <div className="home-visual" aria-hidden>
            <div className="path-glow" />
            <DirectionArrow rotationDeg={18} size={180} />
          </div>
          <div className="home-cta gate-cta">
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setMode("user");
                setStep("home");
              }}
            >
              User
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                setMode("volunteer");
                setVolStep("home");
              }}
            >
              Volunteer
            </button>
          </div>
        </section>
      </div>
    );
  }

  /* ─── Volunteer window ─── */
  if (mode === "volunteer") {
    return (
      <div className="app">
        <div className="atmosphere" aria-hidden />

        {volStep === "home" && (
          <section className="screen home volunteer-home-simple">
            <header className="home-top">
              <button
                type="button"
                className="back volunteer-home-back"
                onClick={() => setMode("gate")}
                aria-label="Back"
              >
                ←
              </button>
              <h1 className="brand">Volunteer</h1>
            </header>
            <div className="volunteer-access-qr">
              <QRCodeSVG
                value={volunteerRegisterLink(phoneOrigin)}
                size={220}
                level="M"
                includeMargin
                bgColor="#ffffff"
                fgColor="#14201c"
              />
              <p className="volunteer-gutter">
                scan this QR and register location
              </p>
              <p className="volunteer-phone-url">
                {volunteerRegisterLink(phoneOrigin)}
              </p>
            </div>
          </section>
        )}

        {volStep === "register" && (
          <VolunteerRegisterForm
            apiBase={API}
            onBack={() => setVolStep("home")}
            onRegistered={() => {
              void reloadPack();
            }}
          />
        )}
      </div>
    );
  }

  /* ─── User window (existing wayfinding) ─── */
  return (
    <div className="app">
      <div className="atmosphere" aria-hidden />

      {step === "home" && (
        <section className="screen home">
          <header className="home-top user-home-top">
            <button
              type="button"
              className="back user-home-back"
              onClick={() => setMode("gate")}
              aria-label="Back"
            >
              ←
            </button>
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
          nodes={registeredPlaces}
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
            subtitle="Scan a registered location QR, or pick from the list"
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
          <p className="section-label">Registered locations</p>
          {registeredPlaces.length === 0 ? (
            <p className="lead" style={{ marginTop: 8 }}>
              No locations yet. Ask a volunteer to register a place first.
            </p>
          ) : (
            <div className="place-list">
              {registeredPlaces.map((n) => (
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
                      {n.code}
                      {n.local_name ? ` · ${n.local_name}` : ""}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          )}
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
          {destinations.length === 0 ? (
            <p className="lead" style={{ marginTop: 12 }}>
              No other registered destinations yet. Register more places in
              Volunteer mode.
            </p>
          ) : (
            <div className="dest-grid">
              {destinations.map((n) => (
                <button
                  key={n.code}
                  type="button"
                  className="dest"
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
                  <small>
                    {n.local_name ? `${n.local_name} · ` : ""}
                    {TYPE_META[n.node_type]?.hint ?? n.code}
                  </small>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {step === "guide" && start && dest && route && !hasPath && (
        <section className="screen guide">
          <TopBar
            title={dest.name}
            subtitle="No walkable path"
            onBack={() => setStep("destination")}
            light
          />
          <div className="empty-route">
            <p>No walkable path connects these boards yet.</p>
            <p className="fine" style={{ opacity: 0.8 }}>
              Volunteer locations need a path link between them for routing.
            </p>
            <button
              type="button"
              className="btn primary"
              onClick={() => setStep("destination")}
            >
              Pick another place
            </button>
          </div>
        </section>
      )}

      {step === "guide" && start && dest && route && hasPath && guideView === "camera" && (
        <ArGuide
          arrowDeg={arrowDeg}
          nextName={nextNode?.name ?? dest.name}
          distanceM={legDistanceM}
          destName={dest.name}
          arrived={arrived}
          sensorLive={heading.live}
          sensorNote={
            liveNav.note ? `${heading.note} · ${liveNav.note}` : heading.note
          }
          onScan={handleArScan}
          onNudge={heading.nudge}
          onExit={() => setStep("destination")}
          onUseCompass={() => setGuideView("compass")}
        />
      )}

      {step === "guide" && start && dest && route && hasPath && guideView === "compass" && (
        <section className="screen guide">
          <TopBar
            title={dest.name}
            subtitle={`${Math.round(route.totalDistanceM)} m along mela paths`}
            onBack={() => setStep("destination")}
            light
          />

          <div className="guide-stage">
            <p className="follow">Follow the arrow</p>
            <DirectionArrow rotationDeg={arrowDeg} size={240} />
            <p className="next-line">
              Next: <strong>{nextNode?.name}</strong>
            </p>
            <p className="sensor-line">
              {heading.live ? "●" : "○"} {heading.note}
              {liveNav.note ? ` · ${liveNav.note}` : ""} ·{" "}
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
                          then {Math.round(edge.distance_m)} m · {edge.surface}
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
                onClick={() => setGuideView("camera")}
              >
                Camera view
              </button>
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
        </section>
      )}

      {showScanner && (
        <QrScanner
          onClose={() => setShowScanner(false)}
          onScan={handleUserScan}
          demoCodes={demoCodes}
          title="Scan location QR"
          helpText="Scan a printed location board (e.g. KUMBH-A01). Not the volunteer QR."
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
