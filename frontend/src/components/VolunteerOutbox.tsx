import { useEffect, useState } from "react";
import {
  OUTBOX_EVENT,
  authSender,
  dismissOutboxItem,
  flushOutbox,
  idbOutbox,
  type OutboxItem,
} from "../lib/outbox";
import { useI18n } from "../i18n/context";
import "./Volunteer.css";

type Props = { apiBase: string; volunteerId: number | null };

/** Changes saved on this phone that are not on the server yet. */
export function VolunteerOutbox({ apiBase, volunteerId }: Props) {
  const { t, lang } = useI18n();
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** Waiting change the volunteer tapped "Cancel" on once (tap again to remove). */
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      void idbOutbox.list().then(
        (list) => alive && setItems(list),
        () => alive && setItems([])
      );
    load();
    window.addEventListener(OUTBOX_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(OUTBOX_EVENT, load);
    };
  }, []);

  const labelOf = (i: OutboxItem) => (i.labelKey ? t(i.labelKey, i.labelVars) : i.label);
  // The server's own reason is shown as it wrote it; reasons made on the phone are translated.
  const errorOf = (i: OutboxItem) =>
    i.errorKey
      ? t(i.errorKey, {
          ...i.errorVars,
          ...(i.parentLabel ? { label: t(i.parentLabel.key, i.parentLabel.vars) } : {}),
        })
      : (i.error ?? t("vol.outbox.refusedDefault"));

  if (items.length === 0) return null;
  const waiting = items.filter((i) => i.status === "waiting");
  const refused = items.filter((i) => i.status === "refused");
  const others = waiting.filter((i) => i.volunteerId !== volunteerId).length;

  async function sendNow() {
    setBusy(true);
    setNote(null);
    try {
      const r = await flushOutbox(authSender(apiBase));
      setNote(
        r.waiting > 0 && r.sent === 0
          ? t("vol.outbox.stillOffline")
          : r.refused
            ? t("vol.outbox.sentRefused", { n: r.sent, r: r.refused })
            : t("vol.outbox.sent", { n: r.sent })
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`volunteer-card outbox${refused.length ? " warn" : ""}`} role="status">
      <h3>
        {waiting.length === 1
          ? t("vol.outbox.waitingOne")
          : waiting.length > 1
            ? t("vol.outbox.waitingMany", { n: waiting.length })
            : t("vol.outbox.notSaved")}
      </h3>
      {others > 0 && (
        <p className="field-hint">{t("vol.outbox.others", { n: others })}</p>
      )}
      <ul className="outbox-list">
        {items.map((i) => (
          <li key={i.id} className={i.status}>
            <span>
              <strong>{labelOf(i)}</strong>
              <small>
                {new Date(i.createdAt).toLocaleString(`${lang}-IN`, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                {" · "}
                {i.status === "waiting"
                  ? t("vol.outbox.waiting")
                  : i.errorKey
                    ? errorOf(i)
                    : t("vol.outbox.refused", { why: errorOf(i) })}
              </small>
            </span>
            {i.status === "refused" ? (
              <button type="button" className="btn soft" onClick={() => void dismissOutboxItem(i.id)}>
                {t("vol.outbox.dismiss")}
              </button>
            ) : (
              <button
                type="button"
                className="btn soft"
                onClick={() => {
                  if (confirmId === i.id) void dismissOutboxItem(i.id);
                  else setConfirmId(i.id);
                }}
              >
                {confirmId === i.id ? t("vol.outbox.cancelConfirm") : t("vol.outbox.cancel")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {waiting.length > 0 && (
        <button type="button" className="btn primary" disabled={busy} onClick={() => void sendNow()}>
          {busy ? t("vol.outbox.sending") : t("vol.outbox.send")}
        </button>
      )}
      {note && <p className="field-hint">{note}</p>}
    </div>
  );
}
