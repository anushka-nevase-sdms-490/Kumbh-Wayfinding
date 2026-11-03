import { useEffect, useRef, useState } from "react";
import {
  Map as MlMap,
  NavigationControl,
  type GeoJSONSource,
  setWorkerUrl,
  type MapLayerMouseEvent,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import { offlineMapStyle } from "../lib/mapStyle";
import { useI18n } from "../i18n/context";
import { KUMBH_BOUNDS, RAMKUND_CENTER } from "../lib/mapArea";
import { boundsOf, circlePolygon, type LonLat } from "../lib/mapData";
import type { QrNode } from "../lib/types";
import "./OfflineMap.css";

export type MapFix = { lat: number; lon: number; accuracyM: number };

type Props = {
  places: QrNode[];
  /** Route line [lon, lat][] — empty when there is no route. */
  route?: LonLat[];
  /** Parts of the route on map roads nobody has walked — drawn dashed. */
  mapRoads?: LonLat[][];
  startCode?: string | null;
  destCode?: string | null;
  you?: MapFix | null;
  /** Keep the camera on the visitor while they walk (until they pan). */
  followYou?: boolean;
  onPlaceTap?: (code: string) => void;
  className?: string;
  /** Admin map: every lane as lines with `id` and `kind` (walked | reviewed | map | off). */
  lanes?: GeoJSON.FeatureCollection;
  onLaneTap?: (id: number) => void;
  /** Admin map: pending visitor reports. */
  reportPins?: { id: number; lat: number; lon: number }[];
  onReportTap?: (id: number) => void;
  /** Admin map: places nobody has confirmed on site drawn hollow. */
  markUnconfirmed?: boolean;
  /** Tap anywhere (simulation "place me here"); while set, place taps are not used. */
  onMapTap?: (lat: number, lon: number) => void;
  /** Move the camera here (admin: show a data warning); a new key moves it again. */
  focus?: { lat: number; lon: number; key: string } | null;
};

// Vite moves MapLibre's files, so point it at its worker explicitly.
setWorkerUrl(workerUrl);

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const NO_ROUTE: LonLat[] = [];
const NO_PARTS: LonLat[][] = [];
const NO_PINS: { id: number; lat: number; lon: number }[] = [];

// Some slack around the tile area so edge places are not pinned to the border.
const MAX_BOUNDS: [LonLat, LonLat] = [
  [KUMBH_BOUNDS[0] - 0.05, KUMBH_BOUNDS[1] - 0.05],
  [KUMBH_BOUNDS[2] + 0.05, KUMBH_BOUNDS[3] + 0.05],
];

/** The visitor is somewhere the offline map covers (not planning from home). */
function inMapArea(you: MapFix): boolean {
  const [w, s, e, n] = KUMBH_BOUNDS;
  return you.lon >= w && you.lon <= e && you.lat >= s && you.lat <= n;
}

/**
 * The name drawn on the map: the English name, without Devanagari. MapLibre
 * cannot shape Devanagari (vowel signs land in the wrong place), so Hindi and
 * Marathi names are shown in the lists and cards (which the browser shapes),
 * not as map labels.
 */
function mapLabel(n: QrNode): string {
  return n.name.replace(/[\u0900-\u097F\u200c\u200d]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function placesGeoJson(
  places: QrNode[],
  label: (n: QrNode) => string,
  startCode?: string | null,
  destCode?: string | null,
  markUnconfirmed = false
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: places.map((n) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [n.lon, n.lat] },
      properties: {
        code: n.code,
        name: label(n),
        role:
          n.code === destCode ? "dest" : n.code === startCode ? "start" : "place",
        hollow: markUnconfirmed && n.gps_accuracy_m == null,
      },
    })),
  };
}

function youGeoJson(you: MapFix | null | undefined): GeoJSON.FeatureCollection {
  if (!you) return EMPTY;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [circlePolygon(you.lon, you.lat, Math.max(you.accuracyM, 3))],
        },
        properties: { kind: "accuracy" },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [you.lon, you.lat] },
        properties: { kind: "dot" },
      },
    ],
  };
}

