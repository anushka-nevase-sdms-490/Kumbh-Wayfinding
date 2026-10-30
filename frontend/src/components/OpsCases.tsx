import { useCallback, useEffect, useState } from "react";
import { authFetch } from "../lib/auth";
import { isRegisteredLocation, type QrNode } from "../lib/types";
import "./Volunteer.css";

type Summary = {
  case_ref: string;
  status: string;
  person_name: string | null;
  approx_age: number | null;
  is_child: boolean;
  description: string;
  last_seen_place_code: string | null;
  last_seen_at: string | null;
  reporter_contact: string | null;
  updated_at: string;
  version: number;
};
type Detail = Summary & {
  gender: string | null;
  languages: string | null;
  last_seen_note: string | null;
  reporter_name: string | null;
  outcome_note: string | null;
  sos_id: number | null;
  created_at: string;
  closed_at: string | null;
  allowed: string[];
  history: { at: string; actor: string | null; action: string; from: string | null; to: string | null; note: string | null }[];
};
type Form = {
  person_name: string;
  approx_age: string;
  gender: string;
  description: string;
  languages: string;
  last_seen_place_code: string;
  last_seen_note: string;
  reporter_name: string;
  reporter_contact: string;
};

const EMPTY: Form = {
  person_name: "",
  approx_age: "",
  gender: "",
  description: "",
  languages: "",
  last_seen_place_code: "",
  last_seen_note: "",
  reporter_name: "",
  reporter_contact: "",
};
const STATUS_LABEL: Record<string, string> = {
  NEW: "New",
  UNDER_REVIEW: "Under review",
  POSSIBLE_MATCH: "Possible match",
  ESCALATED: "Escalated",
  REUNITED: "Reunited",
  CLOSED: "Closed",
};

export type CasePrefill = { sosId: number; note: string | null; placeCode: string | null };

type Props = {
  apiBase: string;
  places: QrNode[];
  prefill: CasePrefill | null;
  onBack: () => void;
  /** Optional helper that turns a free-text report into suggested fields (Phase 7). */
  renderReportHelper?: (apply: (fields: Partial<Form>) => void) => React.ReactNode;
};

function utc(iso: string): Date {
  return new Date(/[zZ]$/.test(iso) ? iso : `${iso}Z`);
}

function toBody(f: Form) {
  const t = (s: string) => s.trim() || null;
  return {
    person_name: t(f.person_name),
    approx_age: f.approx_age.trim() ? Number(f.approx_age) : null,
    gender: t(f.gender),
    description: f.description.trim(),
    languages: t(f.languages),
    last_seen_place_code: t(f.last_seen_place_code),
    last_seen_note: t(f.last_seen_note),
    reporter_name: t(f.reporter_name),
    reporter_contact: t(f.reporter_contact),
  };
}

/**
 * Operators: lost-person cases. Minimal details; every change is in the case
 * history; a stale edit is refused instead of overwriting a colleague's.
 * People decide every status — nothing is matched automatically.
 */
