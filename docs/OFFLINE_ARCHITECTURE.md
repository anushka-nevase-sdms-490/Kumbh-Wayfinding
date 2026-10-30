# Offline architecture

Goal: once a visitor has opened the app online, it keeps working with **no
internet and no server**: the app, the map, the places and lanes, route
finding and guidance. All of this runs on the phone.

## What is stored where

| Data | Where | Filled when | Updated |
|---|---|---|---|
| App code (HTML, JS, CSS, icons, MapLibre worker) | Service worker precache (`vite-plugin-pwa`, `vite.config.ts`) | First visit | On a new app version: installed in the background; the visitor taps "A new version of the app is ready → Reload" (never shown during guidance) |
| Offline map (tiles z0–15, fonts including Devanagari, sprites: 1,784 files, ~9 MB) | Cache Storage `setu-map-<build>` (`lib/mapCache.ts`) | "Download offline map" on the home screen | A new basemap build gets a new cache; the old one is deleted only **after** the new one is complete |
| Places and lanes ("pack") | IndexedDB `setu` → `pack` → `current` (`lib/packStore.ts`) | First visit online | When the server's version differs (`lib/packSync.ts`) |
| Language, sign-in, simulation flag | localStorage / sessionStorage | — | — |

## Reliability rules

| Requirement | How |
|---|---|
| Existing data stays usable during updates | A new pack is downloaded and checked (whole pack, signature matches, has places) **before** it replaces the old one. The map's old cache is kept until the new one is complete. The app shell switches only when the visitor reloads. |
| Atomic dataset updates | The pack is written in **one IndexedDB transaction** (all or nothing) |
| Interrupted downloads resume | The map skips files already in the cache and continues ("Continue download"); the pack is small (~150 KB compressed) and is downloaded again |
| Damaged data is detected | Each saved pack carries a **checksum** (FNV-1a of its JSON). On load the structure and checksum are checked; a damaged copy is **removed**, the visitor is told ("…was damaged and has been removed — it downloads again when you are online"), and the app uses the built-in sample places until a good copy arrives. Copies saved before checksums still load and are re-saved with one. |
| Broken database recovery | If IndexedDB cannot be opened because it is broken (`UnknownError`), the database is deleted and recreated empty (its data comes back from the server). A `VersionError` (an old tab meeting a newer app's database) is **not** reset — the newer app's data is kept |
| Storage full | Saving the pack reports `quota`, and the home screen says "Phone storage is full…". The map download checks free space first ("About N MB free — the map needs about 9 MB"), **stops at the first storage-full error**, keeps what it saved, and says "Not enough free space…" |
| Data version and update status visible | Home screen: "Offline data from <time> · N places". **Data details:** version, OpenStreetMap date, last update check and its result (up to date / new data downloaded / no connection / server problem / no data yet), and whether the phone keeps the data when storage runs low |
| Updates never interrupt navigation | The update banner is hidden during guidance; the pack swaps in the background and the route continues |
| No backend needed once downloaded | Route finding (A*), progress, arrival and reroute run in the browser on the stored pack |
| Server problems explained | Pack check results: `unreachable` (offline, timeout, or a **5xx**, i.e. the server is down behind its proxy), `wrong_server` (a 4xx or a non-Setu answer), `empty`, `rejected` (damaged download), `same`, `newer` |
| Storage kept | `navigator.storage.persist()` is requested after saving; if the browser doesn't grant it, the details say so and suggest adding the app to the home screen (iOS clears storage of sites not added) |

## Tests (2026-10-30)

**Automated:**
- `runRoutingTests.ts` **T28**:
  - the checksum is stable and catches a changed coordinate;
  - a damaged copy is rejected, an old copy without a checksum is accepted, an empty or missing copy is rejected;
  - "storage full" is recognised in the Chrome, Firefox and Safari forms.
- **T22:**
  - 404 or a non-Setu answer → wrong server;
  - **5xx → no connection**;
  - empty server → empty;
  - a download not matching the version → rejected.

**Chrome:**

| Test | Result |
|---|---|
| Fresh phone, online | Pack saved with a checksum; Data details: version, OSM date 2026-10-30, "new data downloaded" |
| One coordinate changed in the saved copy, backend stopped, reload | Damaged copy **removed**, the notice shown, sample places used. With the backend back online, a good copy downloaded and the notice cleared |
| Storage full during the map download (simulated: the cache refuses writes after 30 files) | Stopped after 40 attempts (not 1,784); 30 files kept; "Not enough free space… tap to continue". With space again, "Continue download" finished: 1,784 files |
| New basemap files after an update (the Devanagari font added) | The card showed "Part of the map is saved"; Continue fetched only the 5 new files |
| App update with an older version installed | "A new version of the app is ready" → Reload; old saved data accepted |
| **Airplane-mode equivalent: production build, all servers stopped** | App loaded from the service worker; places from IndexedDB; Ramkund → Kalaram "413 m · about 6 min", "In 58 m: Turn right", map drawn. `?sim=1` did nothing (no simulation in production) |

## Not tested / limits

- **Real phones:** Android Chrome, the installed PWA, iOS Safari and Add to Home Screen. Storage eviction rules differ by browser and must be checked on devices (ROADMAP 4.2).
- **Real storage limits** were simulated, not reached on a device.
- **The pack is one file for the whole pilot zone.** Zone-based packs are needed before covering more of Nashik.
- **Browser data cleared by the user** removes everything; the app then starts like a first visit (built-in sample places until online).
