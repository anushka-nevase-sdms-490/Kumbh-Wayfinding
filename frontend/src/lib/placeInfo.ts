/**
 * What the app may truthfully say about a place: its operational status (only
 * while the status is still valid), how it was checked, and finding it by
 * name or by the code on a Setu QR board. Pure functions — no React — so the
 * tests can check them.
 */
import { isRegisteredLocation, type QrNode } from "./types";

export type OpStatus =
  | { kind: "open" | "limited" | "closed"; until: Date; note: string | null }
  /** A status was set but its time ran out: nothing is claimed any more. */
  | { kind: "expired" }
  | { kind: "unknown" };

/** The server sends UTC without a zone (or a full ISO time). */
function utc(iso: string): Date {
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);
}

export function opStatus(node: QrNode, now: Date = new Date()): OpStatus {
  const s = node.op_status;
  if (s !== "open" && s !== "limited" && s !== "closed") return { kind: "unknown" };
  if (!node.op_status_until) return { kind: "unknown" };
  const until = utc(node.op_status_until);
  if (!(until.getTime() > now.getTime())) return { kind: "expired" };
  return { kind: s, until, note: node.op_status_note ?? null };
}

export type Trust =
  | { kind: "field" | "official"; date: string | null }
  | { kind: "reviewed" }
  | { kind: "map" };

/** How far a place can be trusted, for showing to visitors (never more than recorded). */
export function trustOf(node: QrNode): Trust {
  switch (node.verification) {
    case "officially_verified":
      return { kind: "official", date: node.verified_at ?? null };
    case "volunteer_verified":
      return { kind: "field", date: node.verified_at ?? null };
    case "remotely_reviewed":
      return { kind: "reviewed" };
    default:
      return { kind: "map" };
  }
}

/** Lower-case, no extra spaces, no accents (Devanagari is kept as it is). */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Places whose English name, local name or category label contains every word
 * of the query. Order: name starts with the query first, then the rest as given.
 */
export function searchPlaces(nodes: QrNode[], query: string, categoryLabel: (n: QrNode) => string): QrNode[] {
  const q = normalizeText(query);
  if (!q) return nodes;
  const words = q.split(" ");
  const hits = nodes.filter((n) => {
    const hay = normalizeText(`${n.name} ${n.local_name ?? ""} ${categoryLabel(n)}`);
    return words.every((w) => hay.includes(w));
  });
  const starts = (n: QrNode) =>
    normalizeText(n.name).startsWith(q) || normalizeText(n.local_name ?? "").startsWith(q);
  return [...hits.filter(starts), ...hits.filter((n) => !starts(n))];
}

// Board codes: 5 characters, no look-alikes (backend routers/admin.py BOARD_ALPHABET).
const BOARD_RE = /^[2-9A-HJKMNP-Z]{5}$/;

/** "k7 m4-q" → "K7M4Q"; null when it cannot be a board code. */
export function normalizeBoardCode(raw: string): string | null {
  const c = raw.toUpperCase().replace(/[\s\-–.]/g, "");
  return BOARD_RE.test(c) ? c : null;
}

export type BoardLookup =
  | { kind: "found"; node: QrNode; boardCode: string | null }
  /** Not a board code (or a place code) at all. */
  | { kind: "invalid" }
  /** A valid code, but not in the data on this phone (new board, old data, or retired). */
  | { kind: "unknown"; code: string };

/**
 * Find the place for a scanned link (?at=…) or a typed code, in the data
 * saved on the phone — no network needed. Accepts a board code, or a place
 * code (OSM-N…, KUMBH-…) for links made by the app itself.
 */
export function resolveBoard(nodes: QrNode[], raw: string): BoardLookup {
  const trimmed = raw.trim();
  const places = nodes.filter(isRegisteredLocation);
  const board = normalizeBoardCode(trimmed);
  if (board) {
    const node = places.find((n) => (n.board_code ?? "").toUpperCase() === board);
    return node ? { kind: "found", node, boardCode: board } : { kind: "unknown", code: board };
  }
  if (/^[A-Z0-9][A-Z0-9-]{1,31}$/i.test(trimmed) && trimmed.includes("-")) {
    const code = trimmed.toUpperCase();
    const node = places.find((n) => n.code.toUpperCase() === code);
    return node ? { kind: "found", node, boardCode: node.board_code ?? null } : { kind: "unknown", code };
  }
  return { kind: "invalid" };
}
