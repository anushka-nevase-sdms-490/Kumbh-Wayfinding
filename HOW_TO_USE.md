# How to use Setu (simple)

## What you are looking at

`http://localhost:5173` is the **visitor phone website**.

It should show:
- big title **Kumbh Wayfinding**
- two buttons: **I am a visitor** and **I am a volunteer**

If you see a blank cream page:
1. Press **Ctrl + Shift + R** (hard refresh)
2. Or close the tab and open http://localhost:5173 again
3. Make sure the project is running: `./start.sh`

---

## Start the system

Open Terminal and run:

```bash
cd /home/stark/Kumbh-Wayfinding
./start.sh
```

Wait until it prints:

- Frontend: http://localhost:5173
- Backend: http://localhost:8000 (or 8010 if another program already uses 8000 — start.sh says which)

Then open **http://localhost:5173** in Chrome.

---

## How to use it (click by click)

### Screen 1 — Home
Pick a language — **English**, **हिंदी** or **मराठी** (the phone's language is
chosen at first). Click **I am a visitor**, then **Find my way**

Before going to the mela (while you still have internet):

- tap **Download offline map** on this screen once (about 9 MB) — then the map
  works with no network at all
- add the app to your home screen (Chrome menu → **Install app** / **Add to Home
  screen**; iPhone Safari → Share → **Add to Home Screen**). On iPhone this also
  stops Safari from clearing the saved map and places.

The line at the bottom says how fresh the places on your phone are
(**Offline data from …**). **Sample places only** means the walked lanes have not
been downloaded yet — open the app once with internet.

### Screen 2 — Where are you? (starting point)
Allow location when the browser asks. The phone finds the nearest registered
place and shows **You are near …** with the GPS accuracy. Tap it to confirm.
If two places are close together, both are shown — tap the one you can see.

No GPS, or GPS weak? Pick your place from the list (sorted nearest first when
there is a GPS fix).

### Screen 3 — Where to? (destination)
Click where you want to go, e.g. **Medical Camp** or **Toilet Block A**

### Screen 4 — Guide (offline map)
You see an **offline map** of Nashik (no internet needed) with:

- an **orange line** — the walked route to your destination
- a **blue dot** — you (the pale circle is the GPS accuracy)
- **metres to go** at the top, the next instruction and the next place below

Tap **I reached a place** at each place on the route to keep the route exact.
When GPS says you are on the final lane and close to the destination you get a
green **You have arrived**. Drag the map to look around; **My location** brings
it back to you. **All directions** lists every turn.

Note: GPS only works over **https** (or localhost) — `start.sh` sets that up.

---

## What this system is doing (idea)

1. Real Kumbh has temporary roads Google Maps does not know.  
2. Volunteers register real places with on-site GPS and walk the lanes between them.  
3. Your phone's GPS finds the nearest place → "I am here" (or pick from the list).  
4. You pick a destination → the phone finds a route along walked lanes.  
5. The offline map shows the route line and your GPS position.  
6. No internet needed after the map is on the phone.

---

## Two parts of the project

| Part | Folder | URL / role |
|------|--------|------------|
| Website (what you use now) | `frontend/` | http://localhost:5173 |
| Server (stores the map) | `backend/` | http://localhost:8000 (or the port start.sh prints) |

You mostly only need the website for the demo.

---

## Stop

In the terminal where `./start.sh` is running, press **Ctrl + C**.

---

## For the data team: OpenStreetMap places and roads

```bash
cd backend
.venv/bin/python scripts/import_osm.py all       # places, water (rivers), roads — first setup
.venv/bin/python scripts/import_osm.py network   # roads again (after new places)
.venv/bin/python scripts/validate_graph.py       # check: no route through the river
```

Run `network` again whenever volunteers have registered or confirmed places —
new places are only joined to the roads by that step. Routes on map roads are
shown dashed with a warning until a volunteer walks them. Rivers and weirs are
crossed only on mapped bridges (or crossings approved in
`backend/config/approved_crossings.json`) — see `docs/ROUTING_GRAPH_VALIDATION.md`.

---

## Volunteers: sign in

Volunteer mode asks for your **mobile number and 6-digit PIN** (your team admin
creates the account). The sign-in lasts one shift (16 hours) and needs the
internet once. If it ends while you are filling a form, the app asks you to sign
in again over the form — what you entered is kept; then press save again.

## Visitors' "Path blocked" reports

When a visitor taps **Path blocked**, their phone gets a new way at once, but
nothing changes for anyone else — it is only a report. Volunteers see reports
under **Report a blocked lane → Visitor reports**, nearest first. Walk to the
lane, then tap **Blocked · 1 h / 4 h / Until reopened** or **Not blocked**.
Timed blocks reopen by themselves; reports nobody checks expire after 2 hours.

## Admins: the admin map

Signed in as an admin, the volunteer home shows **Admin map**: every place
(hollow = nobody has confirmed it on site yet), every lane (green = walked by a
volunteer, grey dashed = map road, red = blocked or closed) and visitor reports
(orange pins). Tap a lane to reopen it or mark it walkable / not walkable; tap a
report to confirm or reject it. Accounts are managed with
`backend/scripts/manage_volunteers.py`.

---

## Developers: test Nashik navigation from anywhere (simulation)

Open the app with **`?sim=1`** (e.g. http://localhost:5173/?sim=1) while running
`./start.sh`. A striped SIMULATION MODE banner appears and a panel lets you
place yourself in Nashik, walk the route (1×–10×), add GPS noise or a jump,
walk off the route, or lose the signal. It uses the real routing and guide.
Only in development builds — see `docs/NASHIK_SIMULATION_MODE.md`.
