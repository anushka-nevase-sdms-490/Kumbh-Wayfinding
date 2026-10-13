export type QrNode = {
  id: number;
  code: string;
  name: string;
  local_name?: string | null;
  lat: number;
  lon: number;
  node_type: string;
  icon?: string;
  description?: string | null;
};

export type GraphEdge = {
  id: number;
  from_code: string;
  to_code: string;
  distance_m: number;
  surface: string;
  bidirectional?: boolean;
  walkable?: boolean;
  /** Compass° leaving from_code → to_code along the real walk (not GPS line). */
  heading_ab?: number | null;
  /** Compass° leaving to_code → from_code along the real walk. */
  heading_ba?: number | null;
  /** corridor | door | glass_door | glass_wall | wall | passage */
  passage_kind?: string;
  /** none | open | closed | unknown */
  door_state?: string;
  blocked?: boolean;
  obstacle_note?: string | null;
  clearance_m?: number | null;
  cost_mult?: number;
  /** Volunteer walked this corridor once. */
  verified?: boolean;
  verified_at?: string | null;
  /** JSON string of path waypoints, or parsed list from pack. */
  path_json?: string | null;
};

export type OfflinePack = {
  version: string;
  signature: string;
  nodes: QrNode[];
  edges: GraphEdge[];
};

/** Special QR payload / path segment — opens volunteer registration (not a place node). */
export const VOLUNTEER_REGISTER_CODE = "VOLUNTEER_REGISTER";

/** Every Kumbh place board. The volunteer-registration QR is not a place. */
export function isRegisteredLocation(node: Pick<QrNode, "code">): boolean {
  const code = node.code.trim().toUpperCase();
  return code.length > 0 && code !== VOLUNTEER_REGISTER_CODE;
}

/** App origin for phone-scannable QR links (same host the page is on). */
export function appOrigin(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

/** Deep link that opens Volunteer registration on the phone browser. */
export function volunteerRegisterLink(origin = appOrigin()): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/?mode=volunteer&register=1`;
}

/** Deep link for a printed location board (User start). */
export function locationBoardLink(code: string, origin = appOrigin()): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/?board=${encodeURIComponent(code.toUpperCase())}`;
}

export function isVolunteerRegisterPayload(raw: string): boolean {
  const n = normalizeCode(raw);
  if (n === VOLUNTEER_REGISTER_CODE) return true;
  if (n.includes("MODE=VOLUNTEER") || n.includes("REGISTER=1")) return true;
  try {
    if (raw.includes("://")) {
      const u = new URL(raw.trim());
      if (u.searchParams.get("mode") === "volunteer") return true;
      if (u.searchParams.get("register") === "1") return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export const TYPE_META: Record<
  string,
  { label: string; emoji: string; hint: string }
> = {
  ghat: { label: "Ghat", emoji: "◇", hint: "Bathing ghat" },
  akhara: { label: "Akhara", emoji: "◎", hint: "Akhara camp" },
  medical: { label: "Medical", emoji: "+", hint: "Medical camp" },
  toilet: { label: "Toilet", emoji: "□", hint: "Mela toilet block" },
  parking: { label: "Parking", emoji: "P", hint: "Mela parking" },
  lost_found: { label: "Lost & Found", emoji: "?", hint: "Lost visitors" },
  transport: { label: "Transport", emoji: "▷", hint: "Bus or rail hub" },
  help: { label: "Help", emoji: "!", hint: "Help desk" },
  junction: { label: "Lane turn", emoji: "·", hint: "Corner on the walk" },
  landmark: { label: "Landmark", emoji: "◎", hint: "Mela landmark" },
};

export function normalizeCode(raw: string): string {
  let s = raw.trim();
  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      if (
        u.searchParams.get("mode") === "volunteer" ||
        u.searchParams.get("register") === "1"
      ) {
        return VOLUNTEER_REGISTER_CODE;
      }
      const board = u.searchParams.get("board") || u.searchParams.get("start");
      if (board) return board.trim().toUpperCase();
    }
  } catch {
    /* fall through */
  }
  s = s.toUpperCase();
  if (s.includes("BOARD=")) {
    const part = s.split("BOARD=")[1] ?? s;
    s = part.split("&")[0] ?? part;
  }
  if (s.includes("/")) s = s.split("/").pop() ?? s;
  if (s.includes("=")) s = s.split("=").pop() ?? s;
  return s.trim().toUpperCase();
}

export function haversineM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLon = toR(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function bearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toR = (d: number) => (d * Math.PI) / 180;
  const toD = (r: number) => (r * 180) / Math.PI;
  const phi1 = toR(lat1);
  const phi2 = toR(lat2);
  const dLon = toR(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return (toD(Math.atan2(y, x)) + 360) % 360;
}
