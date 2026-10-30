import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { VolunteerRegisterForm } from "./components/VolunteerRegisterForm";
import "./components/Volunteer.css";
import { useLivePosition } from "./hooks/useLivePosition";
import { findRoute, edgeBetween, edgeKey, buildPathInstructions, validateRoute } from "./lib/router";
import { mapRoadParts, routeLine } from "./lib/mapData";
import { OFF_ROUTE_FIXES, ON_ROUTE_M, offRouteLimitM, reachedPlace, routeProgress } from "./lib/progress";
import { apiBase, isSecureEnough } from "./lib/network";
import { loadStoredPack, saveStoredPack, storagePersisted } from "./lib/packStore";
import { simulationRequested } from "./lib/location/config";
import { setSimulatedPositions } from "./lib/location/geo";
import { RealGPSProvider } from "./lib/location/realGps";
import type { SimulationLocationProvider } from "./lib/location/simulation";
import type { LocationProvider } from "./lib/location/types";
import { RAMKUND_CENTER } from "./lib/mapArea";
import { fetchNewerPack, type PackCheck } from "./lib/packSync";
import {
  GOOD_FIX_M,
  WEAK_FIX_M,
  placesByDistance,
  suggestStart,
  type PlaceDistance,
} from "./lib/nearest";
import {
  haversineM,
  isFieldVerified,
  isRegisteredLocation,
  isUsablePack,
  placeTone,
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
import { VolunteerLogin } from "./components/VolunteerLogin";
import { AUTH_EXPIRED_EVENT, loadAuth, logout, type StoredAuth } from "./lib/auth";
import { OfflineMapCard } from "./components/OfflineMapCard";
import { PlaceBadges } from "./components/PlaceBadges";
import { BoardCodeEntry } from "./components/BoardCodeEntry";
import { SosScreen } from "./components/SosScreen";
import { AssistantScreen } from "./components/AssistantScreen";
import { OpsSos } from "./components/OpsSos";
import { OpsCases, type CasePrefill } from "./components/OpsCases";
import { ReportHelper } from "./components/ReportHelper";
import { OpsSummary } from "./components/OpsSummary";
import { flushSos, httpTransport, idbSos } from "./lib/sos";
import { opStatus, resolveBoard, searchPlaces } from "./lib/placeInfo";
import { LangPicker } from "./components/LangPicker";
import { useI18n } from "./i18n/context";
import { instructionLines, turnText } from "./i18n/instructions";
import type { MessageKey } from "./i18n/messages";
import { useRegisterSW } from "virtual:pwa-register/react";
import { VolunteerObstacle } from "./components/VolunteerObstacle";
import { VolunteerOutbox } from "./components/VolunteerOutbox";
import { authSender, flushOutbox, idbOutbox } from "./lib/outbox";
import {
  BlockIcon,
  ChevronIcon,
  CompassIcon,
  PinPlusIcon,
  PlaceIcon,
  VolunteerIcon,
  WalkerIcon,
} from "./components/Icons";
import {
  SITE_CATEGORIES,
  areaOf,
  officialPlaceFor,
  siteCategory,
  type Area,
} from "./lib/officialPlaces";
import { FALLBACK_PACK } from "./lib/fallbackPack";

// MapLibre is ~1 MB: load it only when a map screen opens.
const LazyOfflineMap = lazy(() =>
  import("./components/OfflineMap").then((m) => ({ default: m.OfflineMap }))
);

// Development-only Nashik simulation (docs/NASHIK_SIMULATION_MODE.md). In a
// normal production build this is null and the simulation code is left out.
const LazySimulationPanel =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_SIMULATION === "1"
    ? lazy(() => import("./components/SimulationPanel"))
    : null;

// Admin map: admins only, so it is loaded only when opened.
const LazyAdminMap = lazy(() =>
  import("./components/AdminMap").then((m) => ({ default: m.AdminMap }))
);

function OfflineMap(props: ComponentProps<typeof LazyOfflineMap>) {
  return (
    <Suspense fallback={<div className={`offline-map-loading ${props.className ?? ""}`} />}>
      <LazyOfflineMap {...props} />
    </Suspense>
  );
}

type Mode = "gate" | "user" | "volunteer";
type UserStep = "home" | "start" | "destination" | "guide" | "sos" | "ask";
type VolStep = "home" | "register" | "path-heading" | "obstacle" | "admin" | "sos-ops" | "cases";

const API = apiBase();
/** Re-check the server for a newer pack at most this often when the app is reopened. */
const PACK_RECHECK_MS = 5 * 60 * 1000;
/** Walking time for the guide: about 1.2 m/s in a crowd, at least 1 min. */
function walkMinutes(meters: number): number {
  return Math.max(1, Math.ceil(meters / 1.2 / 60));
}

/** Closer than this to the next turn: "Turn right now". */
const TURN_NOW_M = 15;
/** Off route: try this many nearest places/junctions as the new start. */
const REROUTE_CANDIDATES = 25;

/**
 * Random id this phone keeps, so its "path blocked" reports count as one
 * reporter (many phones share a mobile-network IP). Not linked to the person.
 */
function deviceId(): string {
  try {
    let id = localStorage.getItem("setu-device");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("setu-device", id);
    }
    return id;
  } catch {
    return (sessionDevice ??= crypto.randomUUID());
  }
}
let sessionDevice: string | undefined;

/** "places-20261030.json" → "2026-10-30" (the OpenStreetMap download date). */
function osmSnapshotDate(file: string): string {
  const m = /(\d{4})(\d{2})(\d{2})/.exec(file);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : file;
}

/** "29 Oct, 14:05" in the phone's time zone (first readable time given), or null. */
function formatPackTime(locale: string, ...isos: (string | null | undefined)[]): string | null {
  const t = isos
    .map((iso) => (iso ? new Date(iso) : null))
    .find((d) => d && !Number.isNaN(d.getTime()));
  if (!t) return null;
  return t.toLocaleString(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    // Latin digits in every language (Marathi Intl would use ०-९).
    numberingSystem: "latn",
  });
}
/** Auto “you reached” when live GPS is this close to the destination. */
const ARRIVE_WITHIN_M = DEFAULT_DESTINATION_RADIUS_M;

