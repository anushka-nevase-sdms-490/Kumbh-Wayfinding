/**
 * Official Nashik Kumbh places and coordinates, taken from
 * https://kumbhguidenashik.in/map (an independent guide — confirm dates and
 * rules with the Nashik Kumbh Mela Authority). Volunteers pick these places
 * when registering a board so every team uses the same names and coordinates;
 * visitors see the how-to-get-there advice when no walked lane exists.
 */
import type { QrNode } from "./types";

export type Area = "Nashik" | "Trimbakeshwar";
export type ZoneId = "A" | "B" | "C";

export type OfficialPlace = {
  id: string;
  name: string;
  local_name: string;
  node_type: string;
  area: Area;
  /** Vehicle zone, only where the site states one. */
  zone: ZoneId | null;
  lat: number;
  lon: number;
  /** What the place is (facilities, size). */
  note: string;
  /** How to reach it when there is no walked lane — shuttle, walk, bus. */
  getThere: string;
};

export const OFFICIAL_PLACES: OfficialPlace[] = [
  {
    id: "ramkund",
    name: "Ramkund Ghat",
    local_name: "रामकुंड",
    node_type: "ghat",
    area: "Nashik",
    zone: "A",
    lat: 19.9975,
    lon: 73.791,
    note: "Central ghat on the Godavari for the Vaishnava Shahi Snan.",
    getThere:
      "Pedestrian-only inner core. Walk in — vehicles are not allowed in Zone A.",
  },
  {
    id: "kushavarta",
    name: "Kushavarta Kund, Trimbakeshwar",
    local_name: "कुशावर्त कुंड",
    node_type: "ghat",
    area: "Trimbakeshwar",
    zone: "A",
    lat: 19.932,
    lon: 73.5305,
    note: "Source pond of the Godavari, about 200 m from Trimbakeshwar Jyotirlinga.",
    getThere:
      "Vehicles stop at the outer Trimbak bypass. Walk 1.4 km from the Trimbak drop-off (15–20 min).",
  },
  {
    id: "sadhugram-tapovan",
    name: "Sadhugram Tent City, Tapovan",
    local_name: "साधुग्राम, तपोवन",
    node_type: "tent_city",
    area: "Nashik",
    zone: "B",
    lat: 19.988,
    lon: 73.812,
    note: "Large sadhu tent city at Tapovan.",
    getThere:
      "Feeder e-buses run up to the Tapovan gate only. On foot: 3.1 km from Ramkund via the Godavari riverbed path (35–45 min).",
  },
  {
    id: "vilholi-parking",
    name: "Vilholi Parking",
    local_name: "विल्होळी पार्किंग",
    node_type: "parking",
    area: "Nashik",
    zone: "C",
    lat: 19.921,
    lon: 73.725,
    note: "Parking for cars, tempo travellers and private buses from Mumbai/Thane (NH-3). Free MSRTC shuttle bay.",
    getThere:
      "12 km from the ghats. Take the free ring shuttle (about every 3 min) into Zone B.",
  },
  {
    id: "adgaon-parking",
    name: "Adgaon Parking",
    local_name: "आडगाव पार्किंग",
    node_type: "parking",
    area: "Nashik",
    zone: "C",
    lat: 20.041,
    lon: 73.852,
    note: "Park-and-ride for the Dhule/MP entry (NH-3). No private cars past this junction.",
    getThere:
      "9 km from the ghats. Take the free ring shuttle (about every 3 min) into Zone B.",
  },
  {
    id: "sinnar-phata-parking",
    name: "Sinnar Phata Parking",
    local_name: "सिन्नर फाटा पार्किंग",
    node_type: "parking",
    area: "Nashik",
    zone: "C",
    lat: 19.945,
    lon: 73.831,
    note: "Parking for the Pune/Shirdi entry (NH-50).",
    getThere:
      "11 km from the ghats. Continuous shuttle to the Tapovan buffer (Zone B).",
  },
  {
    id: "nashik-road-station",
    name: "Nashik Road Railway Station",
    local_name: "नाशिक रोड रेल्वे स्टेशन",
    node_type: "transport",
    area: "Nashik",
    zone: null,
    lat: 19.954,
    lon: 73.839,
    note: "24x7 help desks and luggage cloakrooms.",
    getThere:
      "9.8 km from Ramkund. MSRTC feeder electric bus from the Platform 1 exit, every 3 min (about 20 min ride).",
  },
  {
    id: "cbs",
    name: "CBS Bus Stand",
    local_name: "सीबीएस बस स्थानक",
    node_type: "transport",
    area: "Nashik",
    zone: "B",
    lat: 19.998,
    lon: 73.784,
    note: "Inter-city private buses are redirected to the outer parkings.",
    getThere:
      "2.2 km walk to Ramkund (25–35 min). Autos are banned on Snan days.",
  },
  {
    id: "civil-hospital",
    name: "Civil Hospital",
    local_name: "जिल्हा शासकीय रुग्णालय",
    node_type: "medical",
    area: "Nashik",
    zone: null,
    lat: 19.994,
    lon: 73.787,
    note: "24x7 trauma care, ICU, burn unit and Kumbh disaster ward.",
    getThere: "About 15 min walk from Ramkund. 24x7 ambulance corridor.",
  },
];

/** Category filters, as on kumbhguidenashik.in/map. */
export const SITE_CATEGORIES: { id: string; label: string }[] = [
  { id: "holy_ghats", label: "Holy Ghats" },
  { id: "outer_parking", label: "Outer Parking" },
  { id: "tent_cities", label: "Tent Cities" },
  { id: "trains_buses", label: "Trains & Buses" },
  { id: "hospitals", label: "Hospitals" },
  { id: "other", label: "Other mela places" },
];

export function siteCategory(nodeType: string): string {
  switch (nodeType) {
    case "ghat":
      return "holy_ghats";
    case "parking":
      return "outer_parking";
    case "tent_city":
      return "tent_cities";
    case "transport":
      return "trains_buses";
    case "medical":
      return "hospitals";
    default:
      return "other";
  }
}

export function siteCategoryLabel(nodeType: string): string {
  const id = siteCategory(nodeType);
  return SITE_CATEGORIES.find((c) => c.id === id)?.label ?? "Other mela places";
}

/** Official entry for a registered board (volunteers keep the official name). */
export function officialPlaceFor(
  node: Pick<QrNode, "name">
): OfficialPlace | null {
  const key = node.name.trim().toLowerCase();
  return OFFICIAL_PLACES.find((p) => p.name.toLowerCase() === key) ?? null;
}

/** Trimbakeshwar sits ~25 km west of Nashik city. */
export function areaOf(node: Pick<QrNode, "name" | "lon">): Area {
  return officialPlaceFor(node)?.area ?? (node.lon < 73.65 ? "Trimbakeshwar" : "Nashik");
}
