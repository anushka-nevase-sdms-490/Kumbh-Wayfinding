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
  const [fromCode, setFromCode] = useState("");
  const [toCode, setToCode] = useState("");
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
          if (list.length >= 2) {
            setFromCode(list[0].code);
            setToCode(list[1].code);
          }
        }
      } catch {
        /* ignore */
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
    const pairs: { a: string; b: string; hasHeading: boolean }[] = [];
    for (const e of edges) {
      const A = e.from_code.toUpperCase();
      const B = e.to_code.toUpperCase();
      if (!codes.has(A) || !codes.has(B)) continue;
      pairs.push({
        a: e.from_code,
        b: e.to_code,
        hasHeading:
          typeof e.heading_ab === "number" && typeof e.heading_ba === "number",
      });
    }
    return pairs;
  }, [edges, nodes]);

  async function save() {
    setErr(null);
    setMsg(null);
    if (!fromCode || !toCode || fromCode === toCode) {
      setErr("Pick two different boards that are walk-linked.");
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

      <div className="volunteer-form">
        <p className="field-hint">
          Stand at the board you are leaving <strong>from</strong> in the
          picker below labeled “Standing at”, face the phone along the walkable
          path toward the other board (around obstacles), then capture.
        </p>

        {linkedPairs.length > 0 && (
          <p className="gps-status">
            Linked paths:{" "}
            {linkedPairs
              .map(
                (p) =>
                  `${nameOf(p.a)} ↔ ${nameOf(p.b)}${p.hasHeading ? " ✓" : " (no heading yet)"}`
              )
              .join(" · ")}
          </p>
        )}

        <label>
          Other board (walk toward)
          <select
            value={fromCode}
            onChange={(e) => {
              setFromCode(e.target.value);
              setCaptured(null);
              setMsg(null);
            }}
          >
            {nodes.map((n) => (
              <option key={n.code} value={n.code}>
                {n.name} — {n.code}
              </option>
            ))}
          </select>
        </label>

        <label>
          Standing at (this board)
          <select
            value={toCode}
            onChange={(e) => {
              setToCode(e.target.value);
              setCaptured(null);
              setMsg(null);
            }}
          >
            {nodes.map((n) => (
              <option key={n.code} value={n.code}>
                {n.name} — {n.code}
              </option>
            ))}
          </select>
        </label>

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
          disabled={busy || captured == null}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save walk direction"}
        </button>

        <p className="field-hint">
          Lane turns a corner? Register a board at that turn too — one heading
          per straight stretch of the mela lane.
        </p>
      </div>
    </section>
  );
}
