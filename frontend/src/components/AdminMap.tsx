import { useCallback, useEffect, useMemo, useState } from "react";
import { authFetch } from "../lib/auth";
import { formatDistance } from "../lib/nearest";
import type { QrNode, Verification } from "../lib/types";
import { OfflineMap } from "./OfflineMap";
import { AdminChecks } from "./AdminChecks";
import { AdminAudit } from "./AdminAudit";
import { AdminReleases } from "./AdminReleases";
import "./Volunteer.css";

type AdminPlace = {
  code: string;
  name: string;
  lat: number;
  lon: number;
  node_type: string;
  confirmed: boolean;
  verification: Verification;
  verification_note: string | null;
};
type AdminLane = {
  id: number;
  from_code: string;
  to_code: string;
  source: string;
  verified: boolean;
  walkable: boolean;
  blocked: boolean;
  blocked_until: string | null;
  door_state: string;
  obstacle_note: string | null;
  name: string | null;
  distance_m: number;
  path_json: string | null;
  verification: Verification;
  verification_note: string | null;
};
type AdminReport = { id: number; from_name: string; to_name: string; lat: number; lon: number; reporters: number };
type Overview = {
  places: AdminPlace[];
  junctions: Record<string, [number, number]>;
  lanes: AdminLane[];
  reports: AdminReport[];
};

type Props = { apiBase: string; onBack: () => void; onSaved: () => void };

type LaneKind = "walked" | "reviewed" | "map" | "off";

function laneKind(l: AdminLane): LaneKind {
  if (l.blocked || !l.walkable || l.door_state === "closed" || l.verification === "rejected") return "off";
  if (l.verification === "volunteer_verified" || l.verification === "officially_verified") return "walked";
  return l.verification === "remotely_reviewed" ? "reviewed" : "map";
}

const TRUST_LABEL: Record<Verification, string> = {
  osm_imported: "Imported from OpenStreetMap (not checked)",
  unverified: "Unverified (no walk or check recorded)",
  remotely_reviewed: "Reviewed on maps (not on site)",
  volunteer_verified: "Verified on site by a volunteer",
  officially_verified: "Officially verified",
  rejected: "Rejected (hidden from visitors)",
};

/** What an admin can set (a volunteer's on-site check comes from the volunteer app). */
const ADMIN_STATUSES: Verification[] = ["remotely_reviewed", "officially_verified", "rejected", "osm_imported", "unverified"];

function utc(iso: string): Date {
  return new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
}

/**
 * Admin view of all data: places (hollow = not confirmed on site), lanes
 * (walked green, map roads grey dashed, blocked/closed red) and visitor
 * reports. Tap a lane or report to act on it.
 */
