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
  /** Accuracy (m) of the volunteer's GPS fix when the place was saved. */
  gps_accuracy_m?: number | null;
  /** Trust level (backend app/verification.py). */
  verification?: Verification;
  /** Day a person last checked it (YYYY-MM-DD). */
  verified_at?: string | null;
  source?: string | null;
  /** open | limited | closed — only claimed until op_status_until (lib/placeInfo.ts). */
  op_status?: string | null;
  op_status_until?: string | null;
  op_status_note?: string | null;
  op_status_at?: string | null;
  step_free?: boolean | null;
  access?: string | null;
  access_note?: string | null;
  /** Code printed on a Setu QR board at this place. */
  board_code?: string | null;
};

/** How far data can be trusted; nothing is promoted automatically. */
export type Verification =
  | "osm_imported"
  | "unverified"
  | "remotely_reviewed"
  | "volunteer_verified"
  | "officially_verified"
  | "rejected";

const FIELD_VERIFIED = new Set<string>(["volunteer_verified", "officially_verified"]);

/** Checked on the ground (volunteer walk or official source): drawn solid, preferred. */
export function isFieldVerified(e: Pick<GraphEdge, "verification" | "verified" | "source">): boolean {
  if (e.verification) return FIELD_VERIFIED.has(e.verification);
  // Packs from before trust levels: a walked volunteer lane.
  return !!e.verified && e.source !== "osm";
}

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
  /** volunteer (walked) | osm (map road nobody has walked yet). */
  source?: string;
  /** Street name (map lanes). */
  name?: string | null;
  /** Trust level (backend app/verification.py). */
  verification?: Verification;
};

export type OfflinePack = {
  version: string;
  signature: string;
  /** When the server built this pack (ISO time). */
  generated_at?: string;
  /** OpenStreetMap snapshot files the data was built from (dataset version). */
  sources?: Record<string, string>;
  attribution?: string;
  nodes: QrNode[];
  edges: GraphEdge[];
};

/** A pack worth routing on: has places, and every place has a code and a position. */
export function isUsablePack(x: unknown): x is OfflinePack {
  const p = x as Partial<OfflinePack> | null;
  return (
    !!p &&
    typeof p.signature === "string" &&
    Array.isArray(p.edges) &&
    Array.isArray(p.nodes) &&
    p.nodes.length > 0 &&
    p.nodes.every(
      (n) =>
        typeof n?.code === "string" &&
        n.code.length > 0 &&
        Number.isFinite(n.lat) &&
        Number.isFinite(n.lon)
    )
  );
}

/** A place imported from OpenStreetMap (not a hidden junction). */
export function isOsmPlaceCode(code: string): boolean {
  return /^OSM-[NWR]\d+$/.test(code);
}

/** How near a volunteer must stand to confirm a map place (area centres can be off). */
export function osmConfirmRadiusM(code: string): number {
  return code.startsWith("OSM-N") ? 30 : 60;
}

/** Hidden routing point on a map road (backend osm_network.py) — never listed. */
export function isNetworkJunctionCode(code: string): boolean {
  // OSM-J<node id> / OSM-A<place id>; official places are OSM-<NAME> (fallback pack).
  return /^OSM-[JA]\d+$/.test(code);
}

/** A place a visitor can see and pick (not a hidden map junction). */
export function isRegisteredLocation(node: Pick<QrNode, "code">): boolean {
  const code = node.code.trim();
  return code.length > 0 && !isNetworkJunctionCode(code);
}

export const TYPE_META: Record<
  string,
  { label: string; emoji: string; hint: string }
> = {
  ghat: { label: "Ghat", emoji: "◇", hint: "Bathing ghat" },
  akhara: { label: "Akhara", emoji: "◎", hint: "Akhara camp" },
  tent_city: { label: "Tent city", emoji: "△", hint: "Sadhugram tent city" },
  medical: { label: "Medical", emoji: "+", hint: "Medical camp" },
  temple: { label: "Temple / shrine", emoji: "△", hint: "Temple, dargah or other shrine" },
  toilet: { label: "Toilet", emoji: "□", hint: "Mela toilet block" },
  water: { label: "Drinking water", emoji: "○", hint: "Drinking water point" },
  parking: { label: "Parking", emoji: "P", hint: "Mela parking" },
  lost_found: { label: "Lost & Found", emoji: "?", hint: "Lost visitors" },
  transport: { label: "Transport", emoji: "▷", hint: "Bus or rail hub" },
  help: { label: "Help", emoji: "!", hint: "Help desk" },
  junction: { label: "Lane turn", emoji: "·", hint: "Corner on the walk" },
  landmark: { label: "Landmark", emoji: "◎", hint: "Mela landmark" },
};

/** Colour family for a place icon tile — see .tone-* in index.css. */
export function placeTone(type: string): string {
  switch (type) {
    case "ghat":
    case "water":
      return "tone-water";
    case "medical":
      return "tone-medical";
    case "parking":
    case "transport":
      return "tone-transit";
    case "tent_city":
    case "akhara":
    case "temple":
      return "tone-camp";
    default:
      return "tone-neutral";
  }
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
