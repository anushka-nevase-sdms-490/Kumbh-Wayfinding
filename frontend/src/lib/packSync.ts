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
