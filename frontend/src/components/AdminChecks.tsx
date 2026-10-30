import { useState } from "react";
import { authFetch } from "../lib/auth";
import "./Volunteer.css";

/** GET /api/admin/graph-report (backend app/services/graph_report.py). */
type Crossing = { lane: number; from: string; to: string; source: string; name: string | null; crosses: string[] };
type Report = {
  water_data: boolean;
  places: number;
  pack_lanes: number;
  bridges: Crossing[];
  river_crossing_errors: Crossing[];
  river_crossing_warnings: Crossing[];
  components: number[];
  places_in_small_parts: string[];
  places_without_lane: string[];
  duplicate_lanes: string[][];
  possible_duplicate_places: { a: string; b: string; names: [string, string]; m: number }[];
  long_links: { lane: number; place: string; m: number }[];
  place_trust: Record<string, number>;
  lane_trust: Record<string, number>;
};

type Item = { key: string; text: string; lane?: number; place?: string };
type Group = { id: string; title: string; hint: string; level: "error" | "warn" | "info"; items: Item[] };

type Props = {
  apiBase: string;
  nameOf: (code: string) => string;
  onPickLane: (id: number) => void;
  onPickPlace: (code: string) => void;
};

/**
 * "Check data": the routing graph checks (river crossings, duplicates,
 * disconnected places) as a list; tapping one shows it on the map.
 */
export function AdminChecks({ apiBase, nameOf, onPickLane, onPickPlace }: Props) {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const res = await authFetch(`${apiBase}/api/admin/graph-report`);
      if (!res.ok) {
        setErr("Could not run the checks.");
        return;
      }
      setReport((await res.json()) as Report);
    } catch {
      setErr("No connection to the server.");
    } finally {
      setBusy(false);
    }
  }

  const lane = (c: Crossing) => `${nameOf(c.from)} ↔ ${nameOf(c.to)}${c.name ? ` (${c.name})` : ""} — crosses ${c.crosses.join(", ")}`;
  const groups: Group[] = report
    ? [
        {
          id: "unsafe",
          title: "Crosses a river or weir without a bridge",
          hint: "Left out of visitors' routes. Approve it only after checking (approved_crossings.json), or reject it.",
          level: "error",
          items: report.river_crossing_errors.map((c) => ({ key: `u${c.lane}`, text: lane(c), lane: c.lane })),
        },
        {
          id: "review",
          title: "Recorded walk crossing water",
          hint: "A volunteer's walk crosses a river line — check it is on a bridge.",
          level: "warn",
          items: report.river_crossing_warnings.map((c) => ({ key: `r${c.lane}`, text: lane(c), lane: c.lane })),
        },
        {
          id: "dupes",
          title: "Possible duplicate places",
          hint: "Same kind within 15 m, or the same name within 150 m. Reject the wrong one.",
          level: "warn",
          items: report.possible_duplicate_places.map((d) => ({
            key: `d${d.a}${d.b}`,
            text: `${d.names[0]} / ${d.names[1]} — ${d.m} m apart`,
            place: d.a,
          })),
        },
        {
          id: "stranded",
          title: "Places cut off from the main network",
          hint: "Their lanes do not join the main streets, so routes to them fail.",
          level: "warn",
          items: report.places_in_small_parts.map((c) => ({ key: `s${c}`, text: nameOf(c), place: c })),
        },
        {
          id: "long",
          title: "Place links longer than 60 m",
          hint: "A straight link from a place to its street is unusually long.",
          level: "warn",
          items: report.long_links.map((l) => ({ key: `l${l.lane}`, text: `${nameOf(l.place)} — ${Math.round(l.m)} m`, lane: l.lane })),
        },
        {
          id: "nolane",
          title: "Places with no lane",
          hint: "No route can reach them (often city-wide places outside the walking area).",
          level: "info",
          items: report.places_without_lane.map((c) => ({ key: `n${c}`, text: nameOf(c), place: c })),
        },
      ]
    : [];

  return (
    <div className="admin-checks">
      <div className="report-actions">
        <button type="button" className="btn soft" disabled={busy} onClick={() => void run()}>
          {busy ? "Checking…" : report ? "Check again" : "Check data"}
        </button>
      </div>
      {err && <p className="gps-status err">{err}</p>}
      {report && !report.water_data && (
        <p className="gps-status err">No river data on the server — river crossings were NOT checked.</p>
      )}
      {report && (
        <p className="field-hint">
          {report.bridges.length} river crossings on bridges · main network {report.components[0] ?? 0} points ·{" "}
          {report.pack_lanes} lanes on phones
        </p>
      )}
      {groups.map((g) => (
        <div key={g.id} className={`check-group ${g.level}${g.items.length === 0 ? " clear" : ""}`}>
          <button
            type="button"
            className="check-head"
            disabled={g.items.length === 0}
            onClick={() => setOpen(open === g.id ? null : g.id)}
          >
            <span>{g.items.length === 0 ? "✓" : g.level === "error" ? "✕" : g.level === "warn" ? "!" : "i"}</span>
            {g.title} ({g.items.length})
          </button>
          {open === g.id && g.items.length > 0 && (
            <>
              <small>{g.hint}</small>
              <ul>
                {g.items.slice(0, 50).map((i) => (
                  <li key={i.key}>
                    <button
                      type="button"
                      onClick={() => (i.lane != null ? onPickLane(i.lane) : i.place && onPickPlace(i.place))}
                    >
                      {i.text}
                    </button>
                  </li>
                ))}
              </ul>
              {g.items.length > 50 && <small>…and {g.items.length - 50} more (scripts/validate_graph.py lists all)</small>}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
