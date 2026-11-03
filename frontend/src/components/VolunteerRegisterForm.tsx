import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { haversineM, isOsmPlaceCode, isRegisteredLocation, osmConfirmRadiusM, type QrNode } from "../lib/types";
import { isSecureEnough } from "../lib/network";
import { KUMBH_BOUNDS } from "../lib/mapArea";
import {
  OFFICIAL_PLACES,
  SITE_CATEGORIES,
  officialWarnRadiusM,
  siteCategory,
  type OfficialPlace,
} from "../lib/officialPlaces";
import { formatDistance } from "../lib/nearest";
import { useDeviceHeading } from "../hooks/useDeviceHeading";
import { authSender, sendOrQueue } from "../lib/outbox";
import { loadVolunteerData } from "../lib/volunteerData";
import { positionsSimulated, volunteerGeo } from "../lib/location/geo";
import { useI18n } from "../i18n/context";
import type { MessageKey } from "../i18n/messages";
import "./Volunteer.css";

type Props = {
  apiBase: string;
  onBack: () => void;
  onRegistered: (node: QrNode) => void;
};

type GpsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; lat: number; lon: number; accuracyM: number }
  | { status: "error"; message: string };

type DupInfo = { message: string; name?: string; code?: string };

/** A place is only saved from a fix at least this accurate. */
const MAX_REGISTER_ACCURACY_M = 30;

const PLACE_KINDS = [
  "ghat", "akhara", "tent_city", "medical", "temple", "toilet", "water",
  "parking", "lost_found", "transport", "help", "junction", "landmark",
] as const;


type Waypoint = {
  lat: number;
  lon: number;
  /** null until the compass is live — the server then uses the GPS track. */
  heading_deg: number | null;
  t_ms: number;
};

