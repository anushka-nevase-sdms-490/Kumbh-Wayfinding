/**
 * Volunteer changes made without internet wait here (IndexedDB) and are sent
 * in order when the phone is back online.
 *
 * Every change carries an Idempotency-Key made on the phone, so sending it
 * again after a dropped connection never saves it twice (backend
 * app/idempotency.py). A change the server refuses (bad GPS, unknown place)
 * stays listed with the reason until the volunteer dismisses it — it is
 * never resent forever, and never silently lost.
 */
import { authFetch, loadAuth } from "./auth";
import type { MessageKey, Vars } from "../i18n/messages";

export type OutboxItem = {
  /** Also the Idempotency-Key. */
  id: string;
  path: string;
  body: Record<string, unknown>;
  /** What the volunteer did, for the list ("Register Ramkund Ghat"). */
  label: string;
  /** The same in the volunteer's language, when the list is shown. */
  labelKey?: MessageKey;
  labelVars?: Vars;
  createdAt: string;
  /** Only this volunteer's sign-in may send it. */
  volunteerId: number;
  status: "waiting" | "refused";
  attempts: number;
  error?: string;
  /** Errors made on the phone (not the server's words), shown translated. */
  errorKey?: MessageKey;
  errorVars?: Vars;
  /** "Not sent: “<parent>” was refused" — the parent's label, translatable. */
  parentLabel?: { key: MessageKey; vars?: Vars };
  /** Wait for that change, then copy its answer's node.code into these body fields. */
  dependsOn?: { id: string; fields: string[] };
};

/** Storage for the queue (IndexedDB on the phone; a Map in tests). */
export interface OutboxStore {
  list(): Promise<OutboxItem[]>;
  put(item: OutboxItem): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Fired on window whenever the queue changes. */
export const OUTBOX_EVENT = "setu-outbox-changed";

const DB_NAME = "setu-outbox";
const STORE = "items";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest | null): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve((req?.result ?? undefined) as T);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const idbOutbox: OutboxStore = {
  async list() {
    if (typeof indexedDB === "undefined") return [];
    const all = await withStore<OutboxItem[]>("readonly", (s) => s.getAll());
    return (all ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },
  async put(item) {
    await withStore("readwrite", (s) => s.put(item));
  },
  async remove(id) {
    await withStore("readwrite", (s) => s.delete(id));
  },
};

function changed() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OUTBOX_EVENT));
}

/** A random id (crypto.randomUUID needs HTTPS; fall back to random bytes). */
export function newKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export type Sender = (path: string, body: unknown, key: string) => Promise<Response>;

