/**
 * Keeps the offline pack on the phone (IndexedDB), so the app has its places
 * and lanes with no network. Never throws: private browsing, a full phone or
 * a broken database are reported, and the app keeps working with what it has.
 */
import { BUNDLED_SIGNATURE } from "./fallbackPack";
import { isUsablePack, type OfflinePack } from "./types";

const DB_NAME = "setu";
const STORE = "pack";
const KEY = "current";

export type StoredPack = {
  pack: OfflinePack;
  savedAt: string;
  /** FNV-1a of the pack as saved: detects a damaged copy on load. */
  checksum?: string;
};

export type LoadResult =
  | { kind: "ok"; stored: StoredPack }
  | { kind: "empty" }
  /** The saved copy was damaged; it was removed (a new one downloads when online). */
  | { kind: "corrupt" }
  /** No storage here (private browsing, blocked, or a broken database that was reset). */
  | { kind: "unavailable"; reset: boolean };

export type SaveResult = "saved" | "quota" | "unavailable" | "skipped";

/** 32-bit FNV-1a of the pack's JSON — cheap, enough to notice damage. */
export function packChecksum(pack: OfflinePack): string {
  const text = JSON.stringify(pack);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Whether a record read back from storage is a whole, undamaged pack. */
export function checkStored(value: unknown): StoredPack | null {
  const v = value as StoredPack | null;
  if (!v || !isUsablePack(v.pack) || typeof v.savedAt !== "string") return null;
  if (v.checksum && v.checksum !== packChecksum(v.pack)) return null;
  return v;
}

/** The browser said storage is full. */
export function isQuotaError(e: unknown): boolean {
  const err = e as { name?: string; code?: number; message?: string } | null;
  return (
    !!err &&
    (err.name === "QuotaExceededError" ||
      err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      err.code === 22 ||
      /quota/i.test(err.message ?? ""))
  );
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

function deleteDb(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
      req.onblocked = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

function removeRecord(db: IDBDatabase): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function loadStoredPack(): Promise<LoadResult> {
  if (typeof indexedDB === "undefined") return { kind: "unavailable", reset: false };
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch (e) {
    // A database the browser can no longer open is useless: start a fresh one
    // (the data downloads again when online).
    const name = (e as { name?: string } | null)?.name;
    // Only a broken database is reset. VersionError means a newer app version
    // owns it (this tab is an old one still running): never delete its data.
    const reset = name === "UnknownError" ? await deleteDb() : false;
    return { kind: "unavailable", reset };
  }
  try {
    const raw = await new Promise<unknown>((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (raw === undefined || raw === null) return { kind: "empty" };
    const stored = checkStored(raw);
    if (!stored) {
      await removeRecord(db);
      return { kind: "corrupt" };
    }
    return { kind: "ok", stored };
  } catch {
    return { kind: "unavailable", reset: false };
  } finally {
    db.close();
  }
}

/** Save a pack that came from the server, in one transaction (all or nothing). */
export async function saveStoredPack(pack: OfflinePack): Promise<SaveResult> {
  // The built-in pack is never stored: it must not look like downloaded data.
  if (pack.signature === BUNDLED_SIGNATURE) return "skipped";
  if (typeof indexedDB === "undefined") return "unavailable";
  try {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const value: StoredPack = { pack, savedAt: new Date().toISOString(), checksum: packChecksum(pack) };
        tx.objectStore(STORE).put(value, KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
    // Ask the browser not to clear it when storage runs low.
    void navigator.storage?.persist?.().catch(() => false);
    return "saved";
  } catch (e) {
    return isQuotaError(e) ? "quota" : "unavailable";
  }
}

/** Whether the browser promised not to clear this site's storage. */
export async function storagePersisted(): Promise<boolean | null> {
  try {
    return (await navigator.storage?.persisted?.()) ?? null;
  } catch {
    return null;
  }
}