export function VolunteerRegisterForm({
  apiBase,
  onBack,
  onRegistered,
}: Props) {
  const heading = useDeviceHeading();
  const { t } = useI18n();
  const [locationName, setLocationName] = useState("");
  const [localName, setLocalName] = useState("");
  const [placeKind, setPlaceKind] = useState("ghat");
  const [gps, setGps] = useState<GpsState>({ status: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [dup, setDup] = useState<DupInfo | null>(null);
  const [done, setDone] = useState<QrNode | null>(null);
  const [existingPlaces, setExistingPlaces] = useState<QrNode[]>([]);
  // Until the list is here, an empty list does not mean "first place": saving
  // then would add a place with no lane (and skip the walk check).
  const [placesState, setPlacesState] = useState<"loading" | "ready" | "failed">("loading");
  const [connectTo, setConnectTo] = useState("");
  const [recording, setRecording] = useState(false);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [pathSaved, setPathSaved] = useState<"sent" | "queued" | null>(null);
  /** No internet: the place (and its walk) wait on this phone to be sent. */
  const [placeQueued, setPlaceQueued] = useState(false);
  /** False when an admin must publish before visitors see the place. */
  const [placeLive, setPlaceLive] = useState(true);
  const [placesFromPhone, setPlacesFromPhone] = useState(false);
  const [official, setOfficial] = useState<OfficialPlace | null>(null);
  /** Map place the volunteer said they are standing at ("This is …"). */
  const [confirmCode, setConfirmCode] = useState("");
  const watchRef = useRef<number | null>(null);
  const headingRef = useRef<number | null>(heading.heading);
  headingRef.current = heading.live ? heading.heading : null;

  // Only the newest location request may update the form.
  const gpsRequestRef = useRef(0);
  const requestGps = useCallback(() => {
    if (!isSecureEnough() && !positionsSimulated()) {
      setGps({ status: "error", message: t("vol.reg.gpsHttps") });
      return;
    }
    if (!volunteerGeo.available()) {
      setGps({ status: "error", message: t("vol.reg.noGps") });
      return;
    }
    setGps({ status: "loading" });
    const requestId = ++gpsRequestRef.current;
    volunteerGeo.getCurrentPosition(
      (pos) => {
        if (requestId !== gpsRequestRef.current) return;
        setGps({
          status: "ok",
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracyM: pos.coords.accuracy ?? 999,
        });
      },
      (err) => {
        if (requestId !== gpsRequestRef.current) return;
        const denied = err.code === err.PERMISSION_DENIED;
        setGps({
          status: "error",
          message: denied ? t("vol.reg.gpsDenied") : t("vol.reg.gpsFailed", { why: err.message }),
        });
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }, [t]);

  // The place is saved where the volunteer stands: get a fix right away.
  useEffect(() => {
    requestGps();
  }, [requestGps]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await loadVolunteerData(apiBase);
      if (cancelled) return;
      if (!data) {
        setPlacesState("failed");
        return;
      }
      const list = data.nodes.filter(isRegisteredLocation);
      setExistingPlaces(list);
      setPlacesState("ready");
      setPlacesFromPhone(data.fromPhone);
      if (list.length === 1) setConnectTo(list[0].code);
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const stopWatch = useCallback(() => {
    if (watchRef.current != null) {
      volunteerGeo.clearWatch(watchRef.current);
      watchRef.current = null;
    }
  }, []);

  useEffect(() => () => stopWatch(), [stopWatch]);

  const connectName =
    existingPlaces.find((n) => n.code === connectTo)?.name ?? connectTo;

  const registeredNames = new Set(
    existingPlaces.map((n) => n.name.trim().toLowerCase())
  );

  function chooseOfficial(id: string) {
    const place = OFFICIAL_PLACES.find((p) => p.id === id) ?? null;
    setOfficial(place);
    if (place) {
      setLocationName(place.name);
      setLocalName(place.local_name);
      setPlaceKind(place.node_type);
      return;
    }
    setLocationName("");
    setLocalName("");
  }

  // Same area as the offline map: a place outside it would have no map under it.
  const outsideNashik =
    gps.status === "ok" &&
    !(
      gps.lon >= KUMBH_BOUNDS[0] &&
      gps.lat >= KUMBH_BOUNDS[1] &&
      gps.lon <= KUMBH_BOUNDS[2] &&
      gps.lat <= KUMBH_BOUNDS[3]
    );

  // Unconfirmed OpenStreetMap places of this kind right here. Several can be
  // close together (temples 14 m apart), so the volunteer must pick one.
  const nearbyMapPlaces = useMemo(() => {
    if (gps.status !== "ok") return [];
    return existingPlaces
      .filter(
        (p) =>
          isOsmPlaceCode(p.code) &&
          p.gps_accuracy_m == null &&
          p.node_type === placeKind &&
          haversineM(gps.lat, gps.lon, p.lat, p.lon) <= osmConfirmRadiusM(p.code)
      )
      .map((p) => ({ place: p, distM: haversineM(gps.lat, gps.lon, p.lat, p.lon) }))
      .sort((a, b) => a.distM - b.distM);
  }, [existingPlaces, gps, placeKind]);
  // A choice that is no longer nearby (moved, changed kind) does not count.
  const chosenMapPlace = nearbyMapPlaces.find((m) => m.place.code === confirmCode)?.place ?? null;

  const offsetFromOfficialM =
    official && gps.status === "ok"
      ? haversineM(gps.lat, gps.lon, official.lat, official.lon)
      : null;

  function startPathRecording() {
    setFormError(null);
    if (!connectTo) {
      setFormError(t("vol.reg.selectStartFirst"));
      return;
    }
    if (!volunteerGeo.available()) {
      setFormError(t("vol.reg.gpsRequired"));
      return;
    }
    if (!isSecureEnough() && !positionsSimulated()) {
      setFormError(t("vol.reg.httpsForWalk"));
      return;
    }
    void heading.requestPermission();
    setWaypoints([]);
    setRecording(true);
    watchRef.current = volunteerGeo.watchPosition(
      (pos) => {
        const next: Waypoint = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          heading_deg: headingRef.current,
          t_ms: Date.now(),
        };
        setWaypoints((prev) => {
          if (prev.length === 0) return [next];
          const last = prev[prev.length - 1];
          const dt = next.t_ms - last.t_ms;
          const moved =
            Math.hypot(
              (next.lat - last.lat) * 111320,
              (next.lon - last.lon) *
                111320 *
                Math.cos((next.lat * Math.PI) / 180)
            ) > 1.5;
          if (dt < 2000 && !moved) return prev;
          return [...prev, next];
        });
      },
      (e) => {
        setFormError(
          e.code === e.PERMISSION_DENIED ? t("vol.reg.allowLocationWalk") : t("vol.reg.gpsError", { why: e.message })
        );
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
  }

  function stopPathRecording() {
    stopWatch();
    setRecording(false);
    // The walk ends at the new place: refresh its position.
    requestGps();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setDup(null);

    if (gps.status !== "ok") {
      setFormError(t("vol.reg.waitGps"));
      return;
    }
    if (gps.accuracyM > MAX_REGISTER_ACCURACY_M) {
      setFormError(t("vol.reg.tooRough", { m: Math.round(gps.accuracyM), max: MAX_REGISTER_ACCURACY_M }));
      return;
    }
    if (outsideNashik) {
      setFormError(t("vol.reg.outside"));
      return;
    }
    const { lat, lon } = gps;
    if (!locationName.trim() || !localName.trim()) {
      setFormError(t("vol.reg.namesRequired"));
      return;
    }
    if (existingPlaces.length > 0 && !connectTo) {
      setFormError(t("vol.reg.chooseStart"));
      return;
    }
    if (existingPlaces.length > 0 && waypoints.length < 2) {
      setFormError(t("vol.reg.recordFirst"));
      return;
    }
    if (recording) {
      setFormError(t("vol.reg.stopFirst"));
      return;
    }

    setSubmitting(true);
    try {
      const send = authSender(apiBase);
      const name = locationName.trim();
      const reg = await sendOrQueue(
        "/api/volunteer/register",
        {
          location_name: name,
          local_name: localName.trim(),
          lat,
          lon,
          gps_accuracy_m: Math.round(gps.accuracyM * 10) / 10,
          node_type: placeKind,
          confirm_code: chosenMapPlace?.code ?? null,
          connect_to_code: connectTo || null,
          // Lane headings come from the recorded walk (record-path below).
          // The last walk sample faces *away* from the previous place, so it
          // must not be sent as "facing previous".
          path_heading_deg: null,
          simulated: positionsSimulated(),
        },
        { label: `Register ${name}`, labelKey: "vol.label.register", labelVars: { name } },
        send
      );
      if (reg.kind === "refused") {
        const data = reg.data as { success?: boolean; message?: string; existing_name?: string; node?: QrNode } | null;
        if (data?.success === false) {
          setDup({
            message: data.message || t("vol.reg.dupTitle"),
            name: data.existing_name || data.node?.name,
            code: data.node?.code,
          });
        } else {
          setFormError(reg.message);
        }
        return;
      }

      const walk = connectTo && waypoints.length >= 2;
      const walkLabel = `Walk ${connectName} → ${name}`;
      const walkLabelKey = { labelKey: "vol.label.walk" as const, labelVars: { from: connectName, to: name } };
      if (reg.kind === "queued") {
        // The walk ends at the new place, whose code the server gives: it is
        // sent right after the place, with that code filled in.
        if (walk) {
          await sendOrQueue(
            "/api/volunteer/record-path",
            { from_code: connectTo, to_code: null, waypoints, simulated: positionsSimulated() },
            {
              label: walkLabel,
              ...walkLabelKey,
              queueOnly: true,
              dependsOn: { id: reg.item.id, fields: ["to_code"] },
            },
            send
          );
        }
        setPlaceQueued(true);
        setPathSaved(walk ? "queued" : null);
        setDone({
          code: "",
          name,
          local_name: localName.trim(),
          lat,
          lon,
          gps_accuracy_m: gps.accuracyM,
          node_type: placeKind,
        } as QrNode);
        return;
      }

      const node = (reg.data as { node: QrNode }).node;
      setPlaceLive((reg.data as { live?: boolean }).live !== false);
      let path: "sent" | "queued" | null = null;
      if (walk) {
        const pr = await sendOrQueue(
          "/api/volunteer/record-path",
          { from_code: connectTo, to_code: node.code, waypoints, simulated: positionsSimulated() },
          { label: walkLabel, ...walkLabelKey },
          send
        );
        path = pr.kind === "sent" ? "sent" : pr.kind === "queued" ? "queued" : null;
        if (pr.kind === "refused") setFormError(t("vol.reg.walkRefused", { why: pr.message }));
      }

      setPathSaved(path);
      setDone(node);
      onRegistered(node);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("vol.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  if (dup) {
    return (
      <section className="screen flow volunteer-screen">
        <div className="volunteer-card warn">
          <h2>{t("vol.reg.dupTitle")}</h2>
          <p>
            {t("vol.reg.dupBody")}
            <br />
            <strong>{dup.name ?? t("vol.reg.aLocation")}</strong>
            {dup.code ? ` (${dup.code})` : ""}
          </p>
          <button type="button" className="btn primary" onClick={onBack}>
            {t("vol.reg.close")}
          </button>
        </div>
      </section>
    );
  }

  if (done) {
    return (
      <section className="screen flow volunteer-screen">
        <header className="volunteer-head">
          <button type="button" className="back" onClick={onBack} aria-label={t("vol.back")}>
            ←
          </button>
          <div>
            <h2>{placeQueued ? t("vol.reg.savedPhoneTitle") : t("vol.reg.registeredTitle")}</h2>
            <p>
              {placeQueued
                ? t("vol.reg.savedPhoneSub")
                : placeLive
                  ? t("vol.reg.registeredSub")
                  : t("vol.reg.registeredSubPending")}
            </p>
          </div>
        </header>

        <div className="volunteer-card success">
          <h2>{placeQueued ? t("vol.reg.savedPhoneCard") : t("vol.reg.registeredCard")}</h2>
          <p className="volunteer-meta">
            <strong>{t("vol.reg.fPlace")}</strong> {done.name}
            <br />
            <strong>{t("vol.reg.fLocal")}</strong> {done.local_name || "—"}
            <br />
            <strong>{t("vol.reg.fCoords")}</strong> {done.lat.toFixed(6)},{" "}
            {done.lon.toFixed(6)}
            {done.gps_accuracy_m != null && <> (±{Math.round(done.gps_accuracy_m)} m)</>}
            <br />
            {done.code && (
              <>
                <strong>{t("vol.reg.fCode")}</strong> {done.code}
              </>
            )}
            {pathSaved && (
              <>
                <br />
                <strong>{t("vol.reg.fPath")}</strong>{" "}
                {t(pathSaved === "sent" ? "vol.reg.pathSent" : "vol.reg.pathQueued", { n: waypoints.length })}
              </>
            )}
          </p>

          {formError && <p className="gps-status err">{formError}</p>}

          <p className="field-hint">{t("vol.reg.cornerHint")}</p>

          <div className="volunteer-actions">
            <button type="button" className="btn primary" onClick={onBack}>
              ← {t("vol.back")}
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="screen flow volunteer-screen">
      <header className="volunteer-head">
        <button type="button" className="back" onClick={onBack} aria-label={t("vol.back")}>
          ←
        </button>
        <div>
          <h2>{t("vol.reg.title")}</h2>
          <p>{t("vol.reg.subtitle")}</p>
        </div>
      </header>

      <form className="volunteer-form" onSubmit={onSubmit}>
        {placesFromPhone && (
          <p className="field-hint">{t("vol.reg.offlinePlaces")}</p>
        )}
        <label>
          {t("vol.reg.official")}
          <select
            value={official?.id ?? ""}
            onChange={(e) => chooseOfficial(e.target.value)}
            disabled={recording}
          >
            <option value="">{t("vol.reg.otherPlace")}</option>
            {SITE_CATEGORIES.map((c) => {
              const places = OFFICIAL_PLACES.filter(
                (p) => siteCategory(p.node_type) === c.id
              );
              if (places.length === 0) return null;
              return (
                <optgroup key={c.id} label={t(`cat.${c.id}` as MessageKey)}>
                  {places.map((p) => {
                    const taken = registeredNames.has(p.name.toLowerCase());
                    return (
                      <option key={p.id} value={p.id} disabled={taken}>
                        {p.name} — {p.local_name}
                        {taken ? t("vol.reg.alreadyAdded") : ""}
                      </option>
                    );
                  })}
                </optgroup>
              );
            })}
          </select>
        </label>
        <p className="field-hint">{t("vol.reg.officialHint")}</p>

        <label>
          {t("vol.reg.placeName")}
          <input
            value={locationName}
            onChange={(e) => setLocationName(e.target.value)}
            placeholder={t("vol.reg.placeNameEg")}
            readOnly={!!official}
            required
          />
        </label>

        <label>
          {t("vol.reg.kind")}
          <select
            value={placeKind}
            onChange={(e) => setPlaceKind(e.target.value)}
            disabled={!!official}
          >
            {PLACE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`vol.reg.kind.${k}`)}
              </option>
            ))}
          </select>
        </label>

        <label>
          {t("vol.reg.localName")}
          <input
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            placeholder={t("vol.reg.localNameEg")}
            required
          />
        </label>

        {nearbyMapPlaces.length > 0 && (
          <div className="map-confirm">
            <p className="section-label">{t("vol.reg.onMap")}</p>
            <p className="field-hint">{t("vol.reg.onMapHint")}</p>
            {nearbyMapPlaces.map(({ place, distM }) => {
              const picked = place.code === chosenMapPlace?.code;
              return (
                <button
                  key={place.code}
                  type="button"
                  className={`btn soft block ${picked ? "picked" : ""}`}
                  aria-pressed={picked}
                  onClick={() => {
                    setConfirmCode(picked ? "" : place.code);
                    if (!picked && !official) setLocationName(place.name);
                    if (!picked && !official && !localName && place.local_name) {
                      setLocalName(place.local_name);
                    }
                  }}
                >
                  {picked ? "✓ " : ""}
                  {t("vol.reg.thisIs", { name: place.name, dist: formatDistance(distM) })}
                </button>
              );
            })}
          </div>
        )}

        <div className="coord-block">
          <p className="section-label">{t("vol.reg.locLabel")}</p>
          <p className="field-hint">{t("vol.reg.locHint")}</p>
          {gps.status === "loading" && <p className="gps-status">{t("vol.reg.gettingLoc")}</p>}
          {gps.status === "error" && <p className="gps-status err">{gps.message}</p>}
          {gps.status === "ok" && (
            <p
              className={`gps-status ${
                gps.accuracyM > MAX_REGISTER_ACCURACY_M || outsideNashik ? "err" : "ok"
              }`}
            >
              {outsideNashik
                ? t("vol.reg.outside")
                : gps.accuracyM > MAX_REGISTER_ACCURACY_M
                  ? t("vol.reg.roughShort", { m: Math.round(gps.accuracyM) })
                  : `✓ ${gps.lat.toFixed(6)}, ${gps.lon.toFixed(6)} · ±${Math.round(gps.accuracyM)} m`}
            </p>
          )}
          {official && offsetFromOfficialM != null &&
            offsetFromOfficialM > officialWarnRadiusM(official) && (
            <p className="gps-status warn">
              {t("vol.reg.farFromOfficial", { dist: formatDistance(offsetFromOfficialM), name: official.name })}
            </p>
          )}
          {official && official.coordQuality === "approximate" && (
            <p className="field-hint">{t("vol.reg.approxOfficial", { name: official.name })}</p>
          )}

          <button
            type="button"
            className="btn soft block"
            onClick={requestGps}
            disabled={gps.status === "loading" || recording}
          >
            {gps.status === "loading" ? t("vol.reg.gettingLocBtn") : t("vol.reg.refreshLoc")}
          </button>
        </div>

        {existingPlaces.length > 0 && (
          <div className="coord-block path-route-block">
            <p className="section-label">{t("vol.reg.recordLabel")}</p>
            <p className="field-hint">{t("vol.reg.recordHint")}</p>

            <label>
              {t("vol.reg.start")}
              <select
                value={connectTo}
                onChange={(e) => {
                  setConnectTo(e.target.value);
                  setWaypoints([]);
                  stopPathRecording();
                }}
                required
                disabled={recording}
              >
                <option value="">{t("vol.reg.selectStart")}</option>
                {existingPlaces.map((n) => (
                  <option key={n.code} value={n.code}>
                    {n.name}
                    {n.local_name ? ` (${n.local_name})` : ""} — {n.code}
                  </option>
                ))}
              </select>
            </label>

            <label>
              {t("vol.reg.dest")}
              <input
                value={
                  locationName.trim()
                    ? t("vol.reg.newPlace", {
                        name: `${locationName.trim()}${localName.trim() ? ` (${localName.trim()})` : ""}`,
                      })
                    : t("vol.reg.typeDest")
                }
                readOnly
                disabled
              />
            </label>

            {connectTo && (
              <>
                <p className="gps-status">
                  {t("vol.reg.route", { from: connectName, to: locationName.trim() || t("vol.reg.destNew") })}
                </p>
                <p className="field-hint">
                  {t("vol.reg.step1", { name: connectName })}
                  <br />
                  {t("vol.reg.step2")}
                  <br />
                  {t("vol.reg.step3")}
                  <br />
                  {t("vol.reg.step4")}
                </p>
                <p className="gps-status">
                  {t("vol.reg.compass", { deg: heading.heading.toFixed(0), note: heading.note })}
                  {recording
                    ? t("vol.reg.recordingN", { n: waypoints.length })
                    : waypoints.length >= 2
                      ? t("vol.reg.readyN", { n: waypoints.length })
                      : ""}
                </p>
                {!heading.secure && <p className="gps-status err">{t("vol.reg.compassHttps")}</p>}
                <button
                  type="button"
                  className="btn soft block"
                  onClick={() => void heading.requestPermission()}
                >
                  {t("vol.enableCompass")}
                </button>
                {!recording ? (
                  <button
                    type="button"
                    className="btn primary block"
                    onClick={startPathRecording}
                  >
                    {t("vol.reg.startRec")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn secondary block"
                    onClick={stopPathRecording}
                  >
                    {t("vol.reg.stopRec", { n: waypoints.length })}
                  </button>
                )}
                {waypoints.length >= 2 && !recording && (
                  <p className="gps-status ok">{t("vol.reg.recorded")}</p>
                )}
              </>
            )}
          </div>
        )}

        {placesState === "ready" && existingPlaces.length === 0 && (
          <p className="field-hint">{t("vol.reg.firstPlace")}</p>
        )}
        {placesState === "loading" && <p className="field-hint">{t("vol.reg.placesLoading")}</p>}
        {placesState === "failed" && <p className="gps-status err">{t("vol.reg.placesFailed")}</p>}

        {formError && <p className="gps-status err">{formError}</p>}

        <button
          type="submit"
          className="btn primary block"
          disabled={submitting || gps.status !== "ok" || recording || placesState !== "ready"}
        >
          {submitting
            ? t("vol.saving")
            : existingPlaces.length > 0
              ? t("vol.reg.saveWithPath")
              : t("vol.reg.save")}
        </button>
      </form>
    </section>
  );
}
