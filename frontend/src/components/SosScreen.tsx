import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n/context";
import { createSos, httpTransport, idbSos, SOS_EVENT, type SosItem, type SosKind } from "../lib/sos";
import { haversineM, isRegisteredLocation, type QrNode } from "../lib/types";
import { PlaceBadges } from "./PlaceBadges";

type Props = {
  apiBase: string;
  places: QrNode[];
  /** Live GPS when usable. */
  position: { lat: number; lon: number; accuracyM: number } | null;
  /** The place the visitor said they are at, if any. */
  start: QrNode | null;
  device: string | null;
  onBack: () => void;
  onRoute: (node: QrNode) => void;
  /** From "Ask Setu": the visitor's own words, as the alert's note. */
  initialNote?: string;
};

const KINDS: SosKind[] = ["medical", "lost", "unsafe", "other"];

/**
 * "Need help?": an alert to Setu operators that is saved on the phone first and
 * shown with its true state (pending / sent / acknowledged). Not a call to the
 * police or an ambulance — 112 and 108 are offered as phone calls.
 */
export function SosScreen({ apiBase, places, position, start, device, onBack, onRoute, initialNote }: Props) {
  const { t, lang, placeLabel, dist } = useI18n();
  const [kind, setKind] = useState<SosKind | null>(null);
  const [note, setNote] = useState(initialNote ?? "");
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<SosItem[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () => void idbSos.list().then((l) => alive && setItems(l), () => alive && setItems([]));
    load();
    window.addEventListener(SOS_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(SOS_EVENT, load);
    };
  }, []);

  async function send() {
    if (!kind) return;
    setBusy(true);
    try {
      await createSos(
        {
          kind,
          note: note || null,
          lat: position?.lat ?? null,
          lon: position?.lon ?? null,
          accuracyM: position ? Math.round(position.accuracyM) : null,
          placeCode: position ? null : (start?.code ?? null),
          lang,
          device,
        },
        idbSos,
        httpTransport(apiBase)
      );
      setKind(null);
      setNote("");
    } finally {
      setBusy(false);
    }
  }

  // Nearest Lost & Found / help desks / police, from the saved data.
  const helpPlaces = useMemo(() => {
    const from = position ?? (start ? { lat: start.lat, lon: start.lon } : null);
    const list = places.filter((p) => isRegisteredLocation(p) && ["lost_found", "help", "police"].includes(p.node_type));
    return list
      .map((p) => ({ p, d: from ? haversineM(from.lat, from.lon, p.lat, p.lon) : null }))
      .sort((a, b) => (a.d ?? 0) - (b.d ?? 0))
      .slice(0, 4);
  }, [places, position, start]);

  const time = (iso?: string | null) =>
    iso
      ? new Date(/[zZ]$/.test(iso) ? iso : `${iso}Z`).toLocaleTimeString(`${lang}-IN`, { hour: "2-digit", minute: "2-digit" })
      : "";

  return (
    <section className="screen flow sos-screen">
      <div className="topbar">
        <button type="button" className="back" onClick={onBack} aria-label={t("app.back")}>
          ←
        </button>
        <div className="topbar-text">
          <h2>{t("sos.title")}</h2>
          <p>{t("sos.subtitle")}</p>
        </div>
      </div>

      <div className="sos-emergency" role="note">
        <p>
          <strong>{t("sos.emergency")}</strong>
        </p>
        <p>{t("sos.notEmergency")}</p>
        <div className="sos-calls">
          <a className="btn danger-solid" href="tel:112">
            {t("sos.call112")}
          </a>
          <a className="btn soft" href="tel:108">
            {t("sos.call108")}
          </a>
        </div>
      </div>

      <p className="section-label">{t("sos.kindLabel")}</p>
      <div className="sos-kinds" role="group" aria-label={t("sos.kindLabel")}>
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className={`filter-chip ${kind === k ? "active" : ""}`}
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
          >
            {t(`sos.kind.${k}`)}
          </button>
        ))}
      </div>
      <label className="sos-note">
        {t("sos.noteLabel")}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={280}
          rows={2}
          placeholder={t("sos.notePlaceholder")}
        />
      </label>
      <p className="gps-note">
        {position
          ? t("sos.whereGps", { acc: Math.round(position.accuracyM) })
          : start
            ? t("sos.wherePlace", { place: placeLabel(start) })
            : t("sos.whereNone")}
      </p>
      <button type="button" className="btn danger-solid block" disabled={!kind || busy} onClick={() => void send()}>
        {busy ? t("sos.sending") : t("sos.send")}
      </button>

      {items.length > 0 && (
        <>
          <p className="section-label">{t("sos.mine")}</p>
          <div className="sos-list">
            {items.map((i) => (
              <div key={i.clientId} className={`sos-item state-${i.state}`} role="status">
                <strong>
                  {t(`sos.kind.${i.kind}`)} · {time(i.createdAt)}
                </strong>
                <p>
                  {i.state === "pending"
                    ? t("sos.state.pending")
                    : i.state === "sent"
                      ? t("sos.state.sent", { time: time(i.receivedAt) })
                      : i.state === "acknowledged"
                        ? t("sos.state.acknowledged", { time: time(i.ackAt) })
                        : i.state === "resolved"
                          ? t("sos.state.resolved")
                          : i.state === "expired"
                            ? t("sos.state.expired")
                            : t("sos.state.refused", { why: i.error ?? "" })}
                </p>
                {i.ackMessage && <p className="sos-msg">{t("sos.opMessage", { msg: i.ackMessage })}</p>}
                {(i.state === "pending" || i.state === "sent") && <small>{t("sos.urgent")}</small>}
                {(i.state === "resolved" || i.state === "expired" || i.state === "refused") && (
                  <button type="button" className="btn soft" onClick={() => void idbSos.remove(i.clientId).then(() => setItems((l) => l.filter((x) => x.clientId !== i.clientId)))}>
                    {t("sos.remove")}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="sos-lost">
        <h3>{t("sos.lostTitle")}</h3>
        <p className="gps-note">{t("sos.lostHint")}</p>
        {helpPlaces.length === 0 ? (
          <p className="gps-note">{t("sos.noHelpPlaces")}</p>
        ) : (
          <div className="place-list">
            {helpPlaces.map(({ p, d }) => (
              <button key={p.code} type="button" className="place" onClick={() => onRoute(p)}>
                <span className="place-text">
                  <strong>{placeLabel(p)}</strong>
                  <small>
                    {d != null ? `${dist(d)} · ` : ""}
                    {t("sos.showWay")}
                  </small>
                  <PlaceBadges node={p} compact />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