/** Offline basemap (no internet) with places, route and the visitor's GPS dot. */
export function OfflineMap({
  places,
  route = NO_ROUTE,
  mapRoads = NO_PARTS,
  startCode,
  destCode,
  you,
  followYou = false,
  onPlaceTap,
  className,
  lanes,
  onLaneTap,
  reportPins = NO_PINS,
  onReportTap,
  markUnconfirmed = false,
  onMapTap,
  focus = null,
}: Props) {
  const { t, lang } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [following, setFollowing] = useState(followYou);
  const tapRef = useRef(onPlaceTap);
  tapRef.current = onPlaceTap;
  const laneTapRef = useRef(onLaneTap);
  laneTapRef.current = onLaneTap;
  const reportTapRef = useRef(onReportTap);
  reportTapRef.current = onReportTap;
  const mapTapRef = useRef(onMapTap);
  mapTapRef.current = onMapTap;
  /** What the camera was last fitted to — re-fit when the route changes. */
  const fitKeyRef = useRef<string | null>(null);

  // Create the map (again when the language changes: basemap labels are in the style).
  useEffect(() => {
    if (!box.current) return;
    const map = new MlMap({
      container: box.current,
      style: offlineMapStyle(lang),
      center: RAMKUND_CENTER,
      zoom: 15,
      maxBounds: MAX_BOUNDS,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ showCompass: true }), "top-right");
    map.on("load", () => {
      map.addSource("lanes", { type: "geojson", data: EMPTY });
      map.addSource("reports", { type: "geojson", data: EMPTY });
      map.addSource("route", { type: "geojson", data: EMPTY });
      // Admin map lanes (under the route): walked green, map roads grey dashed, off red.
      map.addLayer({
        id: "lanes-map",
        type: "line",
        source: "lanes",
        filter: ["==", ["get", "kind"], "map"],
        paint: { "line-color": "#8a958f", "line-width": 2, "line-dasharray": [2, 1.5] },
      });
      map.addLayer({
        id: "lanes-reviewed",
        type: "line",
        source: "lanes",
        filter: ["==", ["get", "kind"], "reviewed"],
        paint: { "line-color": "#2563eb", "line-width": 3, "line-dasharray": [2, 1] },
      });
      map.addLayer({
        id: "lanes-walked",
        type: "line",
        source: "lanes",
        filter: ["==", ["get", "kind"], "walked"],
        layout: { "line-cap": "round" },
        paint: { "line-color": "#17635d", "line-width": 4 },
      });
      map.addLayer({
        id: "lanes-off",
        type: "line",
        source: "lanes",
        filter: ["==", ["get", "kind"], "off"],
        layout: { "line-cap": "round" },
        paint: { "line-color": "#c0392b", "line-width": 4 },
      });
      // Invisible wide line on top of the lanes: a finger can hit a 2 px road.
      map.addLayer({
        id: "lanes-hit",
        type: "line",
        source: "lanes",
        paint: { "line-color": "#000000", "line-width": 18, "line-opacity": 0 },
      });
      map.addSource("route-map-roads", { type: "geojson", data: EMPTY });
      map.addSource("places", { type: "geojson", data: EMPTY });
      map.addSource("you", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 9 },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#e0742f", "line-width": 5 },
      });
      // White dashes over the orange line: map road, not walked by a volunteer.
      map.addLayer({
        id: "route-map-roads",
        type: "line",
        source: "route-map-roads",
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 2.5, "line-dasharray": [1.5, 2] },
      });
      map.addLayer({
        id: "places-dot",
        type: "circle",
        source: "places",
        paint: {
          "circle-radius": ["match", ["get", "role"], "dest", 9, "start", 8, 6],
          "circle-color": [
            "case",
            ["get", "hollow"],
            "#ffffff",
            ["match", ["get", "role"], "dest", "#e0742f", "start", "#17635d", "#5b6a64"],
          ],
          "circle-stroke-color": ["case", ["get", "hollow"], "#5b6a64", "#ffffff"],
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "places-label",
        type: "symbol",
        source: "places",
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Medium"],
          "text-size": 12,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
        },
        paint: { "text-color": "#13201c", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
      });
      map.addLayer({
        id: "you-accuracy",
        type: "fill",
        source: "you",
        filter: ["==", ["get", "kind"], "accuracy"],
        paint: { "fill-color": "#2f80ed", "fill-opacity": 0.15 },
      });
      map.addLayer({
        id: "you-dot",
        type: "circle",
        source: "you",
        filter: ["==", ["get", "kind"], "dot"],
        paint: {
          "circle-radius": 7,
          "circle-color": "#2f80ed",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3,
        },
      });
      map.addLayer({
        id: "reports-pin",
        type: "circle",
        source: "reports",
        paint: {
          "circle-radius": 9,
          "circle-color": "#e0742f",
          "circle-stroke-color": "#c0392b",
          "circle-stroke-width": 3,
        },
      });
      map.on("click", "lanes-hit", (e: MapLayerMouseEvent) => {
        // A place or report pin on the lane wins the tap.
        const onTop = map.queryRenderedFeatures(e.point, { layers: ["places-dot", "reports-pin"] });
        if (onTop.length > 0) return;
        const lane = e.features?.[0]?.properties?.id;
        if (typeof lane === "number") laneTapRef.current?.(lane);
      });
      for (const id of ["lanes-hit", "reports-pin"]) {
        map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
      }
      map.on("click", "reports-pin", (e: MapLayerMouseEvent) => {
        const report = e.features?.[0]?.properties?.id;
        if (typeof report === "number") reportTapRef.current?.(report);
      });
      map.on("click", (e) => mapTapRef.current?.(e.lngLat.lat, e.lngLat.lng));
      map.on("click", "places-dot", (e: MapLayerMouseEvent) => {
        if (mapTapRef.current) return; // picking a spot, not a place
        const code = e.features?.[0]?.properties?.code;
        if (typeof code === "string") tapRef.current?.(code);
      });
      map.on("mouseenter", "places-dot", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "places-dot", () => (map.getCanvas().style.cursor = ""));
      setReady(true);
    });
    // The visitor panning the map stops the camera from following them.
    map.on("dragstart", () => setFollowing(false));
    // A pinch / wheel zoom by the visitor too (camera moves we start have no originalEvent).
    map.on("zoomstart", (e) => {
      if ((e as { originalEvent?: Event }).originalEvent) setFollowing(false);
    });
    mapRef.current = map;
    // Development only: lets browser tests find on-screen positions (map.project).
    if (import.meta.env.DEV) (window as unknown as { __setuMap?: MlMap }).__setuMap = map;
    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
      // The next map (another language) fits the camera again.
      fitKeyRef.current = null;
    };
  }, [lang]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    (mapRef.current.getSource("places") as GeoJSONSource | undefined)?.setData(
      placesGeoJson(places, mapLabel, startCode, destCode, markUnconfirmed)
    );
  }, [ready, places, startCode, destCode, markUnconfirmed]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    (mapRef.current.getSource("lanes") as GeoJSONSource | undefined)?.setData(lanes ?? EMPTY);
  }, [ready, lanes]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    mapRef.current.getCanvas().style.cursor = onMapTap ? "crosshair" : "";
  }, [ready, onMapTap]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    (mapRef.current.getSource("reports") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: reportPins.map((r) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [r.lon, r.lat] },
        properties: { id: r.id },
      })),
    });
  }, [ready, reportPins]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    (mapRef.current.getSource("route") as GeoJSONSource | undefined)?.setData(
      route.length >= 2
        ? {
            type: "Feature",
            geometry: { type: "LineString", coordinates: route },
            properties: {},
          }
        : EMPTY
    );
  }, [ready, route]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    (mapRef.current.getSource("route-map-roads") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: mapRoads
        .filter((part) => part.length >= 2)
        .map((coordinates) => ({
          type: "Feature",
          geometry: { type: "LineString", coordinates },
          properties: {},
        })),
    });
  }, [ready, mapRoads]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    (mapRef.current.getSource("you") as GeoJSONSource | undefined)?.setData(youGeoJson(you));
  }, [ready, you]);

  // Fit the camera to the route, else the visitor, else every place.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    // Far away (e.g. planning at home): show the places, not an empty map.
    const here = you && inMapArea(you) ? you : null;
    const key =
      route.length >= 2
        ? `route:${route.length}:${route[0].join(",")}:${route[route.length - 1].join(",")}`
        : here
          ? "you"
          : `places:${places.length}`;
    if (fitKeyRef.current === key) return;
    // A new route (after a reroute or "I reached a place") is re-fitted unless
    // the camera is busy following the visitor.
    if (fitKeyRef.current !== null && following && here) {
      fitKeyRef.current = key;
      return;
    }
    const pts: LonLat[] =
      route.length >= 2
        ? route
        : here
          ? [[here.lon, here.lat]]
          : places.map((p) => [p.lon, p.lat] as LonLat);
    const b = boundsOf(pts);
    if (!b) return;
    fitKeyRef.current = key;
    if (pts.length === 1) map.jumpTo({ center: pts[0], zoom: 17 });
    else map.fitBounds(b, { padding: 60, maxZoom: 18, duration: 0 });
  }, [ready, route, you, places, following]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focus) return;
    map.flyTo({ center: [focus.lon, focus.lat], zoom: Math.max(map.getZoom(), 17), duration: 600 });
  }, [ready, focus]);

  // Follow the visitor while walking.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !following || !you || !inMapArea(you) || fitKeyRef.current === null) return;
    map.easeTo({ center: [you.lon, you.lat], duration: 600 });
  }, [ready, following, you]);

  return (
    <div className={`offline-map ${className ?? ""}`}>
      <div ref={box} className="offline-map-canvas" />
      {you && inMapArea(you) && !following && (
        <button
          type="button"
          className="map-recenter"
          onClick={() => {
            setFollowing(true);
            mapRef.current?.easeTo({ center: [you.lon, you.lat], zoom: 17, duration: 500 });
          }}
        >
          {t("map.myLocation")}
        </button>
      )}
    </div>
  );
}
