import { useCallback, useEffect, useState } from "react";
import { authFetch } from "../lib/auth";
import "./Volunteer.css";

type Release = {
  id: number;
  created_at: string;
  by: string | null;
  note: string | null;
  node_count: number;
  edge_count: number;
  active: boolean;
};
type Info = {
  mode: "auto" | "manual";
  live: Release | null;
  draft: {
    places_added: number;
    places_removed: number;
    places_changed: number;
    lanes_added: number;
    lanes_removed: number;
    lanes_changed: number;
    examples: string[];
  } | null;
  unpublished_closures: number;
  releases: Release[];
};

type Props = { apiBase: string; refreshKey?: unknown; onChanged: () => void };

function when(iso: string): string {
  const d = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  return d.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * Data versions (PUBLISH_MODE=manual): what visitors' phones have, what is
 * waiting, Publish, and roll back. Closures and rejections never wait.
 */
export function AdminReleases({ apiBase, refreshKey, onChanged }: Props) {
  const [info, setInfo] = useState<Info | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** Publish / roll back need a second tap (no browser dialogs). */
  const [confirm, setConfirm] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`${apiBase}/api/admin/releases`);
      if (res.ok) setInfo((await res.json()) as Info);
    } catch {
      /* offline: the panel stays as it was */
    }
  }, [apiBase]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function act(url: string, body: unknown) {
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
      setNote("");
      setConfirm(null);
      onChanged();
      await load();
    } catch {
      setErr("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  if (!info) return null;
  if (info.mode === "auto") {
    return (
      <div className="admin-audit">
        <small>
          Publishing is off (PUBLISH_MODE=auto): every change reaches visitors' phones at once. Production uses
          manual publishing.
        </small>
      </div>
    );
  }
  const d = info.draft!;
  const waiting =
    d.places_added + d.places_removed + d.places_changed + d.lanes_added + d.lanes_removed + d.lanes_changed;

  return (
    <div className="admin-audit releases">
      <strong>Data on visitors' phones</strong>
      {info.live && (
        <small>
          Version {info.live.id} · published {when(info.live.created_at)} by {info.live.by ?? "?"}
          {info.live.note ? ` · ${info.live.note}` : ""}
        </small>
      )}
      <small>
        Closures, reopenings and rejections reach phones at once. Everything else waits for Publish. The map above
        shows the latest data, including what is waiting.
      </small>
      {waiting === 0 ? (
        <small>✓ Nothing waiting — phones have the latest data.</small>
      ) : (
        <>
          <p className="field-hint">
            Waiting to publish: places +{d.places_added} / ~{d.places_changed} / −{d.places_removed} · lanes +
            {d.lanes_added} / ~{d.lanes_changed} / −{d.lanes_removed}
          </p>
          {d.examples.length > 0 && <small>{d.examples.join(" · ")}</small>}
          {info.unpublished_closures > 0 && (
            <p className="gps-status warn">
              {info.unpublished_closures} closed lane(s) are new since the last publish — phones do not have them
              yet, so their closure waits too.
            </p>
          )}
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed? (shown in the history)" maxLength={256} />
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => (confirm === "publish" ? void act("/api/admin/publish", { note: note || null }) : setConfirm("publish"))}
          >
            {confirm === "publish" ? "Tap again to publish to all phones" : "Publish"}
          </button>
        </>
      )}
      {err && <p className="gps-status err">{err}</p>}
      {info.releases.length > 1 && (
        <ul>
          {info.releases.map((r) => (
            <li key={r.id}>
              <small>
                Version {r.id} · {when(r.created_at)} · {r.by ?? "?"} · {r.node_count} points, {r.edge_count} lanes
                {r.note ? ` · ${r.note}` : ""}
                {r.active ? " · on phones now" : ""}
              </small>
              {!r.active && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    confirm === `rb${r.id}` ? void act("/api/admin/rollback", { release_id: r.id }) : setConfirm(`rb${r.id}`)
                  }
                >
                  {confirm === `rb${r.id}` ? "Tap again: phones switch to this version" : "Put this version on phones"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
