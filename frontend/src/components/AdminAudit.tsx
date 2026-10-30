import { useEffect, useState } from "react";
import { authFetch } from "../lib/auth";
import "./Volunteer.css";

type Entry = { at: string; actor: string | null; action: string; target: string; summary: string };

type Props = {
  apiBase: string;
  /** Only this place:CODE / lane:ID (the open card's history); otherwise everything. */
  target?: string;
  /** Changes since the map last loaded data: reload the list. */
  refreshKey?: unknown;
  onPick?: (target: string) => void;
};

function when(iso: string): string {
  const d = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  return d.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Who changed the data, newest first (GET /api/admin/audit). */
export function AdminAudit({ apiBase, target, refreshKey, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const q = target ? `?limit=20&target=${encodeURIComponent(target)}` : "?limit=50";
    authFetch(`${apiBase}/api/admin/audit${q}`)
      .then(async (res) => {
        if (!alive) return;
        if (!res.ok) throw new Error();
        setEntries((await res.json()) as Entry[]);
        setErr(null);
      })
      .catch(() => alive && setErr("Could not load the change history."));
    return () => {
      alive = false;
    };
  }, [open, apiBase, target, refreshKey]);

  return (
    <div className="admin-audit">
      <button type="button" className="check-head" onClick={() => setOpen(!open)}>
        <span>{open ? "▾" : "▸"}</span>
        {target ? "History" : "Recent changes"}
      </button>
      {open && err && <p className="gps-status err">{err}</p>}
      {open && entries && entries.length === 0 && <small>No changes recorded yet.</small>}
      {open && entries && entries.length > 0 && (
        <ul>
          {entries.map((e, i) => (
            <li key={i}>
              <small>
                {when(e.at)} · {e.actor ?? "?"}
              </small>
              {onPick && !target ? (
                <button type="button" onClick={() => onPick(e.target)}>
                  {e.summary}
                </button>
              ) : (
                <span>{e.summary}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
