/**
 * Volunteer sign-in on this phone (backend app/auth.py). The token lasts one
 * shift; when the server says it has expired, `authFetch` forgets it and
 * tells the app to show the sign-in sheet again.
 */
export type Volunteer = { id: number; phone: string; name: string; role: "volunteer" | "operator" | "admin" };
export type StoredAuth = { token: string; expiresAt: string; volunteer: Volunteer };

const KEY = "setu-auth";
/** Fired on window when the sign-in is gone (expired, revoked, signed out). */
export const AUTH_EXPIRED_EVENT = "setu-auth-expired";

export function loadAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const auth = JSON.parse(raw) as StoredAuth;
    if (!auth?.token || !(new Date(auth.expiresAt).getTime() > Date.now())) return null;
    return auth;
  } catch {
    return null;
  }
}

export function saveAuth(auth: StoredAuth): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(auth));
  } catch {
    /* private mode: signed in until the page reloads */
  }
}

export function clearAuth(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** fetch with the volunteer's token; a 401 signs this phone out. */
export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const auth = loadAuth();
  const headers = new Headers(init.headers);
  if (auth) headers.set("Authorization", `Bearer ${auth.token}`);
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    clearAuth();
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
  return res;
}

export type LoginResult =
  | { ok: true; auth: StoredAuth }
  /** message: the server's reason (e.g. a PIN lock), or null → the screen says why in the visitor's language. */
  | { ok: false; message: string | null; offline: boolean };

export async function login(apiBase: string, phone: string, pin: string): Promise<LoginResult> {
  try {
    const res = await fetch(`${apiBase}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, pin }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      // A wrong number or PIN (or a paused account) is shown in the volunteer's
      // language; other refusals (e.g. too many tries from this network) as sent.
      const detail = res.status !== 401 && typeof data?.detail === "string" ? data.detail : null;
      return { ok: false, message: detail, offline: false };
    }
    // The server sends UTC without a zone.
    const expiresAt = String(data.expires_at);
    const auth: StoredAuth = {
      token: data.token,
      expiresAt: expiresAt.endsWith("Z") ? expiresAt : `${expiresAt}Z`,
      volunteer: data.volunteer,
    };
    saveAuth(auth);
    return { ok: true, auth };
  } catch {
    return { ok: false, message: null, offline: true };
  }
}

export async function logout(apiBase: string): Promise<void> {
  const auth = loadAuth();
  clearAuth();
  if (!auth) return;
  try {
    await fetch(`${apiBase}/api/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.token}` },
    });
  } catch {
    /* offline: the token still expires by itself */
  }
}
