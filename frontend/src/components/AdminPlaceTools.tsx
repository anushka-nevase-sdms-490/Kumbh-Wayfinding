import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { authFetch } from "../lib/auth";
import "./Volunteer.css";

/**
 * The address printed boards point to. VITE_PUBLIC_ORIGIN (set at build time
 * for the public site) wins; otherwise the address this admin page is on —
 * which is wrong for a board when it is a test address (warned below).
 */
const BOARD_ORIGIN = (import.meta.env.VITE_PUBLIC_ORIGIN as string | undefined)?.replace(/\/+$/, "") || window.location.origin;
const TEST_ORIGIN = /^https?:\/\/(localhost|127\.|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|ngrok|\.local(:|$)|\.test(:|$)/i.test(BOARD_ORIGIN);

export type PlaceToolsPlace = {
  code: string;
  name: string;
  op_status?: string | null;
  op_status_until?: string | null;
  op_status_note?: string | null;
  step_free?: boolean | null;
  access?: string | null;
  access_note?: string | null;
  board_code?: string | null;
  verification?: string;
};

type Props = { apiBase: string; place: PlaceToolsPlace; onChanged: () => void };

const HOURS = [2, 6, 12, 24, 72];

function utc(iso: string): Date {
  return new Date(/[zZ]$/.test(iso) ? iso : `${iso}Z`);
}

/**
 * Admin tools on a place card: opening status (live, with an expiry),
 * step-free / access restrictions (published), and its QR board.
 */
export function AdminPlaceTools({ apiBase, place, onChanged }: Props) {
  const [hours, setHours] = useState(6);
  const [note, setNote] = useState("");
  const [stepFree, setStepFree] = useState<string>(place.step_free == null ? "" : place.step_free ? "yes" : "no");
  const [access, setAccess] = useState(place.access ?? "");
  const [accessNote, setAccessNote] = useState(place.access_note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmRetire, setConfirmRetire] = useState(false);

  async function post(url: string, body: unknown) {
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
      setConfirmRetire(false);
      onChanged();
    } catch {
      setErr("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  const until = place.op_status_until ? utc(place.op_status_until) : null;
  const live = place.op_status && until && until > new Date();
  const boardUrl = place.board_code ? `${BOARD_ORIGIN}/?at=${place.board_code}` : "";

  // "Tap again to retire" does not stay armed: an accidental second tap minutes later must not retire a board.
  useEffect(() => {
    if (!confirmRetire) return;
    const timer = window.setTimeout(() => setConfirmRetire(false), 5000);
    return () => window.clearTimeout(timer);
  }, [confirmRetire]);

  return (
    <div className="place-tools">
      <div className="tool-block">
        <strong>Opening status</strong>
        <small>
          {live
            ? `Now: ${place.op_status} until ${until!.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
            : place.op_status
              ? "Expired — visitors see “status not confirmed”"
              : "Not set — visitors see “status not confirmed”"}
          {place.op_status_note ? ` · ${place.op_status_note}` : ""}
        </small>
        <div className="tool-row">
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="Valid for">
            {HOURS.map((h) => (
              <option key={h} value={h}>
                valid {h < 24 ? `${h} h` : `${h / 24} day${h > 24 ? "s" : ""}`}
              </option>
            ))}
          </select>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" maxLength={120} />
        </div>
        <div className="report-actions">
          {(["open", "limited", "closed"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`btn soft ${s === "closed" ? "danger" : ""}`}
              disabled={busy}
              onClick={() => void post("/api/admin/place-status", { code: place.code, status: s, hours, note: note || null })}
            >
              {s === "open" ? "Open" : s === "limited" ? "Limited" : "Closed"}
            </button>
          ))}
          <button
            type="button"
            className="btn soft"
            disabled={busy || !place.op_status}
            onClick={() => void post("/api/admin/place-status", { code: place.code, status: "unknown" })}
          >
            Clear
          </button>
        </div>
        <small>Status reaches phones at once (no publishing needed) and stops being shown after its time.</small>
      </div>

      <div className="tool-block">
        <strong>Access</strong>
        <div className="tool-row">
          <select value={stepFree} onChange={(e) => setStepFree(e.target.value)} aria-label="Step-free">
            <option value="">Step-free: not known</option>
            <option value="yes">Step-free: yes</option>
            <option value="no">Step-free: no</option>
          </select>
          <select value={access} onChange={(e) => setAccess(e.target.value)} aria-label="Access">
            <option value="">Access: not set</option>
            <option value="public">Open to all</option>
            <option value="restricted">Restricted</option>
          </select>
        </div>
        <input
          value={accessNote}
          onChange={(e) => setAccessNote(e.target.value)}
          placeholder="e.g. women only, 6–22 h"
          maxLength={120}
        />
        <div className="report-actions">
          <button
            type="button"
            className="btn soft"
            disabled={busy}
            onClick={() =>
              void post("/api/admin/place-access", {
                code: place.code,
                step_free: stepFree === "" ? null : stepFree === "yes",
                access: access || null,
                access_note: accessNote || null,
              })
            }
          >
            Save access
          </button>
        </div>
        <small>Access details are published with the next Publish.</small>
      </div>

      <div className="tool-block">
        <strong>QR board</strong>
        {place.board_code ? (
          <>
            <div className="board-preview">
              <QRCodeSVG value={boardUrl} size={112} level="M" />
              <div>
                <span className="board-code">{place.board_code}</span>
                <small>{boardUrl}</small>
              </div>
            </div>
            {TEST_ORIGIN && (
              <p className="gps-status err" role="alert">
                This board would point to {BOARD_ORIGIN}, a test address — phones at the mela cannot open it. Print
                boards from the public Setu site (or build with VITE_PUBLIC_ORIGIN set to it).
              </p>
            )}
            <div className="report-actions">
              <button type="button" className="btn soft" onClick={() => window.print()}>
                Print board
              </button>
              <button
                type="button"
                className="btn soft danger"
                disabled={busy}
                onClick={() =>
                  confirmRetire ? void post("/api/admin/board/retire", { code: place.code }) : setConfirmRetire(true)
                }
              >
                {confirmRetire ? "Tap again: this code stops working" : "Retire (wrong place / removed)"}
              </button>
            </div>
            {/* Only this is printed (index.css @media print). */}
            <div className="print-board" aria-hidden>
              <h1>{place.name}</h1>
              <QRCodeSVG value={boardUrl} size={360} level="M" />
              <p className="print-code">{place.board_code}</p>
              <p>Scan with your phone camera, or open Setu and type this code.</p>
              <p>फ़ोन कैमरे से स्कैन करें, या Setu खोलकर यह कोड लिखें। · फोन कॅमेऱ्याने स्कॅन करा, किंवा Setu उघडून हा कोड लिहा.</p>
            </div>
          </>
        ) : (
          <>
            <small>No board yet. The QR will open Setu at this place; its short code can be typed offline.</small>
            <div className="report-actions">
              <button
                type="button"
                className="btn soft"
                disabled={busy || place.verification === "rejected"}
                onClick={() => void post("/api/admin/board", { code: place.code })}
              >
                Create board code
              </button>
            </div>
          </>
        )}
        <small>Creating or retiring a board code reaches phones at once. Physical boards need the authority's approval.</small>
      </div>
      {err && <p className="gps-status err">{err}</p>}
    </div>
  );
}
