/**
 * SOS alerts on the phone (Phase 6). An alert is saved on the phone first and
 * shown with a truthful state:
 *
 *   pending      saved on this phone, not received by the Setu server yet
 *   sent         the server stored it (answered 201/200 with an alert id)
 *   acknowledged an operator confirmed it (the server says so)
 *   resolved     an operator marked it resolved
 *   expired      open 48 h without anyone resolving it (the server closed it)
 *   refused      the server rejected it (the reason is shown)
 *
 * Nothing is ever shown as sent or acknowledged without that answer from the
 * server. Resending is safe: the random client id makes the server return the
 * same alert (backend routers/sos.py). Setu alerts reach Setu operators, not
 * the police or an ambulance.
 */
import { newKey } from "./outbox";

export type SosKind = "medical" | "lost" | "unsafe" | "other";
export type SosState = "pending" | "sent" | "acknowledged" | "resolved" | "expired" | "refused";

export type SosItem = {
  clientId: string;
  kind: SosKind;
  note: string | null;
  lat: number | null;
  lon: number | null;
  accuracyM: number | null;
  placeCode: string | null;
  lang: string;
  device: string | null;
  createdAt: string;
  state: SosState;
  serverId?: number;
  receivedAt?: string | null;
  ackAt?: string | null;
  ackMessage?: string | null;
  error?: string | null;
  attempts: number;
};

export interface SosStore {
  list(): Promise<SosItem[]>;
  put(item: SosItem): Promise<void>;
  remove(clientId: string): Promise<void>;
}

export interface SosTransport {
  post(body: unknown): Promise<Response>;
  get(clientId: string): Promise<Response>;
}

export const SOS_EVENT = "setu-sos-changed";

/**
 * The operator's quick replies. They are stored as this English text (older
 * phones show it as it is); a phone shows a known one in the visitor's language.
 */
export const SOS_PRESETS = {
  coming: "A volunteer is coming to you",
  helpDesk: "Go to the nearest help desk",
  stay: "Stay where you are — help is coming",
} as const;
export type SosPreset = keyof typeof SOS_PRESETS;

