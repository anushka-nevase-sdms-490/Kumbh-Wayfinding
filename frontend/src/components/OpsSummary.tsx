import { useEffect, useState } from "react";
import { authFetch } from "../lib/auth";
import "./Volunteer.css";

type Summary = {
  sos: { unacknowledged: number; acknowledged_open: number; possible_flood_open: number; median_minutes_to_ack_24h: number | null };
  cases: Record<string, number> | null;
  facilities: { closed_now: number; status_expired: number };
  boards: number;
  closed_lanes: number;
  pending_visitor_reports: number;
};

type Props = { apiBase: string; onOpen: (where: "sos-ops" | "cases" | "admin" | "obstacle") => void; isAdmin: boolean };

/** Operations at a glance for operators and admins (GET /api/ops/summary — counts only). */
export function OpsSummary({ apiBase, onOpen, isAdmin }: Props) {
  const [s, setS] = useState<Summary | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await authFetch(`${apiBase}/api/ops/summary`);
        if (res.ok && alive) {
          setS((await res.json()) as Summary);
          setOffline(false);
        }
      } catch {
        if (alive) setOffline(true);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [apiBase]);

  if (!s) return offline ? <p className="field-hint">Operations summary needs a connection.</p> : null;
  const openCases = s.cases ? Object.values(s.cases).reduce((a, b) => a + b, 0) : null;
  const tile = (label: string, value: string | number, warn: boolean, onClick?: () => void) => (
    <button type="button" className={`ops-tile ${warn ? "warn" : ""}`} onClick={onClick} disabled={!onClick}>
      <span className="ops-num">{value}</span>
      <span className="ops-label">{label}</span>
    </button>
  );

  return (
    <div className="ops-summary" aria-label="Operations summary">
      {tile("SOS not acknowledged", s.sos.unacknowledged, s.sos.unacknowledged > 0, () => onOpen("sos-ops"))}
      {tile("SOS being handled", s.sos.acknowledged_open, false, () => onOpen("sos-ops"))}
      {openCases !== null && tile("Open lost-person cases", openCases, (s.cases?.NEW ?? 0) > 0, () => onOpen("cases"))}
      {tile("Facilities closed now", s.facilities.closed_now, false, isAdmin ? () => onOpen("admin") : undefined)}
      {tile("Facility statuses expired", s.facilities.status_expired, s.facilities.status_expired > 0, isAdmin ? () => onOpen("admin") : undefined)}
      {tile("Visitor reports to check", s.pending_visitor_reports, s.pending_visitor_reports > 0, () => onOpen("obstacle"))}
      {tile("Closed lanes", s.closed_lanes, false)}
      {tile("QR boards", s.boards, false, isAdmin ? () => onOpen("admin") : undefined)}
      <small className="ops-foot">
        {s.sos.median_minutes_to_ack_24h != null
          ? `Median time to acknowledge an SOS (24 h): ${s.sos.median_minutes_to_ack_24h} min`
          : "No SOS acknowledged in the last 24 h"}
        {s.sos.possible_flood_open > 0 ? ` · ${s.sos.possible_flood_open} open alerts marked as a possible flood` : ""}
      </small>
    </div>
  );
}