export function AdminMap({ apiBase, onBack, onSaved }: Props) {
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [laneId, setLaneId] = useState<number | null>(null);
  const [reportId, setReportId] = useState<number | null>(null);
  const [placeCode, setPlaceCode] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<{ lat: number; lon: number; key: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`${apiBase}/api/admin/overview`);
      if (!res.ok) {
        setErr(res.status === 403 ? "Only admins can open this map." : "Could not load the admin map.");
        return;
      }
      setData((await res.json()) as Overview);
      setErr(null);
    } catch {
      setErr("No connection to the server.");
    }
  }, [apiBase]);

  useEffect(() => {
    void load();
  }, [load]);

  const pos = useMemo(() => {
    const m = new Map<string, [number, number]>();
    for (const p of data?.places ?? []) m.set(p.code, [p.lon, p.lat]);
    for (const [code, [lat, lon]] of Object.entries(data?.junctions ?? {})) m.set(code, [lon, lat]);
    return m;
  }, [data]);

  const places: QrNode[] = useMemo(
    () =>
      (data?.places ?? []).map((p, i) => ({
        id: -(i + 1),
        code: p.code,
        name: p.name,
        lat: p.lat,
        lon: p.lon,
        node_type: p.node_type,
        // Hollow on the map unless checked on the ground.
        gps_accuracy_m:
          p.verification === "volunteer_verified" || p.verification === "officially_verified" ? 1 : null,
        verification: p.verification,
      })),
    [data]
  );

  const lanes: GeoJSON.FeatureCollection = useMemo(() => {
    const features: GeoJSON.Feature[] = [];
    for (const l of data?.lanes ?? []) {
      let coords: [number, number][] = [];
      try {
        const path = l.path_json ? (JSON.parse(l.path_json) as { lat: number; lon: number }[]) : [];
        coords = path.map((p) => [p.lon, p.lat]);
      } catch {
        coords = [];
      }
      if (coords.length < 2) {
        const a = pos.get(l.from_code);
        const b = pos.get(l.to_code);
        if (!a || !b) continue;
        coords = [a, b];
      }
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords },
        properties: { id: l.id, kind: laneKind(l) },
      });
    }
    return { type: "FeatureCollection", features };
  }, [data, pos]);

  const counts = useMemo(() => {
    const ls = data?.lanes ?? [];
    return {
      confirmed: (data?.places ?? []).filter((p) => p.confirmed).length,
      places: data?.places.length ?? 0,
      walked: ls.filter((l) => laneKind(l) === "walked").length,
      reviewed: ls.filter((l) => laneKind(l) === "reviewed").length,
      map: ls.filter((l) => laneKind(l) === "map").length,
      off: ls.filter((l) => laneKind(l) === "off").length,
    };
  }, [data]);

  const lane = data?.lanes.find((l) => l.id === laneId) ?? null;
  const place = data?.places.find((p) => p.code === placeCode) ?? null;
  const report = data?.reports.find((r) => r.id === reportId) ?? null;
  const nameOf = (code: string) => data?.places.find((p) => p.code === code)?.name || "road junction";

  // A data check was tapped: open that lane / place and move the map to it.
  const pickLane = (id: number) => {
    const l = data?.lanes.find((x) => x.id === id);
    const a = l && pos.get(l.from_code);
    const b = l && pos.get(l.to_code);
    setPlaceCode(null);
    setReportId(null);
    setLaneId(id);
    if (a && b) setFocus({ lon: (a[0] + b[0]) / 2, lat: (a[1] + b[1]) / 2, key: `lane${id}${Date.now()}` });
  };
  const pickPlace = (code: string) => {
    const p = pos.get(code);
    setLaneId(null);
    setReportId(null);
    setPlaceCode(code);
    if (p) setFocus({ lon: p[0], lat: p[1], key: `place${code}${Date.now()}` });
  };

  async function post(url: string, body: unknown) {
    setBusy(true);
    setErr(null);
    try {
      const res = await authFetch(`${apiBase}${url}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => null);
      if (!res.ok) {
        setErr(typeof out?.detail === "string" ? out.detail : "Could not save");
        return;
      }
      setLaneId(null);
      setReportId(null);
      setPlaceCode(null);
      setNote("");
      onSaved();
      await load();
    } catch {
      setErr("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  /** Trust level and the buttons to change it (recorded with your name and the note). */
  const trustControls = (target: "place" | "lane", current: Verification, ref: { code?: string; lane_id?: number }) => (
    <div className="trust-box">
      <small>
        <strong>Trust:</strong> {TRUST_LABEL[current] ?? current}
      </small>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Why? (e.g. checked on satellite imagery 2026-10-30)"
        maxLength={256}
      />
      <div className="report-actions">
        {ADMIN_STATUSES.filter((s) => s !== current).map((s) => (
          <button
            key={s}
            type="button"
            className={`btn ${s === "rejected" ? "soft danger" : "soft"}`}
            disabled={busy}
            onClick={() => void post("/api/admin/verify", { target, status: s, note: note || null, ...ref })}
          >
            {s === "remotely_reviewed"
              ? "Reviewed on maps"
              : s === "officially_verified"
                ? "Officially verified"
                : s === "rejected"
                  ? "Reject"
                  : s === "osm_imported"
                    ? "Back to imported"
                    : "Mark unverified"}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <section className="screen flow volunteer-screen admin-map">
      <header className="volunteer-head">
        <button type="button" className="back" onClick={onBack} aria-label="Back">
          ←
        </button>
        <div>
          <h2>Admin map</h2>
          <p>
            {data
              ? `${counts.confirmed}/${counts.places} places confirmed · ${counts.walked} walked lanes · ${counts.off} closed · ${data.reports.length} reports`
              : "Loading…"}
          </p>
        </div>
      </header>

      <OfflineMap
        className="admin-canvas"
        places={places}
        markUnconfirmed
        lanes={lanes}
        focus={focus}
        onLaneTap={(id) => {
          setReportId(null);
          setPlaceCode(null);
          setLaneId(id);
        }}
        onPlaceTap={(code) => {
          setLaneId(null);
          setReportId(null);
          setPlaceCode(code);
        }}
        reportPins={data?.reports ?? []}
        onReportTap={(id) => {
          setLaneId(null);
          setPlaceCode(null);
          setReportId(id);
        }}
      />

      <p className="admin-legend">
        <span className="lg walked" /> verified on site ({counts.walked}) <span className="lg reviewed" /> reviewed on maps (
        {counts.reviewed}) <span className="lg map" /> imported / unverified ({counts.map}){" "}
        <span className="lg off" /> blocked / closed <span className="lg hollow" /> place not confirmed{" "}
        <span className="lg report" /> visitor report
      </p>
      {err && <p className="gps-status err">{err}</p>}

      {lane && (
        <div className="report-card">
          <strong>
            {nameOf(lane.from_code)} ↔ {nameOf(lane.to_code)}
            {lane.name ? ` · ${lane.name}` : ""}
          </strong>
          <small>
            {formatDistance(lane.distance_m)} · {lane.source === "osm" ? "from OpenStreetMap" : lane.verified ? "walked by a volunteer" : "volunteer link (not walked)"}
            {lane.blocked
              ? ` · blocked${lane.blocked_until ? ` until ${utc(lane.blocked_until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : " until reopened"}`
              : ""}
            {!lane.walkable ? " · not walkable" : ""}
            {lane.obstacle_note ? ` · ${lane.obstacle_note}` : ""}
          </small>
          <div className="report-actions">
            {(lane.blocked || lane.door_state === "closed") && (
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() =>
                  void post("/api/volunteer/edge-status", {
                    from_code: lane.from_code,
                    to_code: lane.to_code,
                    blocked: false,
                    walkable: true,
                    door_state: lane.door_state === "closed" ? "open" : lane.door_state,
                    obstacle_note: "",
                  })
                }
              >
                Reopen lane
              </button>
            )}
            {!lane.blocked && (
              <button
                type="button"
                className="btn soft"
                disabled={busy}
                onClick={() =>
                  void post("/api/volunteer/edge-status", {
                    from_code: lane.from_code,
                    to_code: lane.to_code,
                    walkable: !lane.walkable,
                  })
                }
              >
                {lane.walkable ? "Mark not walkable" : "Mark walkable"}
              </button>
            )}
            <button type="button" className="btn soft" onClick={() => setLaneId(null)}>
              Close
            </button>
          </div>
          {trustControls("lane", lane.verification, { lane_id: lane.id })}
          {lane.verification_note && <small>Note: {lane.verification_note}</small>}
          <AdminAudit apiBase={apiBase} target={`lane:${lane.id}`} refreshKey={data} />
        </div>
      )}

      {place && (
        <div className="report-card">
          <strong>{place.name}</strong>
          <small>
            {place.code} · {place.node_type}
            {place.confirmed ? " · saved from on-site GPS" : ""}
            {place.verification_note ? ` · note: ${place.verification_note}` : ""}
          </small>
          {trustControls("place", place.verification, { code: place.code })}
          <AdminAudit apiBase={apiBase} target={`place:${place.code}`} refreshKey={data} />
          <div className="report-actions">
            <button type="button" className="btn soft" onClick={() => setPlaceCode(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {report && (
        <div className="report-card">
          <strong>
            {report.from_name} ↔ {report.to_name}
          </strong>
          <small>
            Visitor report · {report.reporters} phone{report.reporters > 1 ? "s" : ""}. Check the lane, then:
          </small>
          <div className="report-actions">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void post(`/api/reports/${report.id}/confirm`, { hours: 1 })}>
              Blocked · 1 h
            </button>
            <button type="button" className="btn soft" disabled={busy} onClick={() => void post(`/api/reports/${report.id}/confirm`, { hours: 4 })}>
              4 h
            </button>
            <button type="button" className="btn soft" disabled={busy} onClick={() => void post(`/api/reports/${report.id}/reject`, {})}>
              Not blocked
            </button>
          </div>
        </div>
      )}

      <AdminReleases apiBase={apiBase} refreshKey={data} onChanged={onSaved} />
      <AdminChecks apiBase={apiBase} nameOf={nameOf} onPickLane={pickLane} onPickPlace={pickPlace} />
      <AdminAudit
        apiBase={apiBase}
        refreshKey={data}
        onPick={(t) => {
          const [kind, ref] = t.split(":");
          if (kind === "lane" && Number.isFinite(Number(ref))) pickLane(Number(ref));
          else if (kind === "place" && ref) pickPlace(ref);
        }}
      />
    </section>
  );
}