export function presetOf(message: string | null | undefined): SosPreset | null {
  const hit = (Object.keys(SOS_PRESETS) as SosPreset[]).find((k) => SOS_PRESETS[k] === message?.trim());
  return hit ?? null;
}
const DB_NAME = "setu-sos";
const STORE = "alerts";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "clientId" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest | null): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      t.oncomplete = () => resolve((req?.result ?? undefined) as T);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export const idbSos: SosStore = {
  async list() {
    if (typeof indexedDB === "undefined") return [];
    const all = (await tx<SosItem[]>("readonly", (s) => s.getAll())) ?? [];
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async put(item) {
    await tx("readwrite", (s) => s.put(item));
  },
  async remove(clientId) {
    await tx("readwrite", (s) => s.delete(clientId));
  },
};

export function httpTransport(apiBase: string): SosTransport {
  return {
    post: (body) =>
      fetch(`${apiBase}/api/sos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    get: (clientId) => fetch(`${apiBase}/api/sos/${encodeURIComponent(clientId)}`),
  };
}

function changed() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SOS_EVENT));
}

type ServerAlert = {
  id?: number;
  status?: string;
  received_at?: string | null;
  ack_at?: string | null;
  ack_message?: string | null;
  detail?: unknown;
};

/** A real Setu answer about an alert (a Wi-Fi login page or a proxy's 200 is not). */
function isServerAlert(data: unknown): data is ServerAlert {
  const d = data as ServerAlert | null;
  return !!d && typeof d === "object" && typeof d.id === "number" && typeof d.status === "string";
}

/** A refusal from the Setu server itself (FastAPI always sends `detail`), not from something in between. */
function isServerRefusal(data: unknown): boolean {
  return !!data && typeof data === "object" && "detail" in data;
}

/** Only the server's own answer moves an alert past "pending". */
function fromServer(item: SosItem, data: ServerAlert): SosItem {
  const state: SosState =
    data.status === "acknowledged"
      ? "acknowledged"
      : data.status === "resolved"
        ? "resolved"
        : data.status === "expired"
          ? "expired"
          : "sent";
  return {
    ...item,
    state,
    serverId: data.id ?? item.serverId,
    receivedAt: data.received_at ?? item.receivedAt ?? null,
    ackAt: data.ack_at ?? null,
    ackMessage: data.ack_message ?? null,
    error: null,
  };
}

/** Try once to deliver a pending alert. No connection or a busy server: it stays pending. */
export async function trySend(item: SosItem, store: SosStore, transport: SosTransport): Promise<SosItem> {
  let next: SosItem = { ...item, attempts: item.attempts + 1 };
  try {
    const res = await transport.post({
      client_id: item.clientId,
      kind: item.kind,
      note: item.note,
      lat: item.lat,
      lon: item.lon,
      accuracy_m: item.accuracyM,
      place_code: item.placeCode,
      lang: item.lang,
      device: item.device,
      // When "Send" was pressed: an alert sent later from the queue is not new.
      created_at: item.createdAt,
    });
    const raw: unknown = await res.json().catch(() => null);
    const data = (raw ?? {}) as ServerAlert;
    const detail = typeof data.detail === "string" ? data.detail : null;
    if ((res.status === 200 || res.status === 201) && isServerAlert(raw)) {
      next = fromServer(next, raw);
    } else if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429 && isServerRefusal(raw)) {
      next = { ...next, state: "refused", error: detail ?? `Error ${res.status}` };
    } else {
      // Not received (server down, busy, or an answer that is not Setu's,
      // e.g. a Wi-Fi login page): keep it pending and try again later.
      next = { ...next, error: res.status === 429 ? detail : null };
    }
  } catch {
    /* no connection: stays pending */
  }
  try {
    await store.put(next);
  } catch {
    /* phone storage unavailable: the result is still returned to the screen */
  }
  changed();
  return next;
}

/** Ask the server for an alert's state (acknowledged? resolved?). Offline: nothing changes. */
export async function refreshSos(item: SosItem, store: SosStore, transport: SosTransport): Promise<SosItem> {
  try {
    const res = await transport.get(item.clientId);
    if (res.status !== 200) return item;
    const data: unknown = await res.json();
    if (!isServerAlert(data)) return item;
    const next = fromServer(item, data);
    if (next.state !== item.state || next.ackMessage !== item.ackMessage) {
      await store.put(next);
      changed();
    }
    return next;
  } catch {
    return item;
  }
}

export type NewSos = Pick<SosItem, "kind" | "note" | "lat" | "lon" | "accuracyM" | "placeCode" | "lang" | "device">;

/** Save the alert on the phone (pending), then try to send it straight away. */
export async function createSos(
  fields: NewSos,
  store: SosStore,
  transport: SosTransport
): Promise<SosItem & { savedOnPhone: boolean }> {
  const item: SosItem = {
    ...fields,
    note: fields.note?.trim() || null,
    clientId: newKey(),
    createdAt: new Date().toISOString(),
    state: "pending",
    attempts: 0,
  };
  // If the phone cannot save it (private mode, storage full), send it anyway:
  // the screen then says it cannot be followed up or retried from here.
  let savedOnPhone = true;
  try {
    await store.put(item);
  } catch {
    savedOnPhone = false;
  }
  changed();
  sendingNow.add(item.clientId);
  try {
    return { ...(await trySend(item, store, transport)), savedOnPhone };
  } finally {
    sendingNow.delete(item.clientId);
  }
}

// Longer than the server's 48 h expiry (services/retention.py), so the phone
// learns that an alert was resolved or expired.
const WATCH_FOR_MS = 72 * 3600 * 1000;
let flushing: Promise<void> | null = null;
/** Alerts createSos is sending right now: a flush must not send them a second time. */
const sendingNow = new Set<string>();

/** Send pending alerts and refresh recent ones (single flight). */
export function flushSos(store: SosStore, transport: SosTransport, now: Date = new Date()): Promise<void> {
  flushing ??= (async () => {
    for (const item of await store.list()) {
      if (sendingNow.has(item.clientId)) continue;
      if (item.state === "pending") await trySend(item, store, transport);
      else if ((item.state === "sent" || item.state === "acknowledged") && now.getTime() - Date.parse(item.createdAt) < WATCH_FOR_MS)
        await refreshSos(item, store, transport);
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
