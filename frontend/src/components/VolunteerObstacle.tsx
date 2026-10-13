import { useEffect, useState } from "react";
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
  const [fromCode, setFromCode] = useState("");
  const [toCode, setToCode] = useState("");
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

  async function save() {
    setErr(null);
    setMsg(null);
    if (!fromCode || !toCode || fromCode === toCode) {
      setErr("Pick two different linked boards.");
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

      <div className="volunteer-form">
        <p className="field-hint">
          The mela has no floor plan. Boards and walked lanes are the map.
          Mark a lane blocked when a barricade, closed gate, or crowd closes
          it. The guide then uses another lane, or says there is no route.
        </p>

        {edges.length > 0 && (
          <p className="gps-status">
            Known links:{" "}
            {edges
              .map(
                (e) =>
                  `${nameOf(e.from_code)}↔${nameOf(e.to_code)}${
                    e.blocked || e.door_state === "closed" || e.walkable === false
                      ? " ✕"
                      : ""
                  }`
              )
              .join(" · ") || "—"}
          </p>
        )}

        <label>
          From board
          <select value={fromCode} onChange={(e) => setFromCode(e.target.value)}>
            {nodes.map((n) => (
              <option key={n.code} value={n.code}>
                {n.name} — {n.code}
              </option>
            ))}
          </select>
        </label>
        <label>
          To board
          <select value={toCode} onChange={(e) => setToCode(e.target.value)}>
            {nodes.map((n) => (
              <option key={n.code} value={n.code}>
                {n.name} — {n.code}
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
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save — remove from routes"}
        </button>
        <button
          type="button"
          className="btn soft block"
          disabled={busy}
          onClick={() => void reopen()}
        >
          Reopen path
        </button>
      </div>
    </section>
  );
}
