import { useState } from "react";
import { useI18n } from "../i18n/context";
import { ask, SAFETY_TIPS, type Answer, type PlaceHit } from "../lib/assistant";
import type { QrNode } from "../lib/types";
import { PlaceBadges } from "./PlaceBadges";

type Props = {
  /** "Send SOS" with the question as the note. */
  onSos: (note: string) => void;
  places: QrNode[];
  from: { lat: number; lon: number } | null;
  /** "30 Oct, 14:05" — when the saved data was made (freshness). */
  dataTime: string | null;
  onBack: () => void;
  onRoute: (node: QrNode) => void;
};

const QUICK = [
  ["medical", "nearest hospital"],
  ["toilet", "nearest toilet"],
  ["water", "drinking water"],
  ["help", "help desk"],
  ["lost", "lost person"],
  ["safety", "safety tips"],
] as const;

/** "Ask Setu": offline answers from the saved data only (lib/assistant.ts). */
export function AssistantScreen({ onSos, places, from, dataTime, onBack, onRoute }: Props) {
  const { t, placeLabel, dist } = useI18n();
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);

  const run = (question: string) => setAnswer(ask(question, { places, from }));

  const placeRow = (h: PlaceHit) => (
    <button key={h.node.code} type="button" className="place" onClick={() => onRoute(h.node)}>
      <span className="place-text">
        <strong>{placeLabel(h.node)}</strong>
        <small>
          {h.distanceM != null ? `${dist(h.distanceM)} · ` : ""}
          {t("ask.showWay")}
        </small>
        <PlaceBadges node={h.node} />
      </span>
    </button>
  );

  return (
    <section className="screen flow ask-screen">
      <div className="topbar">
        <button type="button" className="back" onClick={onBack} aria-label={t("app.back")}>
          ←
        </button>
        <div className="topbar-text">
          <h2>{t("ask.title")}</h2>
          <p>{t("ask.subtitle")}</p>
        </div>
      </div>

      <p className="ask-emergency-line" role="note">
        {t("ask.alwaysEmergency")} ·{" "}
        <a href="tel:112">{t("sos.call112")}</a> ·{" "}
        <button type="button" className="linklike" onClick={() => onSos(q)}>
          {t("ask.sendSos")}
        </button>
      </p>

      <form
        className="board-row"
        onSubmit={(e) => {
          e.preventDefault();
          run(q);
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ask.placeholder")} aria-label={t("ask.title")} maxLength={200} />
        <button type="submit" className="btn primary" disabled={!q.trim()}>
          {t("ask.go")}
        </button>
      </form>
      <div className="sos-kinds">
        {QUICK.map(([key, question]) => (
          <button
            key={key}
            type="button"
            className="filter-chip"
            onClick={() => {
              setQ("");
              run(question);
            }}
          >
            {t(`ask.quick.${key}`)}
          </button>
        ))}
      </div>

      {answer && (
        <div className="ask-answer" role="status" aria-live="polite">
          {answer.kind === "emergency" && (
            <div className="ask-emergency" role="alert">
              <p>
                <strong>{t("ask.emergencyTitle")}</strong>
              </p>
              <p>{t("ask.emergencyCall")}</p>
              <div className="sos-calls">
                <a className="btn danger-solid" href="tel:112">
                  {t("sos.call112")}
                </a>
                <a className="btn soft" href="tel:108">
                  {t("sos.call108")}
                </a>
                <button type="button" className="btn danger-solid" onClick={() => onSos(q)}>
                  {t("ask.sendSos")}
                </button>
              </div>
              {answer.places.length > 0 && (
                <>
                  <p>{t("ask.emergencyNearest")}</p>
                  <div className="place-list">{answer.places.map(placeRow)}</div>
                </>
              )}
            </div>
          )}
          {answer.kind === "nearest" && (
            <>
              <p>
                <strong>{t("ask.nearest", { topic: t(`ask.topic.${answer.topic}`) })}</strong>
              </p>
              {!answer.anyFieldChecked && <p className="gps-status warn">{t("ask.noneChecked")}</p>}
              <div className="place-list">{answer.places.map(placeRow)}</div>
              {!from && <small>{t("ask.noPosition")}</small>}
            </>
          )}
          {answer.kind === "status" && <div className="place-list">{placeRow(answer.place)}</div>}
          {answer.kind === "none" && <p>{t("ask.none", { topic: t(`ask.topic.${answer.topic}`) })}</p>}
          {answer.kind === "safety" && (
            <>
              <p>
                <strong>{t("ask.safetyTitle")}</strong>
              </p>
              <ul>
                {SAFETY_TIPS.map((k) => (
                  <li key={k}>{t(`ask.tip.${k}`)}</li>
                ))}
              </ul>
            </>
          )}
          {answer.kind === "unknown" && <p>{t("ask.unknown")}</p>}
          {dataTime && answer.kind !== "safety" && answer.kind !== "unknown" && <small>{t("ask.dataFrom", { time: dataTime })}</small>}
        </div>
      )}
      <p className="field-hint">{t("ask.disclaimer")}</p>
    </section>
  );
}
