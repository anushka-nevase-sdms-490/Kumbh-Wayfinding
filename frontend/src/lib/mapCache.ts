/**
 * The offline map saved on the phone. The service worker serves /map/ files
 * from this cache (cache-first, see vite.config.ts); `downloadOfflineMap`
 * fills it in advance so the map works with no network.
 */
import { isQuotaError } from "./packStore";

export const MAP_CACHE = `setu-map-${__MAP_BUILD__}`;
export const MAP_FILE_COUNT = __MAP_FILE_COUNT__;
export const MAP_BYTES = __MAP_BYTES__;

export function offlineMapSupported(): boolean {
  return typeof caches !== "undefined" && "serviceWorker" in navigator && MAP_FILE_COUNT > 0;
}

/** How many map files are already saved. */
export async function savedMapFiles(): Promise<number> {
  try {
    if (!(await caches.has(MAP_CACHE))) return 0;
    return (await (await caches.open(MAP_CACHE)).keys()).length;
  } catch {
    return 0;
  }
}

/** Fetch one map file and keep it — never an HTML page served in its place. */
async function saveMapFile(cache: Cache, url: string): Promise<void> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok || (res.headers.get("content-type") ?? "").includes("text/html")) {
    throw new Error(`Not a map file: ${url}`);
  }
  await cache.put(url, res);
}

/** The phone ran out of storage while saving the map (the part saved so far is kept). */
export class MapStorageFullError extends Error {
  constructor() {
    super("Not enough storage for the offline map");
  }
}

/** Free storage this site may still use (bytes), when the browser says. */
export async function freeStorageBytes(): Promise<number | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est || typeof est.quota !== "number" || typeof est.usage !== "number") return null;
    return Math.max(0, est.quota - est.usage);
  } catch {
    return null;
  }
}

/** Download every map file not saved yet. Resumes where an earlier try stopped. */
export async function downloadOfflineMap(
  onProgress: (done: number, total: number) => void
): Promise<void> {
  // The file list is large: load it only when downloading.
  const { MAP_URLS } = await import("./mapDownload");
  const cache = await caches.open(MAP_CACHE);
  const have = new Set((await cache.keys()).map((r) => new URL(r.url).pathname));
  const todo = MAP_URLS.filter((u) => !have.has(new URL(u, location.origin).pathname));
  const total = MAP_URLS.length;
  let done = total - todo.length;
  let failed = 0;
  let full = false;
  onProgress(done, total);
  for (let i = 0; i < todo.length && !full; i += 20) {
    await Promise.all(
      todo.slice(i, i + 20).map((u) =>
        saveMapFile(cache, u).then(
          () => (done += 1),
          (e) => {
            failed += 1;
            if (isQuotaError(e)) full = true;
          }
        )
      )
    );
    onProgress(done, total);
  }
  // Storage full: stop (more tries cannot help); what is saved stays for later.
  if (full) throw new MapStorageFullError();
  if (failed > 0) throw new Error(`${failed} map files did not download`);
  // Maps from older basemap builds are no longer used.
  for (const key of await caches.keys()) {
    if (key.startsWith("setu-map-") && key !== MAP_CACHE) await caches.delete(key);
  }
  void navigator.storage?.persist?.().catch(() => false);
}
