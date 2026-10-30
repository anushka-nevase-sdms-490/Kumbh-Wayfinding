/** API via Vite proxy (same origin) so phone/ngrok HTTPS can call the backend. */
export function apiBase(): string {
  const fromEnv = (import.meta.env.VITE_SETU_API as string | undefined)?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return "";
}

/** Browsers only give GPS and motion sensors to HTTPS pages (or localhost). */
export function isSecureEnough(): boolean {
  if (typeof window === "undefined") return false;
  if (window.isSecureContext) return true;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}
