# Known limitations

Everything known not to work, not to be checked, or to work only within
limits, in one place (2026-10-30). Each item points to the document with the
details.

## Data

- **Nothing is verified on site.** All 156 places and 2,475 lanes come from OpenStreetMap (`osm_imported`). No volunteer has walked a lane in Nashik yet. Routes over unwalked lanes are drawn dashed, with a warning. (`NASHIK_GEO_DATA_PIPELINE.md`)
- **Only as good as OpenStreetMap.**
  - A missing bridge means a missing route, never an unsafe one.
  - A street mapped where none exists can still be routed on until someone rejects it.
  - A river mapped only as an area is checked for place links, not for streets. (`ROUTING_GRAPH_VALIDATION.md`)
- **5 unbridged crossings near Ramkund** (weirs, a Godavari footway, a Waghadi road) are left out of routing until a person reviews them. Some may be real walkways.
- **9 possible duplicate places**, one confirmed real (Kalaram Mandir / Sri Kala Rama Swamy Temple).
- **Pilot zone only:** streets cover 19.995–20.020 N, 73.780–73.815 E (Ramkund–Panchavati). 44 city-wide places (hospitals, stations, police) have no walking route. The data is one pack, not split by zone.
- **The kumbhguidenashik.in positions are 0.7–2 km off.** Only their names are used.
- **Not modelled:**
  - seasonal water (monsoon levels);
  - Snan-day road closures (they need volunteer blocks or admin rejections);
  - crowd density;
  - one-way crowd rules (except lanes marked one-way).

## Routing and guidance

- **GPS in crowds and near water** can be off by tens of metres. Arrival is announced within about 20 m (allowing for the GPS accuracy); a fix rougher than ±30 m is never used to place the visitor at the start. Tested in simulation, not on site.
- **Compass** quality varies by phone, and iOS asks for permission. The lane directions were set by volunteers' walks; none have been walked yet.
- Re-routing happens when the visitor leaves the route, not because of live crowding.
- Guidance needs location permission. Without it, the visitor picks their start place by hand.

## Offline

- **First visit needs internet** for the app, the pack (about 150 KB compressed) and the map (9 MB, downloaded on request).
- **Phones may clear the data:**
  - iOS clears sites not added to the home screen;
  - other browsers may clear data when storage runs low;
  - the app asks for persistent storage and says when it isn't granted.
- Storage-full and damaged-data handling were tested with simulated failures, not on real devices. (`OFFLINE_ARCHITECTURE.md`)

## Volunteers

- **Sign-in needs internet once per shift** (16 h).
- A block report sent late (queued offline) takes effect when it arrives; its hours count from then.
- **On a shared phone,** another volunteer's waiting changes are sent only when that volunteer signs in again.
- **Still in English:** messages written by the server (e.g. "GPS is only accurate to …") and the compass sensor notes. (`VOLUNTEER_WORKFLOW.md`)

## Admin

- **The admin map is English only.**
- **Publishing:**
  - a lane removed from the database after a publish stays on phones until the next publish;
  - a closure on a lane that is new since the last publish waits for the next publish (the panel warns);
  - any admin can publish, with no second-person approval. (`ADMIN_WORKFLOW.md`)
- OSM imports are logged in their own report, not as individual audit entries.

## Visitor safety (Phases 5–7)

- **SOS goes to Setu operators, not to 112.** The app says so everywhere and always shows "Call 112". Whether anyone answers depends on a staffed console (not yet agreed with the authority).
- **"Not sent yet" alerts** wait on the phone until it has a connection; there is no SMS fallback.
- **Lost-person cases are off in production** until the authority approves them (`CASES_ENABLED`).
- **"Ask Setu" understands set topics and place names**, not free conversation; no external AI is used. Its emergency words in Hindi and Marathi need a native-speaker review. Safety tips are general, not official.
- **The report helper** recognises common words and patterns only; every suggestion must be checked by the operator.
- **Facility status** is only as current as operators keep it; it expires automatically and then shows "not confirmed recently".
- **Closures reach a guiding phone within about 3 minutes** (it checks for new data every 3 min while guiding, and reroutes with "Route updated"), but only while it has a connection. A phone without a connection keeps its saved data; after 12 h without confirming it with the server it shows a stale-data warning.
- **QR boards**: link plus typed code; no in-app camera (the phone's own camera opens the link). No boards are printed or installed yet.

## Languages

- The Hindi and Marathi texts were written by the developer and checked only by automated rules. **A native-speaker review is needed** before the pilot.
- Place names come from OpenStreetMap; many have no Devanagari name.

## Security and privacy

See `SECURITY_AND_PRIVACY.md` for the full list. In short:
- **Not done yet:**
  - no privacy notice, and no lawyer's DPDP review (the checklist is ready: `PRIVACY_DPDP_CHECKLIST.md`);
  - no professional security review or penetration test (Phase 8 was a developer/supervisor review).
- **Dev-tool advisories:** they affect only Vite 5's development server, which `start.sh` no longer exposes.
- **Sign-in limit per network address** (30 failures / 15 min) is shared by volunteers behind one carrier address; watch it in the pilot.
- The 423 "locked" answer reveals that a phone number has an account.

## Testing

- **No real-device or on-site tests.** All tests ran on the development machine, in Chrome (simulation for movement).
- No load test, no accessibility audit, no battery measurement. (`TESTING_AND_QA.md`)
- The new `start.sh` hasn't been run with a real ngrok tunnel.

## Deployment

- **Not deployed.** There is no server or domain yet. No monitoring is set up, and backups aren't yet copied off the server. (`DEPLOYMENT_READINESS.md`)
- **Committed on the branch `kunal-offline-map-integration`, not pushed or merged.** The offline map files (`frontend/public/map/`, about 15 MB) are not in git.

## Simulation

- Development and testing only. The `start.sh` test build has `?sim=1`, so anyone with the test link can simulate their **own** position; simulated data is saved only as `unverified`. Production has no simulation, and the server refuses simulated positions. (`NASHIK_SIMULATION_MODE.md`)
