import { useI18n } from "../i18n/context";
import { opStatus, trustOf } from "../lib/placeInfo";
import type { QrNode } from "../lib/types";

type Props = {
  node: QrNode;
  /** Lists: status only when it is known, plus a short trust word. */
  compact?: boolean;
};

/** "Closed · confirmed until 18:00", "Checked on site 29 Oct", "Step-free" — never more than recorded. */
export function PlaceBadges({ node, compact = false }: Props) {
  const { t, lang } = useI18n();
  const status = opStatus(node);
  const trust = trustOf(node);
  const time = (d: Date) => d.toLocaleTimeString(`${lang}-IN`, { hour: "2-digit", minute: "2-digit" });
  const day = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString(`${lang}-IN`, { day: "numeric", month: "short" });

  const statusChip =
    status.kind === "open" || status.kind === "limited" || status.kind === "closed" ? (
      <span className={`badge status-${status.kind}`} title={status.note ?? undefined}>
        {t(`status.${status.kind}`)}
        {!compact && <> · {t("status.until", { time: time(status.until) })}</>}
      </span>
    ) : compact ? null : (
      <span className="badge status-none">{t(status.kind === "expired" ? "status.expired" : "status.unknown")}</span>
    );

  const trustText =
    trust.kind === "field"
      ? trust.date && !compact
        ? t("trust.fieldOn", { date: day(trust.date) })
        : t("trust.field")
      : trust.kind === "official"
        ? trust.date && !compact
          ? t("trust.officialOn", { date: day(trust.date) })
          : t("trust.official")
        : trust.kind === "reviewed"
          ? t("trust.reviewed")
          : compact
            ? null
            : t("trust.map");

  return (
    <span className={`badges ${compact ? "compact" : ""}`}>
      {statusChip}
      {trustText && <span className={`badge trust-${trust.kind}`}>{trustText}</span>}
      {node.step_free && <span className="badge access">{t("access.stepFree")}</span>}
      {node.access === "restricted" && (
        <span className="badge access-restricted" title={node.access_note ?? undefined}>
          {t("access.restricted")}
          {!compact && node.access_note ? ` · ${node.access_note}` : ""}
        </span>
      )}
      {!compact && status.kind !== "unknown" && status.kind !== "expired" && status.note && (
        <span className="badge note">{status.note}</span>
      )}
    </span>
  );
}