export default function App() {
  const { t, dist, lang, placeLabel, placeAltLabel } = useI18n();
  /** Name to show for a place; hidden map junctions have none. */
  const placeName = (n: QrNode) => (n.name.trim() ? placeLabel(n) : t("place.junction"));
  const categoryLabel = (nodeType: string) => t(`cat.${siteCategory(nodeType)}` as MessageKey);
  const [mode, setMode] = useState<Mode>("gate");
  const [pack, setPack] = useState<OfflinePack>(FALLBACK_PACK);
  const [step, setStep] = useState<UserStep>("home");
  const [volStep, setVolStep] = useState<VolStep>("home");
  /** "Send SOS" from Ask Setu: the question becomes the alert's note. */
  const [sosNote, setSosNote] = useState("");
  /** A "someone is lost" SOS alert an operator is turning into a case. */
  const [casePrefill, setCasePrefill] = useState<CasePrefill | null>(null);
  const [start, setStart] = useState<QrNode | null>(null);
  const [dest, setDest] = useState<QrNode | null>(null);
  const [gpsArrived, setGpsArrived] = useState(false);
  const [sessionBlocked, setSessionBlocked] = useState<Set<string>>(
    () => new Set()
  );
  const [navState, setNavState] = useState<NavState>("IDLE");
  const [gpsMsg, setGpsMsg] = useState<string | null>(null);
  const [rerouteMsg, setRerouteMsg] = useState<string | null>(null);
  /** Volunteer signed in on this phone (writes need it — backend app/auth.py). */
  const [auth, setAuth] = useState<StoredAuth | null>(() => loadAuth());
  /** The sign-in ended while working: ask again over the form, keeping its input. */
  const [authLost, setAuthLost] = useState(false);
  useEffect(() => {
    const onExpired = () => {
      setAuth(null);
      setAuthLost(true);
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  // SOS alerts saved on this phone: sent, and their state refreshed, whatever
  // screen is open (at start, on reconnect, and every 20 s).
  useEffect(() => {
    const transport = httpTransport(API);
    const tick = () => void flushSos(idbSos, transport).catch(() => undefined);
    tick();
    window.addEventListener("online", tick);
    const timer = window.setInterval(() => {
      void idbSos
        .list()
        .then((l) => l.some((i) => i.state === "pending" || i.state === "sent" || i.state === "acknowledged") && tick())
        .catch(() => undefined);
    }, 20_000);
    return () => {
      window.removeEventListener("online", tick);
      window.clearInterval(timer);
    };
  }, []);

  const reloadPackRef = useRef<() => Promise<unknown>>(async () => undefined);
  // Volunteer changes saved without internet: send them when the phone is
  // online (at start, after sign-in, on reconnect, and every 30 s while any wait).
  useEffect(() => {
    if (!auth) return;
    let alive = true;
    const send = async () => {
      try {
        const waiting = (await idbOutbox.list()).some((i) => i.status === "waiting");
        if (!waiting || !alive) return;
        const r = await flushOutbox(authSender(API));
        if (r.sent > 0 && alive) void reloadPackRef.current();
      } catch {
        /* storage unavailable: nothing was queued */
      }
    };
    void send();
    window.addEventListener("online", send);
    const timer = window.setInterval(send, 30_000);
    return () => {
      alive = false;
      window.removeEventListener("online", send);
      window.clearInterval(timer);
    };
  }, [auth]);
  /** A new app version is installed and waiting (service worker). */
  const {
    needRefresh: [updateReady],
    updateServiceWorker,
  } = useRegisterSW();

  /** Where the current pack came from — decides what may replace it. */
  const [packSource, setPackSource] = useState<"bundled" | "stored" | "server">("bundled");
  const [packSavedAt, setPackSavedAt] = useState<string | null>(null);
  /** Last answer from the server's pack check (why routes may be missing). */
  const [packCheck, setPackCheck] = useState<PackCheck | null>(null);
  /** The start was set from a Setu board (scanned link or typed code). */
  const [boardCode, setBoardCode] = useState<string | null>(null);
  const [boardMsg, setBoardMsg] = useState<string | null>(null);
  const [placeQuery, setPlaceQuery] = useState("");
  /** ?at=<board or place code> from a scanned board, resolved once the data is loaded. */
  const pendingAt = useRef<string | null>(
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("at")
  );
  const [packCheckAt, setPackCheckAt] = useState<string | null>(null);
  /** A problem with the copy on the phone (storage full, damaged copy removed). */
  const [storageNote, setStorageNote] = useState<"full" | "damaged" | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const packRef = useRef(pack);
  packRef.current = pack;
  const packSourceRef = useRef(packSource);
  packSourceRef.current = packSource;
  /** Only the latest check may apply its result. */
  const packCheckSeq = useRef(0);
  const lastPackCheck = useRef(0);

  /** Ask the server for a newer pack; keep what we have if it can't be reached. */
  const reloadPack = useCallback(async () => {
    const seq = ++packCheckSeq.current;
    lastPackCheck.current = Date.now();
    const result = await fetchNewerPack(API, packRef.current);
    if (seq !== packCheckSeq.current) return;
    setPackCheck(result);
    setPackCheckAt(new Date().toISOString());
    if (result.kind === "wrong_server") {
      // Usually a setup problem (another program on the backend port): say so.
      console.warn(
        `[Setu] /api/pack/latest answered HTTP ${result.status} — is the Setu backend on the port the app's /api goes to?`
      );
    }
    if (result.kind !== "newer") return;
    // Refs now, so a stored pack still loading can't overwrite this one.
    packRef.current = result.pack;
    packSourceRef.current = "server";
    setPack(result.pack);
    setPackSource("server");
    setPackSavedAt(new Date().toISOString());
    // Shown on the home screen if the phone could not keep it (storage full).
    void saveStoredPack(result.pack).then((r) => {
      setStorageNote(r === "quota" ? "full" : null);
      void storagePersisted().then(setPersisted);
    });
  }, []);
  reloadPackRef.current = reloadPack;

  // Start from the pack saved on the phone, then check the server.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadStoredPack();
      if (cancelled) return;
      if (loaded.kind === "corrupt" || (loaded.kind === "unavailable" && loaded.reset)) {
        setStorageNote("damaged");
      }
      void storagePersisted().then(setPersisted);
      if (loaded.kind === "ok" && isUsablePack(loaded.stored.pack) && packSourceRef.current === "bundled") {
        setPack(loaded.stored.pack);
        setPackSource("stored");
        setPackSavedAt(loaded.stored.savedAt);
        packRef.current = loaded.stored.pack;
        // A copy saved before checksums: save it again so damage can be noticed later.
        if (!loaded.stored.checksum) void saveStoredPack(loaded.stored.pack);
      }
      await reloadPack();
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadPack]);

  // Check again when the network comes back, or when the app is reopened.
  useEffect(() => {
    const onOnline = () => void reloadPack();
    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastPackCheck.current > PACK_RECHECK_MS
      ) {
        void reloadPack();
      }
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reloadPack]);

  // A new pack has new place objects: keep the chosen start/destination in step.
  useEffect(() => {
    const fresh = (n: QrNode | null) =>
      n ? (pack.nodes.find((x) => x.code === n.code) ?? n) : n;
    setStart(fresh);
    setDest(fresh);
  }, [pack]);

  // Plain link straight into volunteer mode: /?mode=volunteer
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "volunteer") {
      setMode("volunteer");
      setVolStep("home");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

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
      searchPlaces(
        destinations.filter(
          (n) =>
            (activeArea === "all" || areaOf(n) === activeArea) &&
            (activeCategory === "all" || siteCategory(n.node_type) === activeCategory)
        ),
        placeQuery,
        (n) => categoryLabel(n.node_type)
      ),
    // categoryLabel follows the language (t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [destinations, activeArea, activeCategory, placeQuery, t]
  );

  // A scanned board link (/?at=K7M4Q): "You are at <place>", straight to choosing a destination.
  // "Unknown" is only said once the newest data had its chance: online, after the
  // update check (a new board is not in an older saved copy); offline, at once.
  useEffect(() => {
    const raw = pendingAt.current;
    if (!raw) return;
    const r = resolveBoard(pack.nodes, raw);
    const settled = packCheck !== null || !navigator.onLine;
    if (r.kind !== "found" && !settled) return;
    pendingAt.current = null;
    window.history.replaceState({}, "", window.location.pathname);
    setMode("user");
    if (r.kind === "found") {
      setStart(r.node);
      setBoardCode(r.boardCode);
      setBoardMsg(null);
      setStep("destination");
    } else {
      setBoardMsg(r.kind === "unknown" ? t("board.unknown", { code: r.code }) : t("board.invalid"));
      setStep("start");
    }
  }, [pack, packCheck, t]);

  const routeOptions = useMemo(
    () => ({ blockedKeys: sessionBlocked, preferClearanceM: 1.0 }),
    [sessionBlocked]
  );

  // Simulation on the volunteer screens: walk the real lanes from the place
  // the simulated volunteer stands at (development only).
  const volunteerRouteTo = useCallback(
    (from: { lat: number; lon: number }, code: string) => {
      let start: QrNode | null = null;
      let best = 40; // metres: must be standing at a place
      for (const p of registeredPlaces) {
        const d = haversineM(from.lat, from.lon, p.lat, p.lon);
        if (d < best) [start, best] = [p, d];
      }
      if (!start || start.code === code) return [];
      const r = findRoute(pack, start.code, code, routeOptions);
      return r.valid && r.codes.length >= 2 ? routeLine(pack, r.codes) : [];
    },
    [pack, registeredPlaces, routeOptions]
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

  const startIsDest =
    !!start && !!dest && start.code.toUpperCase() === dest.code.toUpperCase();

  const startIdx = hasPath
    ? route!.codes.findIndex((c) => c.toUpperCase() === start!.code.toUpperCase())
    : -1;
  const pathFromHere =
    hasPath && startIdx >= 0 ? route!.codes.slice(startIdx) : route?.codes ?? [];
  // Stable key for effects/memos that depend on the path contents.
  const pathKey = pathFromHere.join("|");

  const nextOnPath =
    pathFromHere.length >= 2
      ? pack.nodes.find(
          (n) => n.code.toUpperCase() === pathFromHere[1].toUpperCase()
        ) ?? nextNode
      : nextNode;

  // Next place the visitor can recognise (hidden map junctions skipped), the
  // lanes between the next junction and it, and whether any lane ahead is a
  // map road no volunteer has walked. Per route, not per render.
  const { nextNamed, laterToNamedM, usesMapRoads } = useMemo(() => {
    const byCode = new Map(pack.nodes.map((n) => [n.code.toUpperCase(), n]));
    const idx = pathFromHere.findIndex((code, i) => {
      const n = byCode.get(code.toUpperCase());
      return i > 0 && !!n && isRegisteredLocation(n) && n.name.trim().length > 0;
    });
    const lane = (i: number) => edgeBetween(pack.edges, pathFromHere[i], pathFromHere[i + 1]);
    let later = 0;
    for (let i = 1; i < idx; i++) later += lane(i)?.distance_m ?? 0;
    return {
      nextNamed: idx > 0 ? byCode.get(pathFromHere[idx].toUpperCase()) : undefined,
      laterToNamedM: later,
      usesMapRoads: pathFromHere.slice(1).some((_, i) => {
        const e = lane(i);
        return !!e && !isFieldVerified(e);
      }),
    };
    // pathKey stands in for pathFromHere (a new array every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack, pathKey]);

  // Last hop only — avoid mid-route GPS noise saying “arrived”.
  const onFinalLegToDest =
    !!dest &&
    ((pathFromHere.length === 2 &&
      pathFromHere[1].toUpperCase() === dest.code.toUpperCase()) ||
      startIsDest);

  // Same search, same options as `route` — reuse it instead of re-running A*
  // on every render (heading updates re-render many times a second).
  const destReachable = !!route?.valid && route.codes.length > 0;

  const guideActive =
    mode === "user" && step === "guide" && !!dest && !gpsArrived && !startIsDest;
  // Simulation: only when the build allows it and the developer asked (?sim=1).
  const [simOn] = useState(() => LazySimulationPanel !== null && simulationRequested());
  const [simProvider, setSimProvider] = useState<SimulationLocationProvider | null>(null);
  // Volunteer screens read GPS through lib/location/geo: simulated only while the panel runs.
  useEffect(() => {
    setSimulatedPositions(simOn ? simProvider : null);
  }, [simOn, simProvider]);
  const [simPicking, setSimPicking] = useState(false);
  // Real GPS and simulation are separate sources; the simulation never touches the phone's GPS.
  const locationProvider: LocationProvider | null = simOn ? simProvider : RealGPSProvider;
  const live = useLivePosition(
    (guideActive || (mode === "user" && (step === "start" || step === "sos" || step === "ask"))) && locationProvider !== null,
    locationProvider ?? RealGPSProvider
  );
  const gpsAllowed =
    simOn || (isSecureEnough() && typeof navigator !== "undefined" && !!navigator.geolocation);
  const onSimMapTap =
    simPicking && simProvider
      ? (lat: number, lon: number) => {
          simProvider.placeAt(lat, lon);
          setSimPicking(false);
        }
      : undefined;

  // Start screen: nearest places to the live fix (visitor always confirms).
  const startFix = live.pos
    ? { lat: live.pos.lat, lon: live.pos.lon, accuracyM: live.pos.accuracyM }
    : null;
  const startSuggestion = useMemo(
    () => suggestStart(registeredPlaces, startFix),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registeredPlaces, startFix?.lat, startFix?.lon, startFix?.accuracyM]
  );
  const startList: (PlaceDistance | { node: QrNode; distanceM: null })[] =
    startFix && startFix.accuracyM <= WEAK_FIX_M
      ? placesByDistance(registeredPlaces, startFix)
      : registeredPlaces.map((node) => ({ node, distanceM: null }));

  /** Guide: move the start to the place the visitor is standing at now. */
  function updatePositionFromGps() {
    const fix = live.pos;
    if (!fix || fix.accuracyM > GOOD_FIX_M) {
      setGpsMsg(t("guide.gpsNotAccurate"));
      return;
    }
    const nearest = placesByDistance(registeredPlaces, fix)[0];
    if (!nearest || nearest.distanceM > GOOD_FIX_M) {
      setGpsMsg(t("guide.notAtPlace"));
      return;
    }
    setGpsMsg(null);
    setStart(nearest.node);
  }

  useEffect(() => {
    setSessionBlocked(new Set());
    setRerouteMsg(null);
  }, [dest?.code]);

  // A new trip (or a fresh start point) must not inherit the last "arrived".
  useEffect(() => {
    setGpsArrived(false);
    setGpsMsg(null);
  }, [dest?.code, start?.code, step]);

  // Keyed on the codes: a refreshed pack gives new place objects for the same trip.
  const startCode = start?.code;
  const destCode = dest?.code;
  useEffect(() => {
    if (step !== "guide" || !startCode || !destCode) {
      setNavState("IDLE");
      return;
    }
    setNavState((s) => nextNavState(s === "IDLE" ? "ROUTING" : s, "START_ROUTE"));
  }, [step, startCode, destCode]);

  useEffect(() => {
    if (step !== "guide" || !start || !dest) return;
    if (startIsDest || gpsArrived) {
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
  }, [step, start, dest, hasPath, startIsDest, gpsArrived, sessionBlocked]);

  useEffect(() => {
    if (!guideActive || !dest || !live.pos || gpsArrived || startIsDest) {
      return;
    }
    // Distance left *along the final lane*, and only while on that lane: a
    // straight line could "arrive" from the wrong bank of a river.
    const onLane =
      onFinalLegToDest && live.pos.usable
        ? routeProgress(pack, pathFromHere, live.pos)
        : null;
    const distM =
      onLane && onLane.offRouteM <= Math.max(ON_ROUTE_M, live.pos.accuracyM)
        ? onLane.remainingM
        : null;
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
    // pathKey stands in for pathFromHere (a new array every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    guideActive,
    dest,
    start?.code,
    live.pos,
    gpsArrived,
    startIsDest,
    onFinalLegToDest,
    destReachable,
    pack,
    pathKey,
  ]);

  const arrived = startIsDest || gpsArrived;

  // Reroutes this phone at once. For everyone else it is only a report: a
  // volunteer checks the lane and confirms a timed block (backend reports.py).
  function reportPathBlocked() {
    if (!start || !nextOnPath) return;
    const key = edgeKey(start.code, nextOnPath.code);
    setSessionBlocked((prev) => new Set(prev).add(key));
    setNavState((s) => nextNavState(s, "OBSTACLE"));
    setGpsMsg(t("guide.reported"));
    void fetch(`${API}/api/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from_code: start.code, to_code: nextOnPath.code, device: deviceId() }),
    }).catch(() => undefined); // offline: this phone still avoids the lane
  }

  const edgeLegM =
    pathFromHere.length >= 2
      ? (edgeBetween(pack.edges, pathFromHere[0], pathFromHere[1])?.distance_m ??
        (fromLat != null && fromLon != null && nextOnPath
          ? haversineM(fromLat, fromLon, nextOnPath.lat, nextOnPath.lon)
          : 0))
      : 0;

  const legDistanceM = edgeLegM;

  // Map: the route drawn along walked lanes from the current place.
  const routeCoords = useMemo(
    () => (hasPath ? routeLine(pack, pathFromHere) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasPath, pack, pathKey]
  );

  const routeMapRoads = useMemo(
    () => (hasPath ? mapRoadParts(pack, pathFromHere) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasPath, pack, pathKey]
  );

  // Where the visitor is along the route, from live GPS (null without a usable fix).
  const progress = useMemo(
    () =>
      guideActive && hasPath && live.pos?.usable
        ? routeProgress(pack, pathFromHere, live.pos)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [guideActive, hasPath, pack, pathKey, live.pos]
  );

  // Distance still to walk: along the route from the GPS position, else the
  // full route from the current place.
  const toNextM = progress ? progress.toNextM : legDistanceM;
  const remainingM = progress ? progress.remainingM : (route?.totalDistanceM ?? 0);

  // What to do next: the coming turn, with the distance to it. The first
  // instruction's stretch can span several lanes; part of the first lane may
  // already be walked.
  const walkedOnLaneM = progress ? Math.max(0, legDistanceM - progress.toNextM) : 0;
  const guideNow = (() => {
    const first = pathInstructions[0];
    if (!first) return t("guide.follow");
    const leftM = Math.max(0, first.distanceM - walkedOnLaneM);
    const then = pathInstructions[1];
    if (!then || then.kind === "arrive" || then.kind === "straight") {
      return t("guide.straightFor", { dist: dist(leftM) });
    }
    const turn = turnText(lang, then);
    return leftM > TURN_NOW_M ? t("guide.inDist", { dist: dist(leftM), turn }) : t("guide.turnNow", { turn });
  })();

  // Reached the next place on the route → it becomes the current place, so the
  // route, the next instruction and "Path blocked" move along by themselves.
  // One place at a time, and only when the visitor is actually there.
  useEffect(() => {
    if (!progress || !live.pos || pathFromHere.length < 3) return;
    if (!reachedPlace(progress, live.pos.accuracyM)) return;
    const code = pathFromHere[1];
    const node = pack.nodes.find((n) => n.code.toUpperCase() === code.toUpperCase());
    if (node) setStart(node);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  // Off the route for several fixes in a row → new route from the nearest
  // place that can still reach the destination. Always the nearest one (the
  // current place included), so being off every route cannot ping-pong.
  const offRouteFixesRef = useRef(0);
  useEffect(() => {
    if (!progress || !live.pos || !dest) {
      offRouteFixesRef.current = 0;
      return;
    }
    if (progress.offRouteM <= offRouteLimitM(live.pos.accuracyM)) {
      offRouteFixesRef.current = 0;
      setRerouteMsg(null);
      return;
    }
    offRouteFixesRef.current += 1;
    if (offRouteFixesRef.current < OFF_ROUTE_FIXES) return;
    offRouteFixesRef.current = 0;
    // Map junctions count too: the nearest point on any road is the best restart.
    const from = placesByDistance(pack.nodes, live.pos)
      .slice(0, REROUTE_CANDIDATES)
      .find(
        (p) =>
          // Never the destination itself: that would count as "arrived".
          p.node.code !== dest.code &&
          findRoute(pack, p.node.code, dest.code, routeOptions).valid
      );
    if (!from) return;
    const named = isRegisteredLocation(from.node) && from.node.name.trim().length > 0;
    if (from.node.code === start?.code) {
      setRerouteMsg(
        named
          ? t("rr.headBack", { name: placeLabel(from.node), dist: dist(from.distanceM) })
          : t("rr.headBackLine", { dist: dist(from.distanceM) })
      );
      return;
    }
    setNavState((st) => nextNavState(st, "OBSTACLE"));
    setRerouteMsg(named ? t("rr.newFrom", { name: placeLabel(from.node) }) : t("rr.newHere"));
    setStart(from.node);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.pos]);

  const mapYou = useMemo(
    () =>
      live.pos && live.pos.accuracyM <= WEAK_FIX_M
        ? { lat: live.pos.lat, lon: live.pos.lon, accuracyM: live.pos.accuracyM }
        : null,
    [live.pos]
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
              <WalkerIcon size={96} />
            </div>
            <p className="eyebrow">{t("gate.eyebrow")}</p>
            <h1 className="brand">{t("app.name")}</h1>
          </header>
          <LangPicker />
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
                <strong>{t("gate.visitor")}</strong>
                <small>{t("gate.visitorHint")}</small>
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
                <strong>{t("gate.volunteer")}</strong>
                <small>{t("gate.volunteerHint")}</small>
              </span>
              <ChevronIcon size={20} className="role-chevron" />
            </button>
          </div>
        </section>
      </div>
    );
  }

  /** New app version waiting — shown only on calm screens, never mid-walk. */
  const updateBanner = updateReady ? (
    <div className="update-banner" role="status">
      <span>{t("update.ready")}</span>
      <button type="button" className="btn soft" onClick={() => void updateServiceWorker(true)}>
        {t("update.reload")}
      </button>
    </div>
  ) : null;

  /* ─── Volunteer window ─── */
  if (mode === "volunteer" && !auth && !authLost) {
    return (
      <div className="app">
        <div className="atmosphere" aria-hidden />
        <VolunteerLogin apiBase={API} onSignedIn={setAuth} onBack={() => setMode("gate")} />
      </div>
    );
  }

  if (mode === "volunteer") {
    return (
      <div className="app">
        <div className="atmosphere" aria-hidden />
        {volStep === "home" && updateBanner}
        {simOn && LazySimulationPanel && (
          <Suspense fallback={null}>
            <LazySimulationPanel
              start={RAMKUND_CENTER}
              route={[]}
              routeKey=""
              places={registeredPlaces}
              picking={false}
              onPickingChange={() => {}}
              onProvider={setSimProvider}
              routeTo={volunteerRouteTo}
            />
          </Suspense>
        )}
        {!auth && (
          <VolunteerLogin
            apiBase={API}
            overlay
            onSignedIn={(a) => {
              setAuth(a);
              setAuthLost(false);
            }}
            onBack={() => {
              setAuthLost(false);
              setMode("gate");
            }}
          />
        )}

        {volStep === "home" && (
          <section className="screen flow">
            <TopBar
              title={t("vol.home.title")}
              subtitle={t("vol.home.subtitle")}
              onBack={() => setMode("gate")}
            />
            <LangPicker compact />
            {auth && (
              <p className="volunteer-who">
                <span>
                  {t(auth.volunteer.role === "admin" ? "vol.home.signedInAdmin" : "vol.home.signedInAs", {
                    name: auth.volunteer.name,
                  })}
                </span>
                <button
                  type="button"
                  className="btn soft"
                  onClick={() => {
                    void logout(API);
                    setAuth(null);
                    setMode("gate");
                  }}
                >
                  {t("vol.home.signOut")}
                </button>
              </p>
            )}
            <VolunteerOutbox apiBase={API} volunteerId={auth?.volunteer.id ?? null} />
            {(auth?.volunteer.role === "operator" || auth?.volunteer.role === "admin") && (
              <OpsSummary apiBase={API} isAdmin={auth.volunteer.role === "admin"} onOpen={(where) => setVolStep(where)} />
            )}
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
                  <strong>{t("vol.home.register")}</strong>
                  <small>{t("vol.home.registerHint")}</small>
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
                  <strong>{t("vol.home.heading")}</strong>
                  <small>{t("vol.home.headingHint")}</small>
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
                  <strong>{t("vol.home.obstacle")}</strong>
                  <small>{t("vol.home.obstacleHint")}</small>
                </span>
                <ChevronIcon size={20} className="action-chevron" />
              </button>
              {(auth?.volunteer.role === "operator" || auth?.volunteer.role === "admin") && (
                <>
                  <button type="button" className="action-card sos-card" onClick={() => setVolStep("sos-ops")}>
                    <span className="action-icon" aria-hidden>
                      !
                    </span>
                    <span className="action-text">
                      <strong>SOS alerts</strong>
                      <small>Visitors asking for help — acknowledge and resolve</small>
                    </span>
                    <ChevronIcon size={20} className="action-chevron" />
                  </button>
                  <button
                    type="button"
                    className="action-card"
                    onClick={() => {
                      setCasePrefill(null);
                      setVolStep("cases");
                    }}
                  >
                    <span className="action-icon" aria-hidden>
                      ?
                    </span>
                    <span className="action-text">
                      <strong>Lost persons</strong>
                      <small>Cases for authorized operators</small>
                    </span>
                    <ChevronIcon size={20} className="action-chevron" />
                  </button>
                </>
              )}
              {auth?.volunteer.role === "admin" && (
                <button
                  type="button"
                  className="action-card"
                  onClick={() => setVolStep("admin")}
                >
                  <span className="action-icon">
                    <PlaceIcon type="landmark" />
                  </span>
                  <span className="action-text">
                    <strong>{t("vol.home.admin")}</strong>
                    <small>{t("vol.home.adminHint")}</small>
                  </span>
                  <ChevronIcon size={20} className="action-chevron" />
                </button>
              )}
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

        {volStep === "sos-ops" && (
          <OpsSos
            apiBase={API}
            places={registeredPlaces}
            onBack={() => setVolStep("home")}
            onOpenCase={(a) => {
              setCasePrefill({ sosId: a.id, note: a.note, placeCode: a.placeCode });
              setVolStep("cases");
            }}
          />
        )}

        {volStep === "cases" && (
          <OpsCases
            key={casePrefill?.sosId ?? "list"}
            apiBase={API}
            places={registeredPlaces}
            prefill={casePrefill}
            onBack={() => {
              setCasePrefill(null);
              setVolStep("home");
            }}
            renderReportHelper={(apply) => <ReportHelper places={registeredPlaces} apply={apply} />}
          />
        )}

        {volStep === "admin" && (
          <Suspense fallback={<div className="offline-map-loading" />}>
            <LazyAdminMap
              apiBase={API}
              onBack={() => setVolStep("home")}
              onSaved={() => {
                void reloadPack();
              }}
            />
          </Suspense>
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
      {step !== "guide" && updateBanner}
      {simOn && LazySimulationPanel && (
        <Suspense fallback={null}>
          <LazySimulationPanel
            start={RAMKUND_CENTER}
            route={routeCoords}
            routeKey={hasPath ? pathKey : ""}
            places={registeredPlaces}
            picking={simPicking}
            onPickingChange={setSimPicking}
            onProvider={setSimProvider}
          />
        </Suspense>
      )}

      {step === "home" && (
        <section className="screen flow">
          <TopBar
            title={t("home.title")}
            subtitle={t("home.subtitle")}
            onBack={() => setMode("gate")}
          />
          <LangPicker compact />
          <ol className="how-steps">
            <li>
              <span>1</span>{t("home.step1")}
            </li>
            <li>
              <span>2</span>{t("home.step2")}
            </li>
            <li>
              <span>3</span>{t("home.step3")}
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
                <strong>{t("home.findWay")}</strong>
                <small>{t("home.findWayHint")}</small>
              </span>
              <ChevronIcon size={20} className="action-chevron" />
            </button>
            <button type="button" className="action-card" onClick={() => setStep("ask")}>
              <span className="action-icon" aria-hidden>
                ?
              </span>
              <span className="action-text">
                <strong>{t("ask.cta")}</strong>
                <small>{t("ask.ctaHint")}</small>
              </span>
              <ChevronIcon size={20} className="action-chevron" />
            </button>
            <button type="button" className="action-card sos-card" onClick={() => setStep("sos")}>
              <span className="action-icon" aria-hidden>
                !
              </span>
              <span className="action-text">
                <strong>{t("sos.cta")}</strong>
                <small>{t("sos.ctaHint")}</small>
              </span>
              <ChevronIcon size={20} className="action-chevron" />
            </button>
          </div>
          <OfflineMapCard />
          <p className="pack-status">
            {packSource === "bundled"
              ? t("pack.sample")
              : (() => {
                  const time = formatPackTime(`${lang}-IN`, pack.generated_at, packSavedAt);
                  const count = registeredPlaces.length;
                  return time ? t("pack.from", { time, count }) : t("pack.fromPhone", { count });
                })()}
          </p>
          {storageNote && (
            <p className="pack-status warn" role="status">
              {storageNote === "full" ? t("pack.storageFull") : t("pack.storageDamaged")}
            </p>
          )}
          {packSource !== "bundled" && (
            <details className="pack-details">
              <summary>{t("pack.details")}</summary>
              <p>{t("pack.detailVersion", { version: pack.version })}</p>
              {pack.sources?.osm_network && (
                <p>{t("pack.detailSources", { date: osmSnapshotDate(pack.sources.osm_network) })}</p>
              )}
              {packCheckAt && packCheck && (
                <p>
                  {t("pack.detailCheck", {
                    time: formatPackTime(`${lang}-IN`, packCheckAt) ?? "",
                    result: t(
                      packCheck.kind === "same"
                        ? "pack.checkSame"
                        : packCheck.kind === "newer"
                          ? "pack.checkNewer"
                          : packCheck.kind === "unreachable"
                            ? "pack.checkOffline"
                            : packCheck.kind === "empty"
                              ? "pack.checkEmpty"
                              : "pack.checkServer"
                    ),
                  })}
                </p>
              )}
              {persisted !== null && <p>{persisted ? t("pack.persistOn") : t("pack.persistOff")}</p>}
            </details>
          )}
          {/* Why there are no walking routes yet — instead of failing quietly. */}
          {packSource === "bundled" && packCheck && (
            <p className="pack-status warn" role="status">
              {packCheck.kind === "wrong_server"
                ? t("pack.wrongServer", { status: packCheck.status })
                : packCheck.kind === "empty"
                  ? t("pack.empty")
                  : packCheck.kind === "unreachable"
                    ? t("pack.offline")
                    : null}
            </p>
          )}
        </section>
      )}

      {step === "ask" && (
        <AssistantScreen
          onSos={(note) => {
            setSosNote(note.slice(0, 280));
            setStep("sos");
          }}
          places={registeredPlaces}
          from={
            live.pos && live.pos.usable
              ? { lat: live.pos.lat, lon: live.pos.lon }
              : start
                ? { lat: start.lat, lon: start.lon }
                : null
          }
          dataTime={packSource === "bundled" ? null : formatPackTime(`${lang}-IN`, pack.generated_at, packSavedAt)}
          onBack={() => setStep("home")}
          onRoute={(node) => {
            setDest(node);
            setStep(start && start.code !== node.code ? "guide" : "start");
          }}
        />
      )}

      {step === "sos" && (
        <SosScreen
          apiBase={API}
          places={registeredPlaces}
          position={live.pos && live.pos.usable ? { lat: live.pos.lat, lon: live.pos.lon, accuracyM: live.pos.accuracyM } : null}
          start={start}
          device={deviceId()}
          onBack={() => {
            setSosNote("");
            setStep("home");
          }}
          onRoute={(node) => {
            setDest(node);
            setStep(start && start.code !== node.code ? "guide" : "start");
          }}
          initialNote={sosNote}
        />
      )}

      {step === "start" && (
        <section className="screen flow">
          <TopBar
            title={t("start.title")}
            subtitle={t("start.subtitle")}
            onBack={() => setStep("home")}
          />

          <OfflineMap
            onMapTap={onSimMapTap}
            className="pick-map"
            places={registeredPlaces}
            you={mapYou}
            startCode={start?.code}
            onPlaceTap={(code) => {
              const n = registeredPlaces.find((p) => p.code === code);
              if (!n) return;
              setStart(n);
              setStep("destination");
            }}
          />

          <div className="gps-card" aria-live="polite">
            {!gpsAllowed ? (
              <p className="gps-note">
                {isSecureEnough() ? t("start.noGps") : t("start.needHttps")}
              </p>
            ) : startSuggestion.kind === "near" ? (
              <>
                <p className="gps-note">
                  {startSuggestion.candidates.length > 1
                    ? t("start.nearOne")
                    : startSuggestion.approximate
                      ? t("start.probablyNear")
                      : t("start.near")}
                  {live.pos && <> · {t("start.gpsAcc", { acc: Math.round(live.pos.accuracyM) })}</>}
                </p>
                <div className="place-list">
                  {startSuggestion.candidates.map(({ node, distanceM }) => (
                    <button
                      key={node.code}
                      type="button"
                      className="place active"
                      onClick={() => {
                        setStart(node);
                        setStep("destination");
                      }}
                    >
                      <span className={`place-mark ${placeTone(node.node_type)}`}>
                        <PlaceIcon type={node.node_type} />
                      </span>
                      <span className="place-text">
                        <strong>{placeLabel(node)}</strong>
                        <small>{t("start.awayTap", { dist: dist(distanceM) })}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : startSuggestion.kind === "far" ? (
              <p className="gps-note">
                {t("start.far", {
                  name: placeLabel(startSuggestion.nearest.node),
                  dist: dist(startSuggestion.nearest.distanceM),
                })}
              </p>
            ) : (
              <p className="gps-note">
                {startSuggestion.reason === "no_places"
                  ? t("start.noPlaces")
                  : live.note
                    ? t(live.note.key, { acc: live.note.acc ?? "" })
                    : t("start.finding")}
              </p>
            )}
          </div>

          <BoardCodeEntry
            nodes={pack.nodes}
            onFound={(node, code) => {
              setStart(node);
              setBoardCode(code);
              setBoardMsg(null);
              setStep("destination");
            }}
            onUnknown={() => {
              if (navigator.onLine) void reloadPack();
            }}
          />
          {boardMsg && (
            <p className="gps-status err" role="alert">
              {boardMsg}
            </p>
          )}

          <p className="section-label">
            {startList.some((p) => p.distanceM != null)
              ? t("start.allNearest")
              : t("start.pick")}
          </p>
          {registeredPlaces.length === 0 ? (
            <div className="empty-state">
              <PinPlusIcon size={28} />
              <strong>{t("start.emptyTitle")}</strong>
              <p>{t("start.emptyText")}</p>
            </div>
          ) : (
            <div className="place-list">
              {startList.map(({ node: n, distanceM }) => (
                <button
                  key={n.code}
                  type="button"
                  className={`place ${start?.code === n.code ? "active" : ""}`}
                  onClick={() => {
                    setStart(n);
                    setBoardCode(null);
                    setStep("destination");
                  }}
                >
                  <span className={`place-mark ${placeTone(n.node_type)}`}>
                    <PlaceIcon type={n.node_type} />
                  </span>
                  <span className="place-text">
                    <strong>{placeLabel(n)}</strong>
                    <small>
                      {distanceM != null ? `${dist(distanceM)} · ` : ""}
                      {placeAltLabel(n) ? `${placeAltLabel(n)} · ` : ""}
                      {categoryLabel(n.node_type)}
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
            title={t("dest.title")}
            subtitle={t("dest.subtitle")}
            onBack={() => setStep("start")}
          />
          <OfflineMap
            onMapTap={onSimMapTap}
            className="pick-map"
            places={registeredPlaces}
            startCode={start.code}
            you={mapYou}
            onPlaceTap={(code) => {
              const n = destinations.find((p) => p.code === code);
              if (!n) return;
              setDest(n);
              setStep("guide");
            }}
          />
          <div className="start-chip">
            <span className={`place-mark small ${placeTone(start.node_type)}`}>
              <PlaceIcon type={start.node_type} size={18} />
            </span>
            <span className="start-chip-text">
              <small>
                {t("dest.youAreAt")}
                {boardCode ? ` · ${t("board.fromBoard", { code: boardCode })}` : ""}
              </small>
              <strong>{placeName(start)}</strong>
              <PlaceBadges node={start} compact />
            </span>
            <button type="button" onClick={() => setStep("start")}>
              {t("dest.change")}
            </button>
          </div>
          {destinations.length > 0 && (
            <input
              className="place-search"
              type="search"
              value={placeQuery}
              onChange={(e) => setPlaceQuery(e.target.value)}
              placeholder={t("search.placeholder")}
              aria-label={t("search.label")}
            />
          )}
          {destinations.length === 0 ? (
            <div className="empty-state">
              <PinPlusIcon size={28} />
              <strong>{t("dest.emptyTitle")}</strong>
              <p>{t("dest.emptyText")}</p>
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
                    {a === "all" ? t("dest.allLocations") : t(`area.${a}`)}
                  </button>
                ))}
              </div>
            )}
            {destinationCategories.length > 1 && (
              <div className="filter-row" role="group" aria-label="Category">
                {[{ id: "all" }, ...destinationCategories].map(
                  (c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`filter-chip ${activeCategory === c.id ? "active" : ""}`}
                      onClick={() => setCategoryFilter(c.id)}
                    >
                      {c.id === "all" ? t("dest.allPlaces") : t(`cat.${c.id}` as MessageKey)}
                    </button>
                  )
                )}
              </div>
            )}
            {filteredDestinations.length === 0 && (
              <div className="empty-state">
                <strong>{placeQuery.trim() ? t("search.none", { q: placeQuery.trim() }) : t("dest.noMatch")}</strong>
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
                  }}
                >
                  <span className="dest-top">
                    <span className={`dest-icon ${placeTone(n.node_type)}`}>
                      <PlaceIcon type={n.node_type} />
                    </span>
                    {officialPlaceFor(n)?.zone && (
                      <span className="zone-badge">
                        {t("dest.zone", { zone: officialPlaceFor(n)?.zone ?? "" })}
                      </span>
                    )}
                  </span>
                  <strong>{placeLabel(n)}</strong>
                  {placeAltLabel(n) && <span className="dest-local">{placeAltLabel(n)}</span>}
                  <small>{categoryLabel(n.node_type)}</small>
                  <PlaceBadges node={n} compact />
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
            title={placeLabel(dest)}
            subtitle={t("arr.finished")}
            onBack={() => setStep("destination")}
            light
          />
          <div className="empty-route">
            <span className="status-orb ok" aria-hidden>
              ✓
            </span>
            <h3 className="status-title">{t("arr.title")}</h3>
            <p className="fine">{startIsDest ? t("arr.atDest") : t("arr.finalLane")}</p>
            <button
              type="button"
              className="btn primary wide"
              onClick={() => {
                setStep("home");
                setStart(null);
                setDest(null);
              }}
            >
              {t("arr.done")}
            </button>
          </div>
        </section>
      )}

      {step === "guide" && start && dest && route && !hasPath && !arrived && (
        <section className="screen guide">
          <TopBar
            title={placeLabel(dest)}
            subtitle={t("nr.from", { name: placeName(start) })}
            onBack={() => setStep("destination")}
            light
          />
          <div className="empty-route">
            <span className="status-orb warn" aria-hidden>
              <BlockIcon size={30} />
            </span>
            <h3 className="status-title">{t("nr.title")}</h3>
            <p className="fine">
              {packSource === "bundled" ? t("nr.noData") : t("nr.unreachable")}
            </p>
            <div className="far-advice">
              <p className="far-distance">
                {dist(haversineM(start.lat, start.lon, dest.lat, dest.lon))}
                <small>{t("nr.straight")}</small>
              </p>
              {officialPlaceFor(dest) && (
                <p className="far-tip">{officialPlaceFor(dest)?.getThere}</p>
              )}
              <p className="far-tip">{t("nr.ask")}</p>
              <p className="far-note">{t("nr.guidance")}</p>
            </div>
            <button
              type="button"
              className="btn primary wide"
              onClick={() => setStep("destination")}
            >
              {t("nr.pickAnother")}
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
                {t("nr.clearBlocks")}
              </button>
            )}
          </div>
        </section>
      )}

      {step === "guide" && start && dest && route && hasPath && !arrived && (
        <section className="screen flow map-guide">
          <TopBar
            title={placeLabel(dest)}
            subtitle={`${t("guide.toGo", { dist: dist(remainingM) })} · ${t("guide.eta", {
              min: walkMinutes(remainingM),
            })}${navState === "REROUTING" ? t("guide.rerouting") : ""}`}
            onBack={() => setStep("destination")}
          />

          <OfflineMap
            onMapTap={onSimMapTap}
            className="guide-map"
            places={registeredPlaces}
            route={routeCoords}
            mapRoads={routeMapRoads}
            startCode={start.code}
            destCode={dest.code}
            you={mapYou}
            followYou
          />

          <div className="guide-card">
            <p className="guide-now">{guideNow}</p>
            <p className="guide-next">
              {t("guide.next")} <strong>{placeLabel(nextNamed ?? dest)}</strong>
              {toNextM + laterToNamedM > 0 && <> · {dist(toNextM + laterToNamedM)}</>}
            </p>
            {usesMapRoads && (
              <p className="guide-gps warn">{t("guide.mapRoads")}</p>
            )}
            {(() => {
              const s = opStatus(dest);
              return s.kind === "closed" || s.kind === "limited" ? (
                <p className="guide-gps warn" role="status">
                  {t(s.kind === "closed" ? "guide.destClosed" : "guide.destLimited", { name: placeLabel(dest) })}
                  {s.note ? ` (${s.note})` : ""}
                </p>
              ) : null;
            })()}
            <p className="guide-gps">
              {simOn ? "[SIM] " : ""}
              {!mapYou && !gpsAllowed
                ? t("guide.locOff")
                : live.note
                  ? t(live.note.key, { acc: live.note.acc ?? "" })
                  : t("start.finding")}
            </p>
            {rerouteMsg && <p className="guide-gps warn">{rerouteMsg}</p>}
            {gpsMsg && <p className="guide-gps warn">{gpsMsg}</p>}
            <div className="guide-actions">
              <button type="button" className="btn primary" onClick={updatePositionFromGps}>
                {t("guide.reached")}
              </button>
              <button type="button" className="btn soft" onClick={reportPathBlocked}>
                {t("guide.blocked")}
              </button>
            </div>
          </div>

          <details className="guide-steps">
            <summary>{t("guide.allDirections", { n: pathInstructions.length })}</summary>
            <ol className="route-steps">
              {pathInstructions.map((ins, i) => {
                const line = instructionLines(lang, ins, (code) => {
                  const n = pack.nodes.find((x) => x.code === code);
                  return n ? placeName(n) : code;
                });
                return (
                  <li key={`${ins.text}-${i}`}>
                    <span className="dot" />
                    <div>
                      <strong>{line.text}</strong>
                      {line.detail && <small>{line.detail}</small>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </details>
        </section>
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
  const { t } = useI18n();
  return (
    <div className={`topbar ${light ? "light" : ""}`}>
      <button type="button" className="back" onClick={onBack} aria-label={t("app.back")}>
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
