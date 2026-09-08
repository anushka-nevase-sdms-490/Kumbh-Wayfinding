export type QrNode = {
  id: number;
  code: string;
  name: string;
  lat: number;
  lon: number;
  node_type: string;
  icon?: string;
};

export type GraphEdge = {
  id: number;
  from_code: string;
  to_code: string;
  distance_m: number;
  surface: string;
  bidirectional?: boolean;
};

export type OfflinePack = {
  version: string;
  signature: string;
  nodes: QrNode[];
  edges: GraphEdge[];
};

export const TYPE_META: Record<
  string,
  { label: string; emoji: string; hint: string }
> = {
  ghat: { label: "Ghat", emoji: "◇", hint: "Bathing & rituals" },
  medical: { label: "Medical", emoji: "+", hint: "First aid camp" },
  toilet: { label: "Toilet", emoji: "□", hint: "Sanitation block" },
  parking: { label: "Parking", emoji: "P", hint: "Vehicle zone" },
  lost_found: { label: "Lost & Found", emoji: "?", hint: "Reunite here" },
  transport: { label: "Transport", emoji: "▷", hint: "Bus / rail link" },
  help: { label: "Help desk", emoji: "!", hint: "Ask staff" },
  junction: { label: "Junction", emoji: "·", hint: "Path crossing" },
};

export function normalizeCode(raw: string): string {
  let s = raw.trim().toUpperCase();
  if (s.includes("/")) s = s.split("/").pop() ?? s;
  if (s.includes("=")) s = s.split("=").pop() ?? s;
  return s;
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
