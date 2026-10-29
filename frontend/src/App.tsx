import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
import { useSmoothedBearing } from "./hooks/useSmoothedBearing";
import { findRoute, edgeBetween, walkHeadingDeg, edgeKey, buildPathInstructions, validateRoute, isReachable } from "./lib/router";
import { apiBase } from "./lib/network";
import {
  bearingDeg,
  haversineM,
  isRegisteredLocation,
  isVolunteerRegisterPayload,
  normalizeCode,
  placeTone,
  volunteerRegisterLink,
  type OfflinePack,
  type QrNode,
} from "./lib/types";
import {
  DEFAULT_DESTINATION_RADIUS_M,
  evaluateArrival,
  nextNavState,
  type NavState,
} from "./lib/navigation";
import { VolunteerPathHeading } from "./components/VolunteerPathHeading";
import { VolunteerObstacle } from "./components/VolunteerObstacle";
import {
  BlockIcon,
  BoardsIcon,
  ChevronIcon,
  CompassIcon,
  PinPlusIcon,
  PlaceIcon,
  ScanIcon,
  VolunteerIcon,
  WalkerIcon,
} from "./components/Icons";
import {
  SITE_CATEGORIES,
  areaOf,
  officialPlaceFor,
  siteCategory,
  siteCategoryLabel,
  type Area,
} from "./lib/officialPlaces";
import packFallback from "./data/pack.json";

type Mode = "gate" | "user" | "volunteer";
type UserStep = "home" | "start" | "boards" | "destination" | "guide";
type VolStep = "home" | "register" | "path-heading" | "obstacle";

