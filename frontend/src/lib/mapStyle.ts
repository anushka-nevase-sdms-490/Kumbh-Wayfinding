/**
 * MapLibre style for the offline basemap. Everything (tiles, fonts, sprites)
 * is served from /map/ on the app's own origin — see scripts/fetchOfflineMap.ts.
 */
import { layers, namedFlavor } from "@protomaps/basemaps";
import type { StyleSpecification } from "maplibre-gl";
import { BASEMAP_MAX_ZOOM, KUMBH_BOUNDS } from "./mapArea";

/** Map labels in this language (OSM name:mr / name:hi, falling back to name). */
export type MapLang = "en" | "hi" | "mr";

export function offlineMapStyle(
  lang: MapLang = "en",
  origin = window.location.origin
): StyleSpecification {
  return {
    version: 8,
    glyphs: `${origin}/map/fonts/{fontstack}/{range}.pbf`,
    sprite: `${origin}/map/sprites/light`,
    sources: {
      protomaps: {
        type: "vector",
        tiles: [`${origin}/map/tiles/{z}/{x}/{y}.mvt`],
        minzoom: 0,
        maxzoom: BASEMAP_MAX_ZOOM,
        bounds: KUMBH_BOUNDS,
        attribution: "© OpenStreetMap contributors · Protomaps",
      },
    },
    layers: layers("protomaps", namedFlavor("light"), { lang }),
  };
}
