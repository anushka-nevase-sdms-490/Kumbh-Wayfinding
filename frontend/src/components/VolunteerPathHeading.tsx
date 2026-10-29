import { useEffect, useMemo, useState } from "react";
import { useDeviceHeading } from "../hooks/useDeviceHeading";
import type { GraphEdge, QrNode } from "../lib/types";
import "./Volunteer.css";

type Props = {
  apiBase: string;
  onBack: () => void;
  onSaved: () => void;
};

/**
 * Capture real walk compass heading on an existing board↔board link so the
 * guide arrow follows the corridor — not the straight GPS line through desks.
 */
export function VolunteerPathHeading({ apiBase, onBack, onSaved }: Props) {
  const heading = useDeviceHeading();
  const [nodes, setNodes] = useState<QrNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [laneKey, setLaneKey] = useState("");
  // Which end of the lane the volunteer stands at; they face the other end.
  const [standAtA, setStandAtA] = useState(true);
  const [captured, setCaptured] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/pack/latest/json`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          nodes?: QrNode[];
          edges?: GraphEdge[];
        };
        const list = (data.nodes ?? [])
          .filter((n) => n.code.trim().toUpperCase() !== "VOLUNTEER_REGISTER")
          .sort((a, b) => a.name.localeCompare(b.name));
        if (!cancelled) {
          setNodes(list);
          setEdges(data.edges ?? []);
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const nameOf = (code: string) =>
    nodes.find((n) => n.code.toUpperCase() === code.toUpperCase())?.name ??
    code;

  const linkedPairs = useMemo(() => {
    const codes = new Set(nodes.map((n) => n.code.toUpperCase()));
    const pairs: { key: string; a: string; b: string; hasHeading: boolean }[] = [];
    for (const e of edges) {
      const A = e.from_code.toUpperCase();
      const B = e.to_code.toUpperCase();
      if (!codes.has(A) || !codes.has(B)) continue;
      pairs.push({
        key: `${A}|${B}`,
        a: e.from_code,
        b: e.to_code,
        hasHeading:
          typeof e.heading_ab === "number" && typeof e.heading_ba === "number",
      });
    }
    return pairs;
  }, [edges, nodes]);

  const lane = linkedPairs.find((p) => p.key === laneKey) ?? null;
  // API naming: to_code = board you stand at, from_code = board you face.
  const toCode = lane ? (standAtA ? lane.a : lane.b) : "";
  const fromCode = lane ? (standAtA ? lane.b : lane.a) : "";

  async function save() {
    setErr(null);
    setMsg(null);
    if (!lane) {
      setErr("Choose a lane first.");
      return;
    }
    if (captured == null) {
      setErr("Capture the walk direction first (point phone along the path).");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/api/volunteer/path-heading`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_code: fromCode,
          to_code: toCode,
          path_heading_deg: captured,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(
          typeof data?.detail === "string"
            ? data.detail
            : "Could not save walk direction"
        );
        return;
      }
      setMsg(
        `Saved walk direction ${nameOf(toCode)} → ${nameOf(fromCode)} at ${captured.toFixed(0)}°. Arrow will follow this path, not GPS line.`
      );
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="screen flow volunteer-screen">
      <header className="volunteer-head">
        <button type="button" className="back" onClick={onBack} aria-label="Back">
          ←
        </button>
        <div>
          <h2>Fix walk direction</h2>
          <p>Face the phone along the real mela lane</p>
        </div>
      </header>

      {loaded && linkedPairs.length === 0 ? (
        <div className="empty-state">
          <strong>No walked lanes yet</strong>
          <p>
            Register at least two places and record the walk between them.
            Their lane then appears here.
          </p>
        </div>
      ) : (
      <div className="volunteer-form">
        <p className="field-hint">
          Choose a lane, pick the board you are standing at, face the phone
          along the real walk toward the other board, then capture. ✓ means the
          lane already has a direction.
        </p>

        <label>
          Lane
          <select
            value={laneKey}
            onChange={(e) => {
              setLaneKey(e.target.value);
              setStandAtA(true);
              setCaptured(null);
              setMsg(null);
            }}
          >
            <option value="" disabled>
              Choose a lane…
            </option>
            {linkedPairs.map((p) => (
              <option key={p.key} value={p.key}>
                {nameOf(p.a)} ↔ {nameOf(p.b)}
                {p.hasHeading ? " ✓" : ""}
              </option>
            ))}
          </select>
        </label>

        {lane && (
          <label>
            I am standing at
            <select
              value={standAtA ? "a" : "b"}
              onChange={(e) => {
                setStandAtA(e.target.value === "a");
                setCaptured(null);
                setMsg(null);
              }}
            >
              <option value="a">{nameOf(lane.a)}</option>
              <option value="b">{nameOf(lane.b)}</option>
            </select>
            <span className="field-hint">
              Face the phone toward <strong>{nameOf(fromCode)}</strong> along the
              lane, then capture.
            </span>
          </label>
        )}

        <div className="coord-block">
          <p className="section-label">Compass along the walk</p>
          <p className="gps-status">
            Live: {heading.heading.toFixed(0)}° · {heading.note}
          </p>
          {!heading.secure && (
            <p className="gps-status err">
              Open the HTTPS (ngrok) link so the compass works.
            </p>
          )}
          <button
            type="button"
            className="btn soft block"
            onClick={() => void heading.requestPermission()}
          >
            Enable compass / gyroscope
          </button>
          <button
            type="button"
            className="btn secondary block"
            onClick={() => {
              setCaptured(Math.round(heading.heading * 10) / 10);
              setMsg(null);
              setErr(null);
            }}
          >
            Capture walk direction ({heading.heading.toFixed(0)}°)
          </button>
          {captured != null && (
            <p className="gps-status ok">
              Captured {captured.toFixed(0)}° — facing from {nameOf(toCode)}{" "}
              toward {nameOf(fromCode)} along the walk
            </p>
          )}
        </div>

        {err && <p className="gps-status err">{err}</p>}
        {msg && <p className="gps-status ok">{msg}</p>}

        <button
          type="button"
          className="btn primary block"
          disabled={busy || captured == null || !lane}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save walk direction"}
        </button>

        <p className="field-hint">
          Lane turns a corner? Register a board at that turn too — one heading
          per straight stretch of the mela lane.
        </p>
      </div>
      )}
    </section>
  );
}
