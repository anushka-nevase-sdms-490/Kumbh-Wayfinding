/** Prefer a trusted public HTTPS origin (tunnel) for phone QR / GPS. */

function isLoopbackHost(host: string): boolean {
  return (
    !host ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1"
  );
}

function isLanIpHost(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/** Sync best-effort origin (env or current page). */
export function phoneAppBaseSync(): string {
  const fromEnv = (import.meta.env.VITE_PHONE_ORIGIN as string | undefined)?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  if (typeof window === "undefined") return "https://localhost:5173";
  return window.location.origin;
}

/** Resolve phone-openable origin — prefer trusted HTTPS tunnel from API. */
export async function phoneAppBase(): Promise<string> {
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    // Already on ngrok / real HTTPS host — use it.
    if (!isLoopbackHost(host) && !isLanIpHost(host)) {
      return window.location.origin;
    }
  }

  try {
    const port =
      typeof window !== "undefined" ? window.location.port || "5173" : "5173";
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 2500);
    const res = await fetch(
      `/api/network?frontend_port=${encodeURIComponent(port)}&scheme=https`,
      { signal: controller.signal }
    );
    window.clearTimeout(timer);
    if (res.ok) {
      const data = (await res.json()) as {
        public_url?: string | null;
        phone_urls?: string[];
      };
      if (data.public_url) return data.public_url.replace(/\/$/, "");
      // Prefer non-LAN first entry if present
      const preferred = data.phone_urls?.find(
        (u) => !/https?:\/\/\d+\.\d+\.\d+\.\d+/.test(u)
      );
      if (preferred) return preferred.replace(/\/$/, "");
    }
  } catch {
    /* fall through */
  }

  const fromEnv = (import.meta.env.VITE_PHONE_ORIGIN as string | undefined)?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  return phoneAppBaseSync();
}

/** API via Vite proxy (same origin) so phone/ngrok HTTPS can call the backend. */
export function apiBase(): string {
  const fromEnv = (import.meta.env.VITE_SETU_API as string | undefined)?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return "";
}

export function boardDeepLink(appBase: string, code: string): string {
  const base = appBase.replace(/\/$/, "");
  return `${base}/?board=${encodeURIComponent(code.toUpperCase())}`;
}