export function authSender(apiBase: string): Sender {
  return (path, body, key) =>
    authFetch(`${apiBase}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(body),
    });
}

/**
 * Try again later: server down, still in progress, or signed out. A 409 is
 * temporary only with Retry-After (the server's "still being saved" answer);
 * any other 409 is a real refusal (e.g. walking a one-way lane backwards) and
 * must not hold up the rest of the queue.
 */
function retryLater(res: Response): boolean {
  const s = res.status;
  if (s === 409) return !!res.headers?.get?.("Retry-After");
  return s >= 500 || s === 401 || s === 408 || s === 429;
}

function detailOf(data: unknown, status: number): string {
  const d = (data as { detail?: unknown; message?: unknown } | null) ?? null;
  if (typeof d?.detail === "string") return d.detail;
  if (typeof d?.message === "string") return d.message;
  return `Refused by the server (error ${status})`;
}

/**
 * Every Setu answer is a JSON object. Anything else (a Wi-Fi login page, a
 * proxy's error page) did not come from the server: keep the change.
 */
function fromSetu(data: unknown): boolean {
  return !!data && typeof data === "object";
}

/** A 200 that still means "not saved" (register: the place already exists). */
function notSaved(data: unknown): boolean {
  return (data as { success?: unknown } | null)?.success === false;
}

export type SendResult =
  | { kind: "sent"; data: unknown }
  | { kind: "refused"; message: string; data: unknown }
  | { kind: "queued"; item: OutboxItem };

export type QueueOptions = {
  label: string;
  labelKey?: MessageKey;
  labelVars?: Vars;
  /** Do not try now (e.g. it depends on a change that is itself queued). */
  queueOnly?: boolean;
  dependsOn?: OutboxItem["dependsOn"];
};

/**
 * Send a volunteer change now, or keep it for later when there is no
 * connection. A refusal (4xx) is returned at once so the volunteer can fix it.
 */
export async function sendOrQueue(
  path: string,
  body: Record<string, unknown>,
  opts: QueueOptions,
  send: Sender,
  store: OutboxStore = idbOutbox,
  volunteerId: number | null = loadAuth()?.volunteer.id ?? null
): Promise<SendResult> {
  const id = newKey();
  if (!opts.queueOnly) {
    try {
      const res = await send(path, body, id);
      if (!retryLater(res)) {
        const data = await res.json().catch(() => null);
        if (fromSetu(data)) {
          if (!res.ok || notSaved(data)) return { kind: "refused", message: detailOf(data, res.status), data };
          return { kind: "sent", data };
        }
      }
    } catch {
      /* no connection: keep it */
    }
  }
  if (volunteerId == null) return { kind: "refused", message: "Sign in as a volunteer first", data: null };
  const item: OutboxItem = {
    id,
    path,
    body,
    label: opts.label,
    labelKey: opts.labelKey,
    labelVars: opts.labelVars,
    createdAt: new Date().toISOString(),
    volunteerId,
    status: "waiting",
    attempts: opts.queueOnly ? 0 : 1,
    dependsOn: opts.dependsOn,
  };
  await store.put(item);
  changed();
  return { kind: "queued", item };
}

export type FlushResult = { sent: number; refused: number; waiting: number };

let flushing: Promise<FlushResult> | null = null;

/** Send waiting changes in order; stops at the first one that cannot be sent yet. */
export function flushOutbox(
  send: Sender,
  store: OutboxStore = idbOutbox,
  volunteerId: number | null = loadAuth()?.volunteer.id ?? null
): Promise<FlushResult> {
  // One flush at a time: two would send the same change in parallel.
  flushing ??= runFlush(send, store, volunteerId).finally(() => {
    flushing = null;
  });
  return flushing;
}

async function runFlush(send: Sender, store: OutboxStore, volunteerId: number | null): Promise<FlushResult> {
  const out: FlushResult = { sent: 0, refused: 0, waiting: 0 };
  let items = await store.list();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.status !== "waiting") continue;
    // Another volunteer's change waits for their own sign-in; a dependant
    // waits for its parent (which comes earlier in the list).
    if (volunteerId == null || item.volunteerId !== volunteerId || item.dependsOn) continue;
    let res: Response;
    try {
      res = await send(item.path, item.body, item.id);
    } catch {
      await keepWaiting(store, item);
      break; // offline: the rest waits too, in order
    }
    if (retryLater(res)) {
      await keepWaiting(store, item);
      break;
    }
    const data = await res.json().catch(() => null);
    if (!fromSetu(data)) {
      await keepWaiting(store, item);
      break;
    }
    const ok = res.ok && !notSaved(data);
    // Changes that were waiting for this one: fill in its result, or refuse them too.
    const code = (data as { node?: { code?: unknown } } | null)?.node?.code;
    for (const dep of items.filter((x) => x.dependsOn?.id === item.id)) {
      const next: OutboxItem =
        ok && typeof code === "string"
          ? {
              ...dep,
              body: { ...dep.body, ...Object.fromEntries(dep.dependsOn!.fields.map((f) => [f, code])) },
              dependsOn: undefined,
            }
          : {
              ...dep,
              status: "refused",
              dependsOn: undefined,
              error: `Not sent: “${item.label}” was refused`,
              errorKey: "vol.outbox.parentRefused",
              errorVars: { label: item.label },
              parentLabel: item.labelKey ? { key: item.labelKey, vars: item.labelVars } : undefined,
            };
      await store.put(next);
    }
    if (ok) {
      await store.remove(item.id);
      out.sent += 1;
    } else {
      await store.put({ ...item, status: "refused", attempts: item.attempts + 1, error: detailOf(data, res.status) });
      out.refused += 1;
    }
    items = await store.list(); // dependants changed
    i = -1; // start again from the top; finished items are gone or refused
  }
  out.waiting = (await store.list()).filter((x) => x.status === "waiting").length;
  changed();
  return out;
}

/** Count the attempt, unless the volunteer removed the change while it was being sent. */
async function keepWaiting(store: OutboxStore, item: OutboxItem): Promise<void> {
  if ((await store.list()).some((x) => x.id === item.id)) await store.put({ ...item, attempts: item.attempts + 1 });
}

/** The volunteer read a refusal (or gave up on a waiting change). */
export async function dismissOutboxItem(id: string, store: OutboxStore = idbOutbox): Promise<void> {
  const items = await store.list();
  await store.remove(id);
  // Changes that were waiting for it can never be sent now.
  for (const dep of items.filter((x) => x.dependsOn?.id === id)) {
    await store.put({
      ...dep,
      status: "refused",
      dependsOn: undefined,
      error: "Not sent: the change it belonged to was removed",
      errorKey: "vol.outbox.parentRemoved",
    });
  }
  changed();
}
