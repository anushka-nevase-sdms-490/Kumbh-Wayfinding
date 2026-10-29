import { useEffect, useMemo, useState } from "react";
import type { GraphEdge, QrNode } from "../lib/types";
import "./Volunteer.css";

type Props = {
  apiBase: string;
  onBack: () => void;
  onSaved: () => void;
};

/** Volunteer marks corridors blocked / doors closed so A* never routes through them. */
export function VolunteerObstacle({ apiBase, onBack, onSaved }: Props) {
  const [nodes, setNodes] = useState<QrNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [laneKey, setLaneKey] = useState("");
  const [blocked, setBlocked] = useState(true);
  const [doorState, setDoorState] = useState("none");
  const [passageKind, setPassageKind] = useState("corridor");
  const [note, setNote] = useState("");
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
        // Pack omits blocked/closed — also fetch all edges from API if available.
        const list = (data.nodes ?? [])
          .filter((n) => n.code.trim().toUpperCase() !== "VOLUNTEER_REGISTER")
          .sort((a, b) => a.name.localeCompare(b.name));
        let edgeList = data.edges ?? [];
        try {
          const er = await fetch(`${apiBase}/api/edges`);
          if (er.ok) edgeList = (await er.json()) as GraphEdge[];
        } catch {
          /* use pack edges */
        }
        if (!cancelled) {
          setNodes(list);
          setEdges(edgeList);
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

  // Every known lane between registered boards, including blocked ones (✕) so
  // they can be reopened.
  const lanes = useMemo(() => {
    const codes = new Set(nodes.map((n) => n.code.toUpperCase()));
    return edges
      .filter(
        (e) =>
          codes.has(e.from_code.toUpperCase()) && codes.has(e.to_code.toUpperCase())
      )
      .map((e) => ({
        key: `${e.from_code.toUpperCase()}|${e.to_code.toUpperCase()}`,
        a: e.from_code,
        b: e.to_code,
        closed: !!e.blocked || e.door_state === "closed" || e.walkable === false,
      }));
  }, [edges, nodes]);

  const lane = lanes.find((l) => l.key === laneKey) ?? null;
  const fromCode = lane?.a ?? "";
  const toCode = lane?.b ?? "";

  async function save() {
    setErr(null);
    setMsg(null);
    if (!lane) {
      setErr("Choose a lane first.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/api/volunteer/edge-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_code: fromCode,
          to_code: toCode,
          blocked,
          door_state: doorState,
          passage_kind: passageKind,
          obstacle_note: note.trim() || null,
          walkable:
            blocked ||
            doorState === "closed" ||
            passageKind === "glass_wall" ||
            passageKind === "wall"
              ? false
              : true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(
          typeof data?.detail === "string"
            ? data.detail
            : "Could not update path status"
        );
        return;
      }
      setMsg(
        blocked || doorState === "closed"
          ? `Path ${nameOf(fromCode)} ↔ ${nameOf(toCode)} removed from routes.`
          : `Path ${nameOf(fromCode)} ↔ ${nameOf(toCode)} reopened for routing.`
      );
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    if (!lane) {
      setErr("Choose a lane first.");
      return;
    }
    setBlocked(false);
    setDoorState("open");
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`${apiBase}/api/volunteer/edge-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_code: fromCode,
          to_code: toCode,
          blocked: false,
          door_state: doorState === "closed" ? "open" : doorState,
          walkable: true,
          obstacle_note: null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(typeof data?.detail === "string" ? data.detail : "Failed");
        return;
      }
      setMsg(`Reopened ${nameOf(fromCode)} ↔ ${nameOf(toCode)}`);
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
          <h2>Report a blocked lane</h2>
          <p>Barricade, closed gate, or crowd — routes will avoid that lane</p>
        </div>
      </header>

      {loaded && lanes.length === 0 ? (
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
          Mark a lane blocked when a barricade, closed gate, or crowd closes it.
          The guide then uses another lane, or says there is no route.
        </p>

        <label>
          Lane
          <select value={laneKey} onChange={(e) => setLaneKey(e.target.value)}>
            <option value="" disabled>
              Choose a lane…
            </option>
            {lanes.map((l) => (
              <option key={l.key} value={l.key}>
                {nameOf(l.a)} ↔ {nameOf(l.b)}
                {l.closed ? " ✕ blocked" : ""}
              </option>
            ))}
          </select>
        </label>

        <label>
          Obstacle type
          <select
            value={passageKind}
            onChange={(e) => setPassageKind(e.target.value)}
          >
            <option value="corridor">Open mela lane</option>
            <option value="door">Gate</option>
            <option value="wall">Barricade</option>
            <option value="passage">Narrow passage</option>
          </select>
        </label>

        <label>
          Door state
          <select
            value={doorState}
            onChange={(e) => setDoorState(e.target.value)}
          >
            <option value="none">Not a door</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>

        <label className="check-row">
          <input
            type="checkbox"
            checked={blocked}
            onChange={(e) => setBlocked(e.target.checked)}
          />
          Lane blocked (barricade, closed gate, crowd)
        </label>

        <label>
          Note (optional)
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. barricade at Ram Kund lane"
          />
        </label>

        {err && <p className="gps-status err">{err}</p>}
        {msg && <p className="gps-status ok">{msg}</p>}

        <button
          type="button"
          className="btn primary block"
          disabled={busy || !lane}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save — remove from routes"}
        </button>
        <button
          type="button"
          className="btn soft block"
          disabled={busy || !lane}
          onClick={() => void reopen()}
        >
          Reopen path
        </button>
      </div>
      )}
    </section>
  );
}
