import fs from "fs";
import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Phone GPS needs trusted HTTPS. start.sh sets SETU_HTTP=0 when using TLS.
const useHttp = process.env.SETU_HTTP === "1";
const keyPath = path.resolve(".certs/dev-key.pem");
const certPath = path.resolve(".certs/dev-cert.pem");
const hasCert = !useHttp && fs.existsSync(keyPath) && fs.existsSync(certPath);

// The offline map (public/map, from `npm run map:fetch`) is too big to precache
// with the app: the app downloads it on request into a cache named after the
// basemap build, so a new build starts a fresh cache.
const mapDir = path.resolve("public/map");
function listMapFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listMapFiles(full) : [full];
  });
}
const mapFiles = listMapFiles(mapDir);
const mapBuild = fs.existsSync(path.join(mapDir, "meta.json"))
  ? String(JSON.parse(fs.readFileSync(path.join(mapDir, "meta.json"), "utf-8")).build)
  : "none";
const mapUrls = mapFiles.map((f) => "/map/" + path.relative(mapDir, f).split(path.sep).join("/"));
const mapBytes = mapFiles.reduce((sum, f) => sum + fs.statSync(f).size, 0);

// Proxy API through Vite so one public HTTPS URL (ngrok) reaches the backend too.
// start.sh exports SETU_BACKEND_PORT when BACKEND_PORT is not 8000.
const backendPort = process.env.SETU_BACKEND_PORT ?? "8000";
const backend = `${hasCert ? "https" : "http"}://127.0.0.1:${backendPort}`;

export default defineConfig({
  define: {
    __MAP_BUILD__: JSON.stringify(mapBuild),
    __MAP_URLS__: JSON.stringify(mapUrls),
    __MAP_FILE_COUNT__: JSON.stringify(mapUrls.length),
    __MAP_BYTES__: JSON.stringify(mapBytes),
  },
  plugins: [
    react(),
    VitePWA({
      strategies: "generateSW",
      // Ask before swapping in a new version — never mid-walk.
      registerType: "prompt",
      devOptions: { enabled: false },
      manifest: {
        name: "Setu — Kumbh Wayfinding",
        short_name: "Setu",
        description: "Offline map and walking directions for Nashik Kumbh Mela.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        theme_color: "#1a5f5a",
        background_color: "#f7f3ea",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // MapLibre's worker is an .mjs file.
        globPatterns: ["**/*.{js,mjs,css,html,svg,png,webmanifest,woff2}"],
        globIgnores: ["map/**"],
        maximumFileSizeToCacheInBytes: 3_000_000,
        cleanupOutdatedCaches: true,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/health/, /^\/map\//],
        // The pack is kept in IndexedDB (lib/packStore.ts), not here.
        runtimeCaching: [
          {
            urlPattern: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith("/map/"),
            handler: "CacheFirst",
            options: {
              cacheName: `setu-map-${mapBuild}`,
              // A server answering a missing map file with index.html must not
              // be cached as a tile or font.
              plugins: [
                {
                  cacheWillUpdate: async ({ response }) =>
                    response.status === 200 &&
                    !(response.headers.get("content-type") ?? "").includes("text/html")
                      ? response
                      : null,
                },
              ],
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      // xfwd: pass the phone's IP on (X-Forwarded-For) — uvicorn trusts it from 127.0.0.1.
      "/api": {
        target: backend,
        changeOrigin: true,
        secure: false,
        xfwd: true,
      },
      "/health": {
        target: backend,
        changeOrigin: true,
        secure: false,
        xfwd: true,
      },
    },
    ...(hasCert
      ? {
          https: {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath),
          },
        }
      : {}),
  },
});
