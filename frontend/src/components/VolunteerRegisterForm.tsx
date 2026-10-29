import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { haversineM, locationBoardLink, type QrNode } from "../lib/types";
import {
  OFFICIAL_PLACES,
  SITE_CATEGORIES,
  siteCategory,
  type OfficialPlace,
} from "../lib/officialPlaces";
import { usePhoneAppBase } from "../hooks/usePhoneAppBase";
import { useDeviceHeading } from "../hooks/useDeviceHeading";
import "./Volunteer.css";

type Props = {
  apiBase: string;
  onBack: () => void;
  onRegistered: (node: QrNode) => void;
};

type GpsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; lat: number; lon: number }
  | { status: "error"; message: string };

type DupInfo = { message: string; name?: string; code?: string };

type Waypoint = {
  lat: number;
  lon: number;
  heading_deg: number;
  t_ms: number;
};

function isSecureEnough(): boolean {
  if (typeof window === "undefined") return false;
  if (window.isSecureContext) return true;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

export function VolunteerRegisterForm({
  apiBase,
  onBack,
  onRegistered,
}: Props) {
  const phoneOrigin = usePhoneAppBase();
  const heading = useDeviceHeading();
  const [locationName, setLocationName] = useState("");
  const [localName, setLocalName] = useState("");
  const [placeKind, setPlaceKind] = useState("ghat");
  const [latText, setLatText] = useState("");
  const [lonText, setLonText] = useState("");
  const [gps, setGps] = useState<GpsState>({ status: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [dup, setDup] = useState<DupInfo | null>(null);
  const [done, setDone] = useState<QrNode | null>(null);
  const [existingPlaces, setExistingPlaces] = useState<QrNode[]>([]);
  const [connectTo, setConnectTo] = useState("");
  const [recording, setRecording] = useState(false);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [pathSaved, setPathSaved] = useState(false);
  const [official, setOfficial] = useState<OfficialPlace | null>(null);
  // GPS callbacks read this so they never overwrite official coordinates.
  const officialRef = useRef<OfficialPlace | null>(null);
  officialRef.current = official;
  // True only after the volunteer taps "Use my live location". Typing a
  // coordinate switches back to manual so GPS never overwrites it.
  const [useLive, setUseLive] = useState(false);
  const useLiveRef = useRef(false);
  useLiveRef.current = useLive;
  const printRef = useRef<HTMLDivElement>(null);
  const watchRef = useRef<number | null>(null);
  const headingRef = useRef(heading.heading);
  headingRef.current = heading.heading;

  const requestGps = useCallback(() => {
    if (!isSecureEnough()) {
      setGps({
        status: "error",
        message:
          "This page is not on trusted HTTPS, so the browser blocks GPS. Open the Volunteer QR link (ngrok https://… URL with a padlock), allow Location, then Retry — or type coordinates below.",
      });
      return;
    }
    if (!navigator.geolocation) {
      setGps({
        status: "error",
        message:
          "Geolocation is not supported in this browser. Enter coordinates manually.",
      });
      return;
    }
    setGps({ status: "loading" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        if (!officialRef.current && useLiveRef.current) {
          setLatText(lat.toFixed(6));
          setLonText(lon.toFixed(6));
        }
        setGps({ status: "ok", lat, lon });
      },
      (err) => {
        const denied = err.code === err.PERMISSION_DENIED;
        setGps({
          status: "error",
          message: denied
            ? "Location permission was denied. Allow location for this site, or type latitude/longitude below."
            : `Could not get location (${err.message}). Retry or enter coordinates manually.`,
        });
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }, []);

  // Browser asks for location permission only when the volunteer opts in.
  function chooseLiveLocation() {
    useLiveRef.current = true;
    setUseLive(true);
    requestGps();
  }

  function typeCoordinate(setter: (v: string) => void, value: string) {
    useLiveRef.current = false;
    setUseLive(false);
    setter(value);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/pack/latest/json`);
        if (!res.ok) return;
        const data = (await res.json()) as { nodes?: QrNode[] };
        const list = (data.nodes ?? [])
          .filter((n) => n.code.trim().toUpperCase() !== "VOLUNTEER_REGISTER")
          .sort((a, b) => a.name.localeCompare(b.name));
        if (!cancelled) {
          setExistingPlaces(list);
          if (list.length === 1) setConnectTo(list[0].code);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const stopWatch = useCallback(() => {
    if (watchRef.current != null) {
      navigator.geolocation.clearWatch(watchRef.current);
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
      setLatText(place.lat.toFixed(6));
      setLonText(place.lon.toFixed(6));
      return;
    }
    setLocationName("");
    setLocalName("");
    if (useLive && gps.status === "ok") {
      setLatText(gps.lat.toFixed(6));
      setLonText(gps.lon.toFixed(6));
    } else {
      setLatText("");
      setLonText("");
    }
  }

  const offsetFromOfficialM =
    official && gps.status === "ok"
      ? haversineM(gps.lat, gps.lon, official.lat, official.lon)
      : null;

  function startPathRecording() {
    setFormError(null);
    if (!connectTo) {
      setFormError("Select the previous board first.");
      return;
    }
    if (!navigator.geolocation) {
      setFormError("GPS is required to record the verified path.");
      return;
    }
    if (!isSecureEnough()) {
      setFormError("Open the HTTPS (ngrok) link so GPS and compass work.");
      return;
    }
    void heading.requestPermission();
    setWaypoints([]);
    setRecording(true);
    watchRef.current = navigator.geolocation.watchPosition(
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
          e.code === e.PERMISSION_DENIED
            ? "Allow location to record the walk."
            : `GPS error: ${e.message}`
        );
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
  }

  function stopPathRecording() {
    stopWatch();
    setRecording(false);
    // Refresh GPS at the end of the walk (new board position) — only if the
    // volunteer chose live location; typed coordinates stay as typed.
    if (useLiveRef.current) requestGps();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setDup(null);

    const lat = Number.parseFloat(latText);
    const lon = Number.parseFloat(lonText);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      setFormError("Enter latitude and longitude, or tap Use my live location.");
      return;
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setFormError("Coordinates out of range.");
      return;
    }
    if (!locationName.trim() || !localName.trim()) {
      setFormError("Please enter Location Name and Local Name.");
      return;
    }
    if (existingPlaces.length > 0 && !connectTo) {
      setFormError("Choose a Starting point (the board you walk from).");
      return;
    }
    if (existingPlaces.length > 0 && waypoints.length < 2) {
      setFormError(
        "Record the lane: stand at the starting place, start recording, walk the mela lane to the destination, stop, then submit."
      );
      return;
    }
    if (recording) {
      setFormError("Stop path recording before submitting.");
      return;
    }

    setSubmitting(true);
    try {
      const pathHeading =
        waypoints.length > 0
          ? waypoints[waypoints.length - 1].heading_deg
          : null;

      const res = await fetch(`${apiBase}/api/volunteer/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location_name: locationName.trim(),
          local_name: localName.trim(),
          lat,
          lon,
          node_type: placeKind,
          connect_to_code: connectTo || null,
          path_heading_deg: pathHeading,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(
          typeof data?.detail === "string"
            ? data.detail
            : data?.detail?.message || "Registration failed"
        );
        return;
      }
      if (!data.success) {
        setDup({
          message: data.message || "QR is already registered",
          name: data.existing_name || data.node?.name,
          code: data.node?.code,
        });
        return;
      }

      const node = data.node as QrNode;
      let verified = false;
      if (connectTo && waypoints.length >= 2) {
        try {
          const pr = await fetch(`${apiBase}/api/volunteer/record-path`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              from_code: connectTo,
              to_code: node.code,
              waypoints,
            }),
          });
          const pdata = await pr.json();
          verified = pr.ok && !!pdata.success;
        } catch {
          verified = false;
        }
      }

      setPathSaved(verified);
      setDone(node);
      onRegistered(node);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  function savePng(node: QrNode) {
    const canvas = document.getElementById(
      "volunteer-location-qr-canvas"
    ) as HTMLCanvasElement | null;
    if (!canvas) return;
    const link = document.createElement("a");
    const safe = node.name.replace(/[^a-zA-Z0-9_-]+/g, "-");
    link.download = `${node.code}-${safe}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  function printQr() {
    window.print();
  }

  if (dup) {
    return (
      <section className="screen flow volunteer-screen">
        <div className="volunteer-card warn">
          <h2>⚠ QR is already registered</h2>
          <p>
            This QR is already associated with:
            <br />
            <strong>{dup.name ?? "a location"}</strong>
            {dup.code ? ` (${dup.code})` : ""}
          </p>
          <button type="button" className="btn primary" onClick={onBack}>
            Close
          </button>
        </div>
      </section>
    );
  }

  if (done) {
    return (
      <section className="screen flow volunteer-screen">
        <header className="volunteer-head no-print">
          <button type="button" className="back" onClick={onBack} aria-label="Back">
            ←
          </button>
          <div>
            <h2>Registered</h2>
            <p>Save or print the QR, then go back</p>
          </div>
        </header>

        <div className="volunteer-card success" ref={printRef}>
          <h2>✓ Location registered successfully</h2>
          <p className="volunteer-meta">
            <strong>Location:</strong> {done.name}
            <br />
            <strong>Local Name:</strong> {done.local_name || "—"}
            <br />
            <strong>Coordinates:</strong> {done.lat.toFixed(6)},{" "}
            {done.lon.toFixed(6)}
            <br />
            <strong>QR Code:</strong> {done.code}
            {pathSaved && (
              <>
                <br />
                <strong>Verified path:</strong> saved ({waypoints.length}{" "}
                samples)
              </>
            )}
          </p>

          <p className="field-hint no-print">
            Path turns a corner? Register another board at the corner and record
            that walk too.
          </p>

          <div className="volunteer-qr-print" id="volunteer-print-area">
            <QRCodeCanvas
              id="volunteer-location-qr-canvas"
              value={locationBoardLink(done.code, phoneOrigin)}
              size={280}
              level="M"
              includeMargin
              bgColor="#ffffff"
              fgColor="#14201c"
            />
            <p className="print-title">{done.name}</p>
            <p className="print-sub">
              {done.local_name ? `${done.local_name} · ` : ""}
              {done.code}
            </p>
            <p className="print-hint">Scan to start navigation</p>
            <p
              className="print-sub no-print"
              style={{ fontSize: "0.7rem", wordBreak: "break-all" }}
            >
              {locationBoardLink(done.code, phoneOrigin)}
            </p>
          </div>

          <div className="volunteer-actions no-print">
            <button type="button" className="btn primary" onClick={printQr}>
              Print QR
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => savePng(done)}
            >
              Save QR
            </button>
            <button type="button" className="btn soft" onClick={onBack}>
              ← Back
            </button>
          </div>
        </div>
      </section>
    );
  }

  const coordsReady =
    Number.isFinite(Number.parseFloat(latText)) &&
    Number.isFinite(Number.parseFloat(lonText));
  // Rough box around Nashik city, Trimbakeshwar and the outer parkings.
  const outsideNashik =
    coordsReady &&
    !(
      Number.parseFloat(latText) >= 19.8 &&
      Number.parseFloat(latText) <= 20.2 &&
      Number.parseFloat(lonText) >= 73.4 &&
      Number.parseFloat(lonText) <= 74.0
    );

  return (
    <section className="screen flow volunteer-screen">
      <header className="volunteer-head">
        <button type="button" className="back" onClick={onBack}>
          ←
        </button>
        <div>
          <h2>Register a Kumbh place</h2>
          <p>Ghat, akhara, camp, or gate — then walk the mela lane</p>
        </div>
      </header>

      <form className="volunteer-form" onSubmit={onSubmit}>
        <label>
          Official Kumbh place
          <select
            value={official?.id ?? ""}
            onChange={(e) => chooseOfficial(e.target.value)}
            disabled={recording}
          >
            <option value="">Other place…</option>
            {SITE_CATEGORIES.map((c) => {
              const places = OFFICIAL_PLACES.filter(
                (p) => siteCategory(p.node_type) === c.id
              );
              if (places.length === 0) return null;
              return (
                <optgroup key={c.id} label={c.label}>
                  {places.map((p) => {
                    const taken = registeredNames.has(p.name.toLowerCase());
                    return (
                      <option key={p.id} value={p.id} disabled={taken}>
                        {p.name} — {p.local_name}
                        {taken ? " (already added)" : ""}
                      </option>
                    );
                  })}
                </optgroup>
              );
            })}
          </select>
        </label>
        <p className="field-hint">
          Pick an official place to fill the details, or choose “Other place”
          for lane corners, camps, and help desks.
        </p>

        <label>
          Place name
          <input
            value={locationName}
            onChange={(e) => setLocationName(e.target.value)}
            placeholder="e.g. Ram Kund Ghat"
            readOnly={!!official}
            required
          />
        </label>

        <label>
          Kind of place
          <select
            value={placeKind}
            onChange={(e) => setPlaceKind(e.target.value)}
            disabled={!!official}
          >
            <option value="ghat">Ghat</option>
            <option value="akhara">Akhara</option>
            <option value="tent_city">Tent city</option>
            <option value="medical">Medical camp</option>
            <option value="toilet">Toilet block</option>
            <option value="parking">Parking</option>
            <option value="lost_found">Lost and found</option>
            <option value="transport">Transport hub</option>
            <option value="help">Help desk</option>
            <option value="junction">Lane corner</option>
            <option value="landmark">Other landmark</option>
          </select>
        </label>

        <label>
          Local name
          <input
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            placeholder="e.g. राम कुंड"
            required
          />
        </label>

        <div className="coord-block">
          <p className="section-label">
            {official
              ? "Official coordinates"
              : "Coordinates of this place"}
          </p>
          {!official && (
            <p className="field-hint">
              Type the latitude and longitude, or tap{" "}
              <strong>Use my live location</strong> while standing at the place.
              Your phone will ask for location permission.
            </p>
          )}
          {official && offsetFromOfficialM != null && (
            <p
              className={`gps-status ${offsetFromOfficialM > 150 ? "err" : "ok"}`}
            >
              {offsetFromOfficialM > 150
                ? `You are ${Math.round(offsetFromOfficialM)} m from ${official.name}. Put the board up at the place itself before saving.`
                : `✓ You are ${Math.round(offsetFromOfficialM)} m from the official point`}
            </p>
          )}
          {useLive && gps.status === "loading" && (
            <p className="gps-status">Getting your current location…</p>
          )}
          {useLive && !official && gps.status === "ok" && (
            <p className="gps-status ok">✓ Filled from your live location</p>
          )}
          {useLive && gps.status === "error" && (
            <p className="gps-status err">{gps.message}</p>
          )}

          <div className="coord-fields">
            <label>
              Latitude
              <input
                inputMode="decimal"
                value={latText}
                onChange={(e) => typeCoordinate(setLatText, e.target.value)}
                placeholder="e.g. 19.997500"
                readOnly={!!official}
                required
              />
            </label>
            <label>
              Longitude
              <input
                inputMode="decimal"
                value={lonText}
                onChange={(e) => typeCoordinate(setLonText, e.target.value)}
                placeholder="e.g. 73.789800"
                readOnly={!!official}
                required
              />
            </label>
          </div>

          {outsideNashik && (
            <p className="gps-status err">
              These coordinates are outside the Nashik Kumbh area. Check them,
              or stand at the place and use your live location.
            </p>
          )}

          <button
            type="button"
            className="btn soft block"
            onClick={chooseLiveLocation}
            disabled={(useLive && gps.status === "loading") || recording}
          >
            {useLive && gps.status === "loading"
              ? "Getting location…"
              : official
                ? "Check I am at this place (live location)"
                : useLive && gps.status === "ok"
                  ? "Refresh live location"
                  : "Use my live location"}
          </button>
        </div>

        {existingPlaces.length > 0 && (
          <div className="coord-block path-route-block">
            <p className="section-label">Record path (start → destination)</p>
            <p className="field-hint">
              There is no mela map. Walk the real lane once, around crowds,
              barricades, and tents. Visitors are guided along that walk.
            </p>

            <label>
              Starting point
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
                <option value="">Select starting board…</option>
                {existingPlaces.map((n) => (
                  <option key={n.code} value={n.code}>
                    {n.name}
                    {n.local_name ? ` (${n.local_name})` : ""} — {n.code}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Destination
              <input
                value={
                  locationName.trim()
                    ? `${locationName.trim()}${
                        localName.trim() ? ` (${localName.trim()})` : ""
                      } — new board`
                    : "Type Destination name above…"
                }
                readOnly
                disabled
              />
            </label>

            {connectTo && (
              <>
                <p className="gps-status">
                  Route: <strong>{connectName}</strong> →{" "}
                  <strong>
                    {locationName.trim() || "Destination (new board)"}
                  </strong>
                </p>
                <p className="field-hint">
                  1) Stand at <strong>Starting point</strong> ({connectName})
                  <br />
                  2) Tap <strong>Start recording walk</strong>
                  <br />
                  3) Walk to the <strong>destination</strong> along the real mela lane, around tents and barricades.
                  <br />
                  4) Tap <strong>Stop recording</strong>, check GPS, Submit
                </p>
                <p className="gps-status">
                  Compass: {heading.heading.toFixed(0)}° · {heading.note}
                  {recording
                    ? ` · recording (${waypoints.length} samples)`
                    : waypoints.length >= 2
                      ? ` · path ready (${waypoints.length} samples)`
                      : ""}
                </p>
                {!heading.secure && (
                  <p className="gps-status err">
                    Needs HTTPS (ngrok) for compass — use phone link with
                    padlock.
                  </p>
                )}
                <button
                  type="button"
                  className="btn soft block"
                  onClick={() => void heading.requestPermission()}
                >
                  Enable compass / gyroscope
                </button>
                {!recording ? (
                  <button
                    type="button"
                    className="btn primary block"
                    onClick={startPathRecording}
                  >
                    Start recording walk
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn secondary block"
                    onClick={stopPathRecording}
                  >
                    Stop recording ({waypoints.length} samples)
                  </button>
                )}
                {waypoints.length >= 2 && !recording && (
                  <p className="gps-status ok">
                    ✓ Path recorded — obstacles avoided by your walk
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {existingPlaces.length === 0 && (
          <p className="field-hint">
            First board: no path yet. After this, register the next place and
            record Starting point → Destination.
          </p>
        )}

        {formError && <p className="gps-status err">{formError}</p>}

        <button
          type="submit"
          className="btn primary block"
          disabled={submitting || !coordsReady || recording}
        >
          {submitting
            ? "Saving…"
            : existingPlaces.length > 0
              ? "Save destination + recorded path"
              : "Save destination"}
        </button>
      </form>
    </section>
  );
}
