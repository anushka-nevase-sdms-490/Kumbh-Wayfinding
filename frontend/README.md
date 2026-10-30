# Setu Frontend (React)

Visitor web app: GPS/list start → pick destination → follow the offline map along walked routes.

## Folder

```
frontend/
  src/           # React UI
  public/        # Static files
  package.json
```

## Run

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

## Flow

1. **Find my way**
2. Confirm the **nearest place** (GPS) or select a **starting point**
3. Select **destination**
4. Follow the **offline map** along the walked route

Optional: start backend first so the live pack loads from the API.

## Offline (PWA)

- **Places and lanes** (the pack) are saved in IndexedDB (`src/lib/packStore.ts`).
  On start the app uses the saved pack, then asks `/api/pack/latest` and downloads
  only when the signature changed (`src/lib/packSync.ts`). With no saved pack it
  shows the built-in OSM places from `src/lib/fallbackPack.ts` (no lanes).
- **App files** are precached by a service worker (`vite-plugin-pwa`, see
  `vite.config.ts`). A new version shows "A new version of the app is ready" —
  never during guidance.
- **Map** (`public/map`, from `npm run map:fetch`) is not precached; **Download
  offline map** on the home screen saves it in the `setu-map-<build>` cache, which
  the service worker serves cache-first.
- The service worker only runs in a build: test offline with
  `npm run build && npx vite preview`, then stop the servers (or DevTools →
  Network → Offline) and reload. Phones need HTTPS for this.