const API = apiBase();
/** Auto “you reached” when live GPS is this close to the destination board. */
const ARRIVE_WITHIN_M = DEFAULT_DESTINATION_RADIUS_M;

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
  const [gpsArrived, setGpsArrived] = useState(false);
  const [sessionBlocked, setSessionBlocked] = useState<Set<string>>(
    () => new Set()
  );
  const [navState, setNavState] = useState<NavState>("IDLE");
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

  // Area / category filters, as on kumbhguidenashik.in/map.
  const [areaFilter, setAreaFilter] = useState<Area | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const destinationCategories = useMemo(() => {
    const present = new Set(destinations.map((n) => siteCategory(n.node_type)));
    return SITE_CATEGORIES.filter((c) => present.has(c.id));
  }, [destinations]);
  const destinationAreas = useMemo(
    () => [...new Set(destinations.map((n) => areaOf(n)))].sort(),
    [destinations]
  );
  // A filter that no longer matches any place (e.g. after changing start) acts as "all".
  const activeArea =
    areaFilter !== "all" && destinationAreas.includes(areaFilter) ? areaFilter : "all";
  const activeCategory = destinationCategories.some((c) => c.id === categoryFilter)
    ? categoryFilter
    : "all";
  const filteredDestinations = useMemo(
    () =>
      destinations.filter(
        (n) =>
          (activeArea === "all" || areaOf(n) === activeArea) &&
          (activeCategory === "all" || siteCategory(n.node_type) === activeCategory)
      ),
    [destinations, activeArea, activeCategory]
  );

  const routeOptions = useMemo(
    () => ({ blockedKeys: sessionBlocked, preferClearanceM: 1.0 }),
    [sessionBlocked]
  );

  const route = useMemo(() => {
    if (!pack || !start || !dest) return null;
    return findRoute(pack, start.code, dest.code, routeOptions);
  }, [pack, start, dest, routeOptions]);

  const routeValidation = useMemo(() => {
    if (!route || !pack) return null;
    if (!route.valid || route.codes.length === 0) {
      return { ok: false, errors: [route.reason ?? "No route"] };
    }
    return validateRoute(pack, route.codes, routeOptions);
  }, [route, pack, routeOptions]);

  const pathInstructions = useMemo(() => {
    if (!pack || !route?.valid || route.codes.length < 2) return [];
    return buildPathInstructions(pack, route.codes);
  }, [pack, route]);

  const nextNode = route?.nodes[1] ?? dest;
  const hasPath =
    !!route &&
    route.valid &&
    route.codes.length >= 2 &&
    !!routeValidation?.ok;

  // Board → next-board bearing only. Indoor live GPS (±10–40 m) points through
  // desks/glass and is not used for the arrow.
  const fromLat = start?.lat;
  const fromLon = start?.lon;

  const scannedArrived =
    !!start && !!dest && start.code.toUpperCase() === dest.code.toUpperCase();

  const startIdx = hasPath
    ? route!.codes.findIndex((c) => c.toUpperCase() === start!.code.toUpperCase())
    : -1;
  const pathFromHere =
    hasPath && startIdx >= 0 ? route!.codes.slice(startIdx) : route?.codes ?? [];

  const nextOnPath =
    pathFromHere.length >= 2
      ? pack.nodes.find(
          (n) => n.code.toUpperCase() === pathFromHere[1].toUpperCase()
        ) ?? nextNode
      : nextNode;

  // Last hop only — avoid mid-route GPS noise saying “arrived”.
  const onFinalLegToDest =
    !!dest &&
    ((pathFromHere.length === 2 &&
      pathFromHere[1].toUpperCase() === dest.code.toUpperCase()) ||
      scannedArrived);

  const destReachable =
    !!start &&
    !!dest &&
    isReachable(pack, start.code, dest.code, routeOptions);

  const guideActive =
    mode === "user" && step === "guide" && !!dest && !gpsArrived && !scannedArrived;
  const live = useLivePosition(guideActive);

  useEffect(() => {
    setGpsArrived(false);
    setSessionBlocked(new Set());
  }, [dest?.code]);

  useEffect(() => {
    if (step !== "guide") {
      setNavState("IDLE");
      return;
    }
    if (!start || !dest) {
      setNavState("IDLE");
      return;
    }
    setNavState((s) => nextNavState(s === "IDLE" ? "ROUTING" : s, "START_ROUTE"));
  }, [step, start?.code, dest?.code]);

  useEffect(() => {
    if (step !== "guide" || !start || !dest) return;
    if (scannedArrived || gpsArrived) {
      setNavState((s) => nextNavState(s, "ARRIVE"));
      return;
    }
    if (!hasPath) {
      setNavState((s) => nextNavState(s, "ROUTE_FAIL"));
      return;
    }
    setNavState((s) =>
      nextNavState(s, s === "REROUTING" ? "REROUTE_OK" : "ROUTE_OK")
    );
  }, [step, start, dest, hasPath, scannedArrived, gpsArrived, sessionBlocked]);

  useEffect(() => {
    if (!guideActive || !dest || !live.pos || gpsArrived || scannedArrived) {
      return;
    }
    const distM = haversineM(live.pos.lat, live.pos.lon, dest.lat, dest.lon);
    const check = evaluateArrival({
      startCode: start?.code,
      destCode: dest.code,
      onFinalLeg: onFinalLegToDest,
      destReachable,
      distanceToDestM: distM,
      destinationRadiusM: ARRIVE_WITHIN_M,
      gpsAccuracyM: live.pos.accuracyM,
    });
    if (check.arrived && check.reason === "proximity") {
      setGpsArrived(true);
    }
  }, [
    guideActive,
    dest,
    start?.code,
    live.pos,
    gpsArrived,
    scannedArrived,
    onFinalLegToDest,
    destReachable,
  ]);

  const arrived = scannedArrived || gpsArrived;

  function reportPathBlocked() {
    if (!start || !nextOnPath) return;
    const key = edgeKey(start.code, nextOnPath.code);
    setSessionBlocked((prev) => new Set(prev).add(key));
    setNavState((s) => nextNavState(s, "OBSTACLE"));
    // Persist for other users when possible.
    void fetch(`${API}/api/volunteer/edge-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from_code: start.code,
        to_code: nextOnPath.code,
        blocked: true,
        walkable: false,
        obstacle_note: "user_reported",
      }),
    })
      .then(() => reloadPack())
      .catch(() => undefined);
  }

  const edgeLegM =
    pathFromHere.length >= 2
      ? (edgeBetween(pack.edges, pathFromHere[0], pathFromHere[1])?.distance_m ??
        (fromLat != null && fromLon != null && nextOnPath
          ? haversineM(fromLat, fromLon, nextOnPath.lat, nextOnPath.lon)
          : 0))
      : 0;

  const legDistanceM = edgeLegM;

  // Prefer volunteer-captured walk heading (around desks/glass). Fall back to
  // GPS line only when no path heading was stored on that edge.
  const pathWalkHeading =
    pathFromHere.length >= 2
      ? walkHeadingDeg(pack.edges, pathFromHere[0], pathFromHere[1])
      : null;
  const bearingToNext =
    pathWalkHeading != null
      ? pathWalkHeading
      : fromLat != null && fromLon != null && nextOnPath
        ? bearingDeg(fromLat, fromLon, nextOnPath.lat, nextOnPath.lon)
        : 0;
  const rawArrowDeg = (bearingToNext - heading.heading + 360) % 360;
  const arrowDeg = useSmoothedBearing(
    rawArrowDeg,
    mode === "user" && step === "guide" && hasPath && !arrived
  );

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
        <section className="screen home gate">
          <header className="hero">
            <div className="hero-visual" aria-hidden>
              <div className="path-glow" />
              <DirectionArrow rotationDeg={18} size={132} />
            </div>
            <p className="eyebrow">Nashik Kumbh Mela 2027</p>
            <h1 className="brand">Kumbh Wayfinding</h1>
          </header>
          <div className="role-cards">
            <button
              type="button"
              className="role-card featured"
              onClick={() => {
                setMode("user");
                setStep("home");
              }}
            >
              <span className="role-icon">
                <WalkerIcon size={24} />
              </span>
              <span className="role-text">
                <strong>I am a visitor</strong>
                <small>Find my way in the mela</small>
              </span>
              <ChevronIcon size={20} className="role-chevron" />
            </button>
            <button
              type="button"
              className="role-card"
              onClick={() => {
                setMode("volunteer");
                setVolStep("home");
              }}
            >
              <span className="role-icon">
                <VolunteerIcon size={24} />
              </span>
              <span className="role-text">
                <strong>I am a volunteer</strong>
                <small>Register places and walk lanes</small>
              </span>
              <ChevronIcon size={20} className="role-chevron" />
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
          <section className="screen flow">
            <TopBar
              title="Volunteer"
              subtitle="Register Kumbh places and walk each mela lane once"
              onBack={() => setMode("gate")}
            />
            <div className="action-list">
              <button
                type="button"
                className="action-card featured"
                onClick={() => setVolStep("register")}
              >
                <span className="action-icon">
                  <PinPlusIcon />
                </span>
                <span className="action-text">
                  <strong>Register a mela place</strong>
                  <small>Add a board with its coordinates and walked lane</small>
                </span>
                <ChevronIcon size={20} className="action-chevron" />
              </button>
              <button
                type="button"
                className="action-card"
                onClick={() => setVolStep("path-heading")}
              >
                <span className="action-icon">
                  <CompassIcon />
                </span>
                <span className="action-text">
                  <strong>Fix walk direction</strong>
                  <small>Point the phone along a lane between two boards</small>
                </span>
                <ChevronIcon size={20} className="action-chevron" />
              </button>
              <button
                type="button"
                className="action-card"
                onClick={() => setVolStep("obstacle")}
              >
                <span className="action-icon warn">
                  <BlockIcon />
                </span>
                <span className="action-text">
                  <strong>Report a blocked lane</strong>
                  <small>Barricade, crowd or closed gate on a lane</small>
                </span>
                <ChevronIcon size={20} className="action-chevron" />
              </button>
            </div>

            <div className="share-card">
              <QRCodeSVG
                value={volunteerRegisterLink(phoneOrigin)}
                size={132}
                level="M"
                includeMargin
                bgColor="#ffffff"
                fgColor="#14201c"
              />
              <div>
                <strong>Open on another phone</strong>
                <p>Scan to open volunteer registration.</p>
                <p className="volunteer-phone-url">
                  {volunteerRegisterLink(phoneOrigin)}
                </p>
              </div>
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

        {volStep === "path-heading" && (
          <VolunteerPathHeading
            apiBase={API}
            onBack={() => setVolStep("home")}
            onSaved={() => {
              void reloadPack();
            }}
          />
        )}

        {volStep === "obstacle" && (
          <VolunteerObstacle
            apiBase={API}
            onBack={() => setVolStep("home")}
            onSaved={() => {
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
        <section className="screen flow">
          <TopBar
            title="Find your way"
            subtitle="Scan the board where you stand, pick a place, follow the arrow"
            onBack={() => setMode("gate")}
            aside={
              <span className="topbar-badge" aria-hidden>
                <DirectionArrow rotationDeg={18} size={44} />
              </span>
            }
          />
          <ol className="how-steps">
            <li>
              <span>1</span>Scan a board
            </li>
            <li>
              <span>2</span>Choose a place
            </li>
            <li>
              <span>3</span>Follow the arrow
            </li>
          </ol>
          <div className="action-list">
            <button
              type="button"
              className="action-card featured"
              onClick={() => setStep("start")}
            >
              <span className="action-icon">
                <WalkerIcon />
              </span>
              <span className="action-text">
                <strong>Find my way</strong>
                <small>Start from the board where you are</small>
              </span>
              <ChevronIcon size={20} className="action-chevron" />
            </button>
            <button
              type="button"
              className="action-card"
              onClick={() => setStep("boards")}
            >
              <span className="action-icon">
                <BoardsIcon />
              </span>
              <span className="action-text">
                <strong>Show mela boards</strong>
                <small>QR codes of every registered place</small>
              </span>
              <ChevronIcon size={20} className="action-chevron" />
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
            subtitle="Scan the board near you, or pick the place below"
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
            <ScanIcon size={20} /> Scan QR board
          </button>
          <button
            type="button"
            className="btn secondary block"
            onClick={() => setStep("boards")}
          >
            <BoardsIcon size={20} /> Show mela boards
          </button>
          <p className="section-label">Or pick where you are</p>
          {registeredPlaces.length === 0 ? (
            <div className="empty-state">
              <PinPlusIcon size={28} />
              <strong>No mela places yet</strong>
              <p>A volunteer must register a ghat, camp or gate first.</p>
            </div>
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
                  <span className={`place-mark ${placeTone(n.node_type)}`}>
                    <PlaceIcon type={n.node_type} />
                  </span>
                  <span className="place-text">
                    <strong>{n.name}</strong>
                    <small>
                      {n.local_name ? `${n.local_name} · ` : ""}
                      {siteCategoryLabel(n.node_type)}
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
            subtitle="Choose the place you want to reach"
            onBack={() => setStep("start")}
          />
          <div className="start-chip">
            <span className={`place-mark small ${placeTone(start.node_type)}`}>
              <PlaceIcon type={start.node_type} size={18} />
            </span>
            <span className="start-chip-text">
              <small>You are at</small>
              <strong>{start.name}</strong>
            </span>
            <button type="button" onClick={() => setStep("start")}>
              Change
            </button>
          </div>
          {destinations.length === 0 ? (
            <div className="empty-state">
              <PinPlusIcon size={28} />
              <strong>No other places yet</strong>
              <p>
                Volunteers can register ghats, hospitals, parking and camps in
                Volunteer mode.
              </p>
            </div>
          ) : (
            <>
            {destinationAreas.length > 1 && (
              <div className="filter-row" role="group" aria-label="Area">
                {(["all", ...destinationAreas] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={`filter-chip ${activeArea === a ? "active" : ""}`}
                    onClick={() => setAreaFilter(a)}
                  >
                    {a === "all" ? "All locations" : a}
                  </button>
                ))}
              </div>
            )}
            {destinationCategories.length > 1 && (
              <div className="filter-row" role="group" aria-label="Category">
                {[{ id: "all", label: "All places" }, ...destinationCategories].map(
                  (c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`filter-chip ${activeCategory === c.id ? "active" : ""}`}
                      onClick={() => setCategoryFilter(c.id)}
                    >
                      {c.label}
                    </button>
                  )
                )}
              </div>
            )}
            {filteredDestinations.length === 0 && (
              <div className="empty-state">
                <strong>No places match these filters</strong>
              </div>
            )}
            <div className="dest-grid">
              {filteredDestinations.map((n) => (
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
                  <span className="dest-top">
                    <span className={`dest-icon ${placeTone(n.node_type)}`}>
                      <PlaceIcon type={n.node_type} />
                    </span>
                    {officialPlaceFor(n)?.zone && (
                      <span className="zone-badge">
                        Zone {officialPlaceFor(n)?.zone}
                      </span>
                    )}
                  </span>
                  <strong>{n.name}</strong>
                  {n.local_name && <span className="dest-local">{n.local_name}</span>}
                  <small>{siteCategoryLabel(n.node_type)}</small>
                </button>
              ))}
            </div>
            </>
          )}
        </section>
      )}

      {step === "guide" && start && dest && arrived && (
        <section className="screen guide">
          <TopBar
            title={dest.name}
            subtitle="Navigation finished"
            onBack={() => setStep("destination")}
            light
          />
          <div className="empty-route">
            <span className="status-orb ok" aria-hidden>
              ✓
            </span>
            <h3 className="status-title">You have arrived</h3>
            <p className="fine">
              {scannedArrived
                ? "Destination board scanned."
                : "You are on the final lane, within about 2 m of the board."}
            </p>
            <button
              type="button"
              className="btn primary wide"
              onClick={() => {
                setStep("home");
                setStart(null);
                setDest(null);
              }}
            >
              Done
            </button>
          </div>
        </section>
      )}

      {step === "guide" && start && dest && route && !hasPath && !arrived && (
        <section className="screen guide">
          <TopBar
            title={dest.name}
            subtitle={`From ${start.name}`}
            onBack={() => setStep("destination")}
            light
          />
          <div className="empty-route">
            <span className="status-orb warn" aria-hidden>
              <BlockIcon size={30} />
            </span>
            <h3 className="status-title">No walked lane yet</h3>
            <p className="fine">
              {route.reason ||
                routeValidation?.errors?.[0] ||
                "Please move to the nearest marked pathway, or ask a volunteer to open a walk link / clear an obstacle."}
            </p>
            <div className="far-advice">
              <p className="far-distance">
                {(() => {
                  const m = haversineM(start.lat, start.lon, dest.lat, dest.lon);
                  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
                })()}
                <small>away in a straight line</small>
              </p>
              {officialPlaceFor(dest) && (
                <p className="far-tip">{officialPlaceFor(dest)?.getThere}</p>
              )}
              <p className="far-tip">Ask a volunteer or follow the mela signboards.</p>
              <p className="far-note">
                Guidance only — follow official signs and police instructions.
              </p>
            </div>
            <button
              type="button"
              className="btn primary wide"
              onClick={() => setStep("destination")}
            >
              Pick another place
            </button>
            {sessionBlocked.size > 0 && (
              <button
                type="button"
                className="btn soft"
                onClick={() => {
                  setSessionBlocked(new Set());
                  setNavState("ROUTING");
                }}
              >
                Clear temporary blocks & retry
              </button>
            )}
          </div>
        </section>
      )}

      {step === "guide" && start && dest && route && hasPath && !arrived && guideView === "camera" && (
        <ArGuide
          arrowDeg={arrowDeg}
          nextName={nextOnPath?.name ?? dest.name}
          distanceM={legDistanceM}
          destName={dest.name}
          arrived={arrived}
          sensorLive={heading.live}
          sensorNote={heading.note}
          pathHint={pathInstructions[0]?.text ?? null}
          onScan={handleArScan}
          onNudge={heading.nudge}
          onExit={() => setStep("destination")}
          onUseCompass={() => setGuideView("compass")}
          onPathBlocked={reportPathBlocked}
        />
      )}

      {step === "guide" && start && dest && route && hasPath && !arrived && guideView === "compass" && (
        <section className="screen guide">
          <TopBar
            title={dest.name}
            subtitle={`${Math.round(route.totalDistanceM)} m · ${navState}`}
            onBack={() => setStep("destination")}
            light
          />

          <div className="guide-stage">
            <p className="follow">
              {pathInstructions[0]?.text ?? "Follow the arrow"}
            </p>
            <DirectionArrow rotationDeg={arrowDeg} size={240} />
            <p className="next-line">
              Next: <strong>{nextOnPath?.name}</strong>
            </p>
            <p className="sensor-line">
              {heading.live ? "●" : "○"} {heading.note} ·{" "}
              {Math.round(heading.heading)}°
              {pathWalkHeading != null
                ? " · path walk"
                : " · GPS line (set walk direction)"}
            </p>
          </div>

          <div className="route-panel">
            <p className="section-label light">Turn-by-turn (walkable path)</p>
            <ol className="route-steps">
              {pathInstructions.map((ins, i) => (
                <li key={`${ins.text}-${i}`}>
                  <span className="dot" />
                  <div>
                    <strong>{ins.text}</strong>
                    {ins.detail && <small>{ins.detail}</small>}
                  </div>
                </li>
              ))}
            </ol>
            <p className="section-label light">Boards on route</p>
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
                          {edge.door_state && edge.door_state !== "none"
                            ? ` · door ${edge.door_state}`
                            : ""}
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
                onClick={reportPathBlocked}
              >
                Path blocked — reroute
              </button>
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
          title="Scan a Kumbh board"
          helpText="Scan a ghat, akhara, camp, or gate board. This is not the volunteer QR."
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
  aside,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
  light?: boolean;
  /** Small element on the right of the title, e.g. a badge. */
  aside?: ReactNode;
}) {
  return (
    <div className={`topbar ${light ? "light" : ""}`}>
      <button type="button" className="back" onClick={onBack} aria-label="Back">
        ←
      </button>
      <div className="topbar-text">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {aside}
    </div>
  );
}