export function OpsCases({ apiBase, places, prefill, onBack, renderReportHelper }: Props) {
  const [list, setList] = useState<Summary[] | null>(null);
  const [filter, setFilter] = useState("open");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Detail | null>(null);
  const [form, setForm] = useState<Form | null>(prefill ? { ...EMPTY, last_seen_note: prefill.note ?? "", last_seen_place_code: prefill.placeCode ?? "" } : null);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const named = places.filter(isRegisteredLocation);
  const placeName = (code: string | null) => (code ? (named.find((p) => p.code === code)?.name ?? code) : "—");

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`${apiBase}/api/ops/cases?status=${filter}&q=${encodeURIComponent(q)}`);
      if (!res.ok) {
        setErr(
          res.status === 404
            ? "Lost-person cases are not enabled on this server (they need the authority's approval)."
            : res.status === 403
              ? "Only operators and admins can see cases."
              : "Could not load cases."
        );
        setList([]);
        return;
      }
      setList((await res.json()) as Summary[]);
      setErr(null);
    } catch {
      setErr("No connection to the server.");
    }
  }, [apiBase, filter, q]);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(url: string, method: string, body: unknown): Promise<Detail | null> {
    setBusy(true);
    setErr(null);
    try {
      const res = await authFetch(`${apiBase}${url}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => null);
      if (!res.ok) {
        setErr(typeof out?.detail === "string" ? out.detail : "Could not save");
        if (res.status === 409 && open) await openCase(open.case_ref);
        return null;
      }
      await load();
      return out as Detail;
    } catch {
      setErr("No connection to the server — the change was not saved.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function openCase(ref: string) {
    const res = await authFetch(`${apiBase}/api/ops/cases/${ref}`);
    if (res.ok) {
      setOpen((await res.json()) as Detail);
      setEditing(false);
      setNote("");
    }
  }

  const fields = (f: Form, set: (f: Form) => void) => (
    <div className="volunteer-form case-form">
      {renderReportHelper?.((p) => set({ ...f, ...p }))}
      <label>
        Description (clothing, looks) *
        <textarea rows={2} value={f.description} maxLength={500} onChange={(e) => set({ ...f, description: e.target.value })} />
      </label>
      <div className="tool-row">
        <label>
          Name (if known)
          <input value={f.person_name} maxLength={80} onChange={(e) => set({ ...f, person_name: e.target.value })} />
        </label>
        <label>
          Age (about)
          <input value={f.approx_age} inputMode="numeric" maxLength={3} onChange={(e) => set({ ...f, approx_age: e.target.value.replace(/\D/g, "") })} />
        </label>
        <label>
          Gender
          <input value={f.gender} maxLength={12} onChange={(e) => set({ ...f, gender: e.target.value })} />
        </label>
      </div>
      <label>
        Languages spoken
        <input value={f.languages} maxLength={60} onChange={(e) => set({ ...f, languages: e.target.value })} />
      </label>
      <label>
        Last seen at (place)
        <select value={f.last_seen_place_code} onChange={(e) => set({ ...f, last_seen_place_code: e.target.value })}>
          <option value="">Not known / other</option>
          {named.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Last seen — details
        <input value={f.last_seen_note} maxLength={200} onChange={(e) => set({ ...f, last_seen_note: e.target.value })} />
      </label>
      <div className="tool-row">
        <label>
          Reporter
          <input value={f.reporter_name} maxLength={80} onChange={(e) => set({ ...f, reporter_name: e.target.value })} />
        </label>
        <label>
          Reporter phone
          <input value={f.reporter_contact} inputMode="tel" maxLength={20} onChange={(e) => set({ ...f, reporter_contact: e.target.value })} />
        </label>
      </div>
      <small>Collect only what helps find the person. A child's (under 18) phone number is hidden in lists.</small>
    </div>
  );

  // ---------- creating ----------
  if (form && !open) {
    return (
      <section className="screen flow volunteer-screen">
        <header className="volunteer-head">
          <button type="button" className="back" onClick={() => setForm(null)} aria-label="Back">
            ←
          </button>
          <div>
            <h2>New lost-person case</h2>
            <p>{prefill ? `From SOS alert #${prefill.sosId}` : "Minimal details only"}</p>
          </div>
        </header>
        {fields(form, setForm)}
        {err && <p className="gps-status err">{err}</p>}
        <button
          type="button"
          className="btn primary block"
          disabled={busy || form.description.trim().length < 3}
          onClick={async () => {
            const d = await call("/api/ops/cases", "POST", { ...toBody(form), sos_id: prefill?.sosId ?? null });
            if (d) {
              setForm(null);
              setOpen(d);
            }
          }}
        >
          Open case
        </button>
      </section>
    );
  }

  // ---------- one case ----------
  if (open) {
    const f: Form = {
      person_name: open.person_name ?? "",
      approx_age: open.approx_age != null ? String(open.approx_age) : "",
      gender: open.gender ?? "",
      description: open.description,
      languages: open.languages ?? "",
      last_seen_place_code: open.last_seen_place_code ?? "",
      last_seen_note: open.last_seen_note ?? "",
      reporter_name: open.reporter_name ?? "",
      reporter_contact: open.reporter_contact ?? "",
    };
    return (
      <section className="screen flow volunteer-screen">
        <header className="volunteer-head">
          <button type="button" className="back" onClick={() => setOpen(null)} aria-label="Back">
            ←
          </button>
          <div>
            <h2>
              {open.case_ref} · {STATUS_LABEL[open.status]}
            </h2>
            <p>
              {open.is_child ? "Child · " : ""}Opened {utc(open.created_at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              {open.sos_id ? ` · from SOS #${open.sos_id}` : ""}
            </p>
          </div>
        </header>
        {err && <p className="gps-status err">{err}</p>}
        {editing ? (
          <CaseEdit
            initial={f}
            fields={fields}
            busy={busy}
            onCancel={() => setEditing(false)}
            onSave={async (nf) => {
              const d = await call(`/api/ops/cases/${open.case_ref}`, "PUT", { ...toBody(nf), version: open.version });
              if (d) {
                setOpen(d);
                setEditing(false);
              }
            }}
          />
        ) : (
          <div className="report-card">
            <p>{open.description}</p>
            <small>
              {[open.person_name, open.approx_age != null ? `about ${open.approx_age}` : null, open.gender, open.languages]
                .filter(Boolean)
                .join(" · ") || "No name or age given"}
            </small>
            <small>
              Last seen: {placeName(open.last_seen_place_code)}
              {open.last_seen_note ? ` — ${open.last_seen_note}` : ""}
            </small>
            <small>
              Reporter: {open.reporter_name ?? "—"} {open.reporter_contact ? `· ${open.reporter_contact}` : ""}
            </small>
            {open.outcome_note && <small>Outcome: {open.outcome_note}</small>}
            {open.status !== "CLOSED" && (
              <div className="report-actions">
                <button type="button" className="btn soft" onClick={() => setEditing(true)}>
                  Edit details
                </button>
              </div>
            )}
          </div>
        )}
        {open.allowed.length > 0 && !editing && (
          <div className="report-card">
            <strong>Change status</strong>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Note (needed for Escalated, Reunited, Closed)" />
            <div className="report-actions">
              {open.allowed.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`btn ${s === "REUNITED" ? "primary" : "soft"}`}
                  disabled={busy}
                  onClick={async () => {
                    const d = await call(`/api/ops/cases/${open.case_ref}/status`, "POST", { to: s, note: note || null, version: open.version });
                    if (d) {
                      setOpen(d);
                      setNote("");
                    }
                  }}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
            <small>Only people decide a match or a reunion. Check identity in person before marking Reunited.</small>
          </div>
        )}
        <div className="admin-audit">
          <strong>History</strong>
          <ul>
            {open.history.map((h, i) => (
              <li key={i}>
                <small>
                  {utc(h.at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {h.actor ?? "?"}
                </small>
                <span>
                  {h.action === "created" ? "Case opened" : h.action === "edited" ? "Details edited" : `${STATUS_LABEL[h.from ?? ""] ?? h.from} → ${STATUS_LABEL[h.to ?? ""] ?? h.to}`}
                  {h.note ? ` — ${h.note}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    );
  }

  // ---------- list ----------
  return (
    <section className="screen flow volunteer-screen">
      <header className="volunteer-head">
        <button type="button" className="back" onClick={onBack} aria-label="Back">
          ←
        </button>
        <div>
          <h2>Lost persons</h2>
          <p>{list ? `${list.length} case${list.length === 1 ? "" : "s"}` : "Loading…"}</p>
        </div>
      </header>
      <div className="tool-row">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Status filter">
          <option value="open">Open cases</option>
          {Object.keys(STATUS_LABEL).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search case no., name, description" />
      </div>
      <button type="button" className="btn primary block" onClick={() => setForm({ ...EMPTY })}>
        New case
      </button>
      {err && <p className="gps-status err">{err}</p>}
      {(list ?? []).map((c) => (
        <button key={c.case_ref} type="button" className="report-card case-row" onClick={() => void openCase(c.case_ref)}>
          <strong>
            {c.case_ref} · {STATUS_LABEL[c.status]} {c.is_child ? "· Child" : ""}
          </strong>
          <small>
            {c.person_name ?? "Name not known"}
            {c.approx_age != null ? `, about ${c.approx_age}` : ""} — {c.description}
          </small>
          <small>
            Last seen: {placeName(c.last_seen_place_code)} · reporter {c.reporter_contact ?? "—"}
          </small>
        </button>
      ))}
    </section>
  );
}

function CaseEdit({
  initial,
  fields,
  busy,
  onCancel,
  onSave,
}: {
  initial: Form;
  fields: (f: Form, set: (f: Form) => void) => React.ReactNode;
  busy: boolean;
  onCancel: () => void;
  onSave: (f: Form) => void;
}) {
  const [f, setF] = useState(initial);
  return (
    <>
      {fields(f, setF)}
      <div className="report-actions">
        <button type="button" className="btn primary" disabled={busy || f.description.trim().length < 3} onClick={() => onSave(f)}>
          Save
        </button>
        <button type="button" className="btn soft" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </>
  );
}
