import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { locationBoardLink, type QrNode } from "../lib/types";
import { usePhoneAppBase } from "../hooks/usePhoneAppBase";
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
  const [locationName, setLocationName] = useState("");
  const [localName, setLocalName] = useState("");
  const [latText, setLatText] = useState("");
  const [lonText, setLonText] = useState("");
  const [gps, setGps] = useState<GpsState>({ status: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [dup, setDup] = useState<DupInfo | null>(null);
  const [done, setDone] = useState<QrNode | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

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
        setLatText(lat.toFixed(6));
        setLonText(lon.toFixed(6));
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

  useEffect(() => {
    requestGps();
  }, [requestGps]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setDup(null);

    const lat = Number.parseFloat(latText);
    const lon = Number.parseFloat(lonText);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      setFormError("Enter valid latitude and longitude (or allow GPS).");
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

    setSubmitting(true);
    try {
      const res = await fetch(`${apiBase}/api/volunteer/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location_name: locationName.trim(),
          local_name: localName.trim(),
          lat,
          lon,
          node_type: "landmark",
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
      setDone(data.node as QrNode);
      onRegistered(data.node as QrNode);
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

  return (
    <section className="screen flow volunteer-screen">
      <header className="volunteer-head">
        <button type="button" className="back" onClick={onBack}>
          ←
        </button>
        <div>
          <h2>Register Location</h2>
          <p>Stand at the place, allow GPS, then submit</p>
        </div>
      </header>

      <form className="volunteer-form" onSubmit={onSubmit}>
        <label>
          Location Name
          <input
            value={locationName}
            onChange={(e) => setLocationName(e.target.value)}
            placeholder="e.g. Ram Kund Ghat"
            required
          />
        </label>

        <div className="coord-block">
          <p className="section-label">Coordinates (from device GPS)</p>
          {gps.status === "loading" && (
            <p className="gps-status">Getting your current location…</p>
          )}
          {gps.status === "ok" && (
            <p className="gps-status ok">✓ Location detected from GPS</p>
          )}
          {gps.status === "error" && (
            <p className="gps-status err">{gps.message}</p>
          )}
          {gps.status === "idle" && (
            <p className="gps-status">Waiting to request location…</p>
          )}

          <div className="coord-fields">
            <label>
              Latitude
              <input
                inputMode="decimal"
                value={latText}
                onChange={(e) => setLatText(e.target.value)}
                placeholder="e.g. 19.997500"
                required
              />
            </label>
            <label>
              Longitude
              <input
                inputMode="decimal"
                value={lonText}
                onChange={(e) => setLonText(e.target.value)}
                placeholder="e.g. 73.789800"
                required
              />
            </label>
          </div>

          <button
            type="button"
            className="btn soft block"
            onClick={requestGps}
            disabled={gps.status === "loading"}
          >
            {gps.status === "loading" ? "Getting GPS…" : "Retry location"}
          </button>
        </div>

        <label>
          Local Name
          <input
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            placeholder="e.g. Ram Kund"
            required
          />
        </label>

        {formError && <p className="gps-status err">{formError}</p>}

        <button
          type="submit"
          className="btn primary block"
          disabled={submitting || !coordsReady}
        >
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </form>
    </section>
  );
}
