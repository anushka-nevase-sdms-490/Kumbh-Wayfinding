/**
 * The pack built into the app, used until a real one is downloaded (first
 * visit with no network). Only official places whose position was matched to
 * OpenStreetMap — never the guide's approximate points — and no lanes:
 * straight lines would draw routes across the river and through buildings.
 * The "No walked lane yet" screen then gives each place's how-to-get-there text.
 */
import { OFFICIAL_PLACES, type OfficialPlace } from "./officialPlaces";
import type { OfflinePack } from "./types";

/** Not a sha256, so any pack from the server replaces it. */
export const BUNDLED_SIGNATURE = "bundled";

export function buildFallbackPack(places: OfficialPlace[] = OFFICIAL_PLACES): OfflinePack {
  const osm = places.filter((p) => p.coordQuality === "osm");
  return {
    version: "bundled-osm-20261029",
    signature: BUNDLED_SIGNATURE,
    nodes: osm.map((p, i) => ({
      // Negative ids never clash with database ids.
      id: -(i + 1),
      code: `OSM-${p.id.toUpperCase()}`,
      // Exact official name: officialPlaceFor() matches on it.
      name: p.name,
      local_name: p.local_name,
      lat: p.lat,
      lon: p.lon,
      node_type: p.node_type,
      description: "Map position from OpenStreetMap — not yet confirmed on site.",
      gps_accuracy_m: null,
    })),
    edges: [],
  };
}

export const FALLBACK_PACK: OfflinePack = buildFallbackPack();
