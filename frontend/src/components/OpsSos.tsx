import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "../lib/auth";
import { formatDistance } from "../lib/nearest";
import { SOS_PRESETS } from "../lib/sos";
import { haversineM, isRegisteredLocation, type QrNode } from "../lib/types";
import "./Volunteer.css";

type Alert = {
  id: number;
  kind: "medical" | "lost" | "unsafe" | "other";
  note: string | null;
  lat: number | null;
  lon: number | null;
  accuracy_m: number | null;
  place_code: string | null;
  lang: string | null;
  created_at: string;
  /** When the visitor pressed "Send" (phone clock); null from older apps. */
  asked_at: string | null;
  status: "received" | "acknowledged" | "resolved";
  ack_at: string | null;
  ack_message: string | null;
  flood_suspect: boolean;
};

type Props = {
  apiBase: string;
  places: QrNode[];
  onBack: () => void;
  /** A "someone is lost" alert becomes a case (operators open it with the details). */
  onOpenCase: (alert: { id: number; note: string | null; placeCode: string | null }) => void;
};

const KIND_LABEL = { medical: "Medical help", lost: "Someone is lost", unsafe: "Unsafe crowd", other: "Other help" };
// Shown to the visitor in their own language (SOS_PRESETS); anything typed is shown as typed.
const PRESETS = Object.values(SOS_PRESETS);

/** A new alert arrived: vibrate and play a short tone (no sound files, works offline). */
function notifyNew(): void {
  try {
    navigator.vibrate?.([200, 100, 200]);
  } catch {
    /* not supported */
  }
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
    osc.onended = () => void ctx.close();
  } catch {
    /* audio blocked until the operator has tapped the page once */
  }
}

function utc(iso: string): Date {
  return new Date(/[zZ]$/.test(iso) ? iso : `${iso}Z`);
}

function ago(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - utc(iso).getTime()) / 60000));
  return min < 60 ? `${min} min ago` : `${Math.floor(min / 60)} h ${min % 60} min ago`;
}

/** Operators: open SOS alerts, newest first; acknowledge (with a message the visitor sees) and resolve. */
export function OpsSos({ apiBase, places, onBack, onOpenCase }: Props) {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  /** Alerts already seen on this screen: a new one vibrates and beeps. */
  const seen = useRef<Set<number> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`${apiBase}/api/ops/sos`);
      if (!res.ok) {
        setErr(res.status === 403 ? "Only operators and admins can see SOS alerts." : "Could not load alerts.");
        return;
      }
      const list = (await res.json()) as Alert[];
      const fresh = seen.current ? list.filter((a) => a.status === "received" && !seen.current!.has(a.id)) : [];
      seen.current = new Set(list.map((a) => a.id));
      if (fresh.length > 0) notifyNew();
      setAlerts(list);
      setErr(null);
    } catch {
      setErr("No connection to the server — alerts cannot be loaded.");
    }
  }, [apiBase]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(timer);
  }, [load]);

  // Unacknowledged alerts in the tab title, so they are seen from other tabs too.
  const waiting = (alerts ?? []).filter((a) => a.status === "received").length;
  useEffect(() => {
    const before = document.title;
    document.title = waiting > 0 ? `(${waiting}) SOS — Setu` : before;
    return () => {
      document.title = before;
    };
  }, [waiting]);

  async function act(a: Alert, action: "ack" | "resolve") {
    setBusy(a.id);
    try {
      const res = await authFetch(`${apiBase}/api/ops/sos/${a.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "ack" ? { message: msg[a.id] || null } : {}),
      });
      const out = res.ok ? null : await res.json().catch(() => null);
      await load(); // clears the error line on success, so the refusal is shown after it
      if (!res.ok) setErr(typeof out?.detail === "string" ? out.detail : "Could not save");
    } catch {
      setErr("No connection to the server — not saved. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const named = places.filter(isRegisteredLocation);
  const where = (a: Alert) => {
    if (a.lat != null && a.lon != null) {
      let best: QrNode | null = null;
      let bestM = Infinity;
      for (const p of named) {
        const d = haversineM(a.lat, a.lon, p.lat, p.lon);
        if (d < bestM) [best, bestM] = [p, d];
      }
      const near = best ? ` · ${formatDistance(bestM)} from ${best.name}` : "";
      return `GPS ${a.lat.toFixed(5)}, ${a.lon.toFixed(5)} (±${Math.round(a.accuracy_m ?? 0)} m)${near}`;
    }
    const p = a.place_code ? named.find((n) => n.code === a.place_code) : null;
    return p ? `Said they are at ${p.name}` : "No position — see the note";
  };

  return (
    <section className="screen flow volunteer-screen">
      <header className="volunteer-head">
        <button type="button" className="back" onClick={onBack} aria-label="Back">
          ←
        </button>
        <div>
          <h2>SOS alerts</h2>
          <p>{alerts ? `${alerts.length} open · refreshes every 10 s` : "Loading…"}</p>
        </div>
      </header>
      <p className="field-hint">
        Acknowledge only when someone is acting on it: the visitor's phone then shows "An operator confirmed" with your
        message. A new alert vibrates and beeps while this screen is open. Alerts nobody resolves close as "expired" after
        48 h. Setu does not alert the police or an ambulance — call 112 / 108 when needed.
      </p>
      {err && <p className="gps-status err">{err}</p>}
      {alerts && alerts.length === 0 && <div className="empty-state"><strong>No open alerts</strong></div>}
      {(alerts ?? []).map((a) => (
        <div key={a.id} className={`report-card sos-op ${a.status}`}>
          <strong>
            #{a.id} · {KIND_LABEL[a.kind]} · {ago(a.created_at)}
          </strong>
          {a.flood_suspect && (
            <small className="flood-mark">
              Possible flood: many alerts from the same network in the last hour. Still check it — real alerts can be among
              them.
            </small>
          )}
          {a.asked_at && utc(a.created_at).getTime() - utc(a.asked_at).getTime() > 2 * 60_000 && (
            <small className="flood-mark">
              Sent from the phone {ago(a.asked_at)} (phone clock) but received {ago(a.created_at)} — it waited without a
              connection. The position may be old.
            </small>
          )}
          <small>{where(a)}</small>
          {a.note && <p className="sos-op-note">“{a.note}”</p>}
          <small>
            {a.status === "acknowledged"
              ? `Acknowledged ${ago(a.ack_at ?? a.created_at)}${a.ack_message ? ` — “${a.ack_message}”` : ""}`
              : "Not acknowledged yet"}
            {a.lang ? ` · visitor's language: ${a.lang}` : ""}
          </small>
          <div className="tool-row">
            <select
              value=""
              onChange={(e) => setMsg((m) => ({ ...m, [a.id]: e.target.value }))}
              aria-label="Message presets"
            >
              <option value="">Message…</option>
              {PRESETS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <input
              value={msg[a.id] ?? ""}
              onChange={(e) => setMsg((m) => ({ ...m, [a.id]: e.target.value }))}
              placeholder="Message to the visitor (optional)"
              maxLength={200}
            />
          </div>
          <div className="report-actions">
            <button type="button" className="btn primary" disabled={busy === a.id} onClick={() => void act(a, "ack")}>
              {a.status === "acknowledged" ? "Update message" : "Acknowledge"}
            </button>
            <button type="button" className="btn soft" disabled={busy === a.id} onClick={() => void act(a, "resolve")}>
              Resolve
            </button>
            {a.kind === "lost" && (
              <button
                type="button"
                className="btn soft"
                onClick={() => onOpenCase({ id: a.id, note: a.note, placeCode: a.place_code })}
              >
                Open lost-person case
              </button>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
