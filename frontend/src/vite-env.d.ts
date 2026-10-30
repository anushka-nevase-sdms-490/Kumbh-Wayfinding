/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

/** Basemap build in public/map (from meta.json), names the map cache. */
declare const __MAP_BUILD__: string;
/** Every file under public/map, as URL paths (big — only lib/mapDownload.ts uses it). */
declare const __MAP_URLS__: string[];
declare const __MAP_FILE_COUNT__: number;
/** Total size of public/map in bytes. */
declare const __MAP_BYTES__: number;
