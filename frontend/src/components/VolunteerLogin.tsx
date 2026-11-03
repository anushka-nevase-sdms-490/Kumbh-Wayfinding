import { useState } from "react";
import { login, type StoredAuth } from "../lib/auth";
import { useI18n } from "../i18n/context";
import "./Volunteer.css";

type Props = {
  apiBase: string;
  onSignedIn: (auth: StoredAuth) => void;
  onBack: () => void;
  /** Shown over a form whose sign-in just expired (the form keeps what was typed). */
  overlay?: boolean;
};

/** Volunteer sign-in: phone number + 6-digit PIN from the admin. */
export function VolunteerLogin({ apiBase, onSignedIn, onBack, overlay = false }: Props) {
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { t } = useI18n();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (phone.replace(/\D/g, "").length < 10) {
      setErr(t("vol.login.enterPhone"));
      return;
    }
    if (!/^\d{6}$/.test(pin)) {
      setErr(t("vol.login.pinDigits"));
      return;
    }
    setBusy(true);
    const result = await login(apiBase, phone, pin);
    setBusy(false);
    if (result.ok) {
      setPin("");
      onSignedIn(result.auth);
    } else {
      setErr(result.message ?? t(result.offline ? "vol.login.offline" : "vol.login.failed"));
    }
  }

  const body = (
    <section className={`screen flow volunteer-screen ${overlay ? "login-sheet" : ""}`}>
      <header className="volunteer-head">
        <button type="button" className="back" onClick={onBack} aria-label={t("vol.back")}>
          ←
        </button>
        <div>
          <h2>{overlay ? t("vol.login.again") : t("vol.login.title")}</h2>
          <p>{overlay ? t("vol.login.againHint") : t("vol.login.hint")}</p>
        </div>
      </header>
      <form className="volunteer-form" onSubmit={submit}>
        <label>
          {t("vol.login.phone")}
          <input
            type="tel"
            inputMode="tel"
            autoComplete="username"
            // Opened over a form (signed out mid-task): focus moves into the dialog.
            autoFocus={overlay}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="98765 43210"
            required
          />
        </label>
        <label>
          {t("vol.login.pin")}
          <input
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            pattern="\d{6}"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            placeholder={t("vol.login.pinPlaceholder")}
            required
          />
        </label>
        {err && (
          <p className="gps-status err" role="alert">
            {err}
          </p>
        )}
        <button type="submit" className="btn primary block" disabled={busy}>
          {busy ? t("vol.login.signingIn") : t("vol.login.signIn")}
        </button>
        <p className="field-hint">{t("vol.login.footer")}</p>
      </form>
    </section>
  );

  return overlay ? <div className="login-overlay" role="dialog" aria-modal="true" aria-label={t("vol.login.title")}>{body}</div> : body;
}
