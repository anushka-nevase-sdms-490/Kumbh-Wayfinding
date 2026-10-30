/**
 * Checks the server for a newer pack. Only the small version info is fetched
 * unless the signature differs from the pack the phone already has.
 */
import { isUsablePack, type OfflinePack } from "./types";

type PackMeta = { version: string; signature: string; node_count?: number; download_url: string };

/** The server answered, but with an error status. */
class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) throw new HttpError(res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export type PackCheck =
  | { kind: "newer"; pack: OfflinePack }
  | { kind: "same" }
  /** A damaged download — never replaces what the phone has. */
  | { kind: "rejected" }
  /** The server has no places yet (data not set up). */
  | { kind: "empty" }
  /** Something answered that is not the Setu API (e.g. another app on the port → 404). */
  | { kind: "wrong_server"; status: number }
  /** No answer at all (offline, server down, timeout). */
  | { kind: "unreachable" };

export async function fetchNewerPack(apiBase: string, current: OfflinePack): Promise<PackCheck> {
  let meta: PackMeta;
  try {
    meta = (await getJson(`${apiBase}/api/pack/latest`, 4000)) as PackMeta;
    if (typeof meta?.signature !== "string" || typeof meta.download_url !== "string") {
      return { kind: "wrong_server", status: 200 };
    }
  } catch (e) {
    // 5xx: the server is down or the proxy cannot reach it (Vite says 500,
    // Caddy 502) — "no connection", not a wrong server.
    if (e instanceof HttpError && e.status < 500) return { kind: "wrong_server", status: e.status };
    return { kind: "unreachable" };
  }
  if (meta.signature === current.signature) return { kind: "same" };
  if (meta.node_count === 0) return { kind: "empty" };
  try {
    const pack = await getJson(`${apiBase}${meta.download_url}`, 15000);
    if (isUsablePack(pack) && pack.signature === meta.signature) return { kind: "newer", pack };
    return { kind: "rejected" };
  } catch {
    return { kind: "unreachable" };
  }
}

/**
 * Hours without confirming that the saved data is current before the phone
 * warns: closures and facility changes during the Mela happen daily.
 */
export const STALE_AFTER_H = 12;

/**
 * Is the saved data possibly out of date? `since` is the last time the server
 * confirmed it (a check that answered "same" or brought a newer copy), or else
 * when the data was made. With no time at all it cannot be vouched for.
 */
export function dataStaleness(
  lastConfirmed: string | null,
  generatedAt: string | null | undefined,
  now: Date = new Date()
): { stale: boolean; since: string | null } {
  const since = [lastConfirmed, generatedAt].find((iso) => iso && !Number.isNaN(new Date(iso).getTime())) ?? null;
  if (!since) return { stale: true, since: null };
  return { stale: now.getTime() - new Date(since).getTime() > STALE_AFTER_H * 3600_000, since };
}

/**
 * While someone is being guided, check for new data (closures, rejected
 * lanes) at least this often: a lane closed on their route must reach them
 * mid-walk. Each check is a small version request, cached on the server.
 */
export const GUIDE_RECHECK_MS = 3 * 60 * 1000;

/** Should the phone check for new data now? Only while guiding and online. */
export function shouldRecheck(step: string, lastCheckMs: number, nowMs: number, online: boolean): boolean {
  return step === "guide" && online && nowMs - lastCheckMs >= GUIDE_RECHECK_MS;
}

export type RouteSnapshot = { version: string; key: string };

/**
 * Did new data change the route being followed? Only when there was a route
 * before (key "" = none), the data version changed and the route changed — a
 * newly chosen destination is not "the route was updated".
 */
export function routeChangedByData(prev: RouteSnapshot | null, cur: RouteSnapshot): boolean {
  return !!prev && prev.key !== "" && prev.version !== cur.version && prev.key !== cur.key;
}
