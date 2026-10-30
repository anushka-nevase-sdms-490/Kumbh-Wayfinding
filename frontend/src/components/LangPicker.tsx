import { useI18n } from "../i18n/context";
import { LANGS } from "../i18n/messages";

/** English / हिंदी / मराठी — each label in its own language. */
export function LangPicker({ compact = false }: { compact?: boolean }) {
  const { lang, setLang, t } = useI18n();
  return (
    <div className={`lang-picker ${compact ? "compact" : ""}`} role="group" aria-label={t("lang.label")}>
      {LANGS.map((l) => (
        <button
          key={l.id}
          type="button"
          lang={l.id}
          className={`filter-chip ${lang === l.id ? "active" : ""}`}
          aria-pressed={lang === l.id}
          onClick={() => setLang(l.id)}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
