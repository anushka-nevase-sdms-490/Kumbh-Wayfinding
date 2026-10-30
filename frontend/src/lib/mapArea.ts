/**
 * Area covered by the offline basemap: Nashik city, Trimbakeshwar, Tapovan
 * and the outer parkings. Shared by the app and scripts/fetchOfflineMap.ts.
 */
export const KUMBH_BOUNDS: [number, number, number, number] = [73.4, 19.85, 73.95, 20.1]; // W,S,E,N

/** Protomaps builds stop at zoom 15; MapLibre overzooms the vector tiles. */
export const BASEMAP_MAX_ZOOM = 15;

/** Default view: Ramkund (OpenStreetMap position). */
export const RAMKUND_CENTER: [number, number] = [73.79249, 20.00726];
