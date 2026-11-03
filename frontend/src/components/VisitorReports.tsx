import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "../lib/auth";
import { formatDistance } from "../lib/nearest";
import { haversineM } from "../lib/types";
import { volunteerGeo } from "../lib/location/geo";
import { useI18n } from "../i18n/context";

type Report = {
  id: number;
  from_name: string;
  to_name: string;
  lat: number;
  lon: number;
  created_at: string;
  reporters: number;
  distance_m: number | null;
  street?: string | null;
  near_name?: string | null;
  near_m?: number | null;
};

type Props = { apiBase: string; onSaved: () => void };

function minutesAgo(iso: string): number {
  const t = new Date(iso.endsWith("Z") ? iso : `${iso}Z`).getTime();
  return Math.max(0, Math.round((Date.now() - t) / 60000));
}

/**
 * Visitors' "path blocked" reports, nearest first. They change nothing for
 * anyone until a volunteer checks the lane and confirms (a timed block).
 */
export function VisitorReports({ apiBase, onSaved }: Props) {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { t } = useI18n();

  // Two loads can overlap (at once, then with the position): only the newest answer counts.
  const seq = useRef(0);
  const load = useCallback(async (pos?: GeolocationPosition) => {
    const mine = ++seq.current;
    try {
      // The volunteer's position stays on the phone (never in a URL, which
      // servers log): distances are worked out here.
      const res = await authFetch(`${apiBase}/api/reports`);
      if (!res.ok) {
        // 401 opens the sign-in sheet (authFetch); anything else is said here.
        if (res.status !== 401) setErr(t("vol.reports.loadFailed"));
        return;
      }
      const list = ((await res.json()) as Report[]).map((r) => ({
        ...r,
        distance_m: pos ? haversineM(pos.coords.latitude, pos.coords.longitude, r.lat, r.lon) : null,
      }));
      if (pos) list.sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0));
      if (mine !== seq.current) return;
      setReports(list);
      setErr(null);
    } catch {
      setErr(t("vol.reports.loadFailed"));
    }
  }, [apiBase, t]);

  useEffect(() => {
    // Show the list at once (newest first); when the phone knows where it is,
    // load again nearest first. Waiting for GPS used to hide it for seconds.
    void load();
    if (!volunteerGeo.available()) return;
    volunteerGeo.getCurrentPosition(
      (pos) => void load(pos),
      () => undefined,
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  }, [load]);

  // Map roads join hidden junctions ("road junction"): name the street and the nearest place instead.
  const laneName = (r: Report) =>
    r.from_name === "road junction" && r.to_name === "road junction"
      ? [r.street || t("vol.obstacle.mapRoad"),
          r.near_name ? t("vol.reports.near", { place: r.near_name, dist: formatDistance(r.near_m ?? 0) }) : ""]
          .filter(Boolean).join(" · ")
      : `${r.from_name} ↔ ${r.to_name}`;

  async function act(r: Report, action: "confirm" | "reject", hours?: number | null) {
    setBusyId(r.id);
    setErr(null);
    try {
      const res = await authFetch(`${apiBase}/api/reports/${r.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: action === "confirm" ? JSON.stringify({ hours }) : undefined,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErr(typeof data?.detail === "string" ? data.detail : t("vol.reports.saveFailed"));
        return;
      }
      setReports((list) => (list ?? []).filter((x) => x.id !== r.id));
      if (action === "confirm") onSaved();
    } catch {
      setErr(t("vol.networkError"));
    } finally {
      setBusyId(null);
    }
  }

  // Before the first list arrives, a load error is the only thing worth showing.
  if (reports === null) return err ? <p className="gps-status err">{err}</p> : null;
  if (reports.length === 0) return null;
  return (
    <div className="visitor-reports">
      <p className="section-label">{t("vol.reports.title", { n: reports.length })}</p>
      <p className="field-hint">{t("vol.reports.hint")}</p>
      {err && <p className="gps-status err">{err}</p>}
      {reports.map((r) => (
        <div key={r.id} className="report-card">
          <strong>{laneName(r)}</strong>
          <small>
            {t(r.reporters > 1 ? "vol.reports.many" : "vol.reports.one", { n: r.reporters, min: minutesAgo(r.created_at) })}
            {r.distance_m != null ? t("vol.reports.away", { dist: formatDistance(r.distance_m) }) : ""}
          </small>
          <div className="report-actions">
            <button type="button" className="btn primary" disabled={busyId === r.id} onClick={() => void act(r, "confirm", 1)}>
              {t("vol.reports.blocked1h")}
            </button>
            <button type="button" className="btn soft" disabled={busyId === r.id} onClick={() => void act(r, "confirm", 4)}>
              {t("vol.reports.h4")}
            </button>
            <button type="button" className="btn soft" disabled={busyId === r.id} onClick={() => void act(r, "confirm", null)}>
              {t("vol.reports.untilReopened")}
            </button>
            <button type="button" className="btn soft" disabled={busyId === r.id} onClick={() => void act(r, "reject")}>
              {t("vol.reports.notBlocked")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
