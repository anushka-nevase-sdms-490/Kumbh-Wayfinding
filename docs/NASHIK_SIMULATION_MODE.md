# Nashik simulation mode (development only)

Lets a developer test the whole visitor navigation from anywhere (e.g. Pune)
with simulated positions in Nashik. The simulation **uses the real app**: the
same router (`lib/router.ts`), route line, GPS filter (`lib/gpsFilter.ts`),
route progress, next-place advance, arrival and reroute logic as a phone in
Nashik. Only the source of positions is different.

## Turning it on and off

```bash
./start.sh                                   # a test build with simulation (also on the phone link)
# open http://localhost:5173/?sim=1          (the backend port does not matter)
FRONTEND_MODE=dev ./start.sh                 # live-reloading dev server, this PC only
```

- `?sim=1` turns it on for this browser tab (kept in `sessionStorage`).
- **Exit simulation** in the panel, or `?sim=0`, goes back to the phone's real GPS.
- A striped **SIMULATION MODE** banner is shown the whole time, and the guide's GPS line starts with `[SIM]`.

### Never in production
- The simulation exists only when `import.meta.env.DEV` is true (`npm run dev`), or in a build made with `VITE_ENABLE_SIMULATION=1` for testing (`start.sh` makes such a build; the production Docker image runs a normal `npm run build`).
- In a normal `npm run build`, `LazySimulationPanel` is the constant `null`, so the code is left out. This was checked: no simulation strings and no simulation chunk in `dist/`. With the flag there are 2 chunks.
- `?sim=1` on a production build does nothing.

## Real GPS and simulation are separate

| Provider | File | Source |
|---|---|---|
| `RealGPSProvider` | `src/lib/location/realGps.ts` | `navigator.geolocation.watchPosition`, unchanged |
| `SimulationLocationProvider` | `src/lib/location/simulation.ts` | simulated walker, one report per second |

Both implement `LocationProvider` (`src/lib/location/types.ts`).
`useLivePosition(active, provider)` reads from the one `App.tsx` chooses. The
simulation never patches or overrides `navigator.geolocation`, and switching
provider resets the GPS filter.

The walking maths is a set of pure functions (`src/lib/location/simulationWalk.ts`):
`startWalk`, `stepSim`, `followNewPath`, `goOffRoute`, `backOnRoute`. The tests
drive them second by second.

## The panel

| Control | What it does |
|---|---|
| Position / status | Simulated true position, reported accuracy, walked / total / left, minutes at the current speed |
| **▶ Start** | Walks the app's current route from its start (open the guide first) |
| **❚❚ Pause / ▶ Resume** | Stops / continues walking (GPS reports keep coming, like a phone standing still) |
| **↺ Reset** | Back to the start of the route, standing |
| Speed | 1× (1.3 m/s walking), 2×, 5×, 10× |
| **📍 Place me on map** | The next tap on any map sets the position (place pins are not selected meanwhile) |
| Place me at… | Puts the walker on a listed place |
| GPS ±N m | Reported accuracy 3–80 m (above 28 m the app treats GPS as too rough to navigate) |
| Noise | Scatters reports inside about 60 % of the accuracy circle |
| **⚡ GPS jump** | One report 120 m away, then normal again |
| **↗ Walk off route / ↩ Back to route** | Walks away at a right angle; back walks straight to the (possibly new) route and on along it |
| **🚫 Lose signal / 📶 Signal back** | Stops reports (the walker keeps moving) / resumes |
| Exit simulation | Back to the real GPS |

The walker follows route changes by itself: when the app moves on to the next
place or reroutes, it continues along the new line from where it is.

## Typical test (from Pune)

1. `./start.sh`, open `http://localhost:5173/?sim=1`, I am a visitor → Find my way.
2. The start screen says "You are near Ramkund Ghat" (simulated, while the real GPS is in Pune). Tap it.
3. Choose **Kalaram Mandir**. The guide opens with the route.
4. Set the speed to 10× and press **▶ Start**. Watch "In 22 m: Turn right" → "Turn right now" → … → **You have arrived**.
5. New trip: Start, then **⚡ GPS jump** (no reroute), **↗ Walk off route** (after about 8 s: "You left the route — new way from …"), **↩ Back to route**, **🚫 Lose signal** (after 30 s: "No GPS signal right now …"), **📶 Signal back**.

## Results (2026-10-30, Chrome, dev server, real GPS in Pune)

| Test | Result |
|---|---|
| Simulated start near Ramkund | "You are near Ramkund Ghat · 1 m" |
| Place me at Kalaram Mandir / Ramkund Ghat | Start suggestion follows |
| Place me on map (real click) | Position set to the clicked point (±1 m) |
| Ramkund → Kalaram at 10× | Distance and "about N min" counted down; each turn "In X m" → "now"; **You have arrived** |
| One GPS jump | No reroute (needs 3 bad fixes in a row) |
| Walk off route | Reroute after about 8 s: "new way from Sti Datta Paduka" (429 m) |
| Back to route | Rejoined; countdown continued (330 m) |
| Lose signal | **Found a gap:** "Live GPS" stayed with a frozen position. Fixed: after 30 s without reports the app says "No GPS signal right now …" (the last position stays in use, because some phones report rarely while standing still); the note clears with the next report. Verified in Chrome with the earlier 10 s setting; the 30 s value is checked by type-check and code review only |
| Exit simulation | Back to `/`, no banner or panel, real GPS |

**Automated:** `runRoutingTests.ts` T26 (12 checks) covers the walking speed,
speed control, lost signal, jump, noise bounds, off route and back, following
a changed route, and a **headless end-to-end walk**: simulated fixes with noise
→ GPS filter → route progress → next-junction advance → arrival detected at
239 s, as expected.

## Volunteer screens

With `?sim=1` the panel also appears in volunteer mode, with a **Walk to…**
control: "Place me at" a place, then "Walk to" another, and the simulated
volunteer walks the real lanes between them (at the chosen speed).

- The volunteer screens read GPS through `lib/location/geo.ts`, which serves simulated positions **only while the panel runs**. `navigator.geolocation` is never patched.
- Everything saved from simulated positions is sent with `"simulated": true`:
  - **development server:** saved as `unverified`, with the note "Simulated position (development test) — not on site", and never promoted to volunteer-verified;
  - **production server** (`SETU_ENV=production`): refused with 403.
- Test this on a **copy** of the database, never the real one.

Tested 2026-10-30 (DB copy, throwaway test volunteer):
- offline register at a simulated spot plus a 414 m simulated walk from Ramkund Ghat → both kept on the phone;
- server back → sent in order, the walk filled in with the new code (KUMBH-A01);
- both stored as `unverified` with the simulation note.

## Limits

- The simulation tests the software, **not** real GPS behaviour in Nashik's
  lanes: multipath, real drift and phone differences need field tests.
- Volunteer screens still use the real GPS (`getCurrentPosition`); routing
  them through the provider is planned with the volunteer work.
- The walker follows the drawn route exactly; it does not model crowds or
  choosing a different street on purpose (use "Walk off route").
