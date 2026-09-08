# How to use Setu (simple)

## What you are looking at

`http://localhost:5173` is the **pilgrim phone website**.

It should show:
- big title **Setu**
- a short explanation
- an orange arrow
- a green button **Find my way**

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
- Backend: http://localhost:8000

Then open **http://localhost:5173** in Chrome.

---

## How to use it (click by click)

### Screen 1 — Home
Click **Find my way**

### Screen 2 — Where are you? (starting point)
You are lost on the mela ground. Choose how you mark your place:

**Option A:** Click **Scan QR board** (needs camera)  
**Option B (easier for demo):** scroll the list and click e.g. **Ram Kund Ghat**

### Screen 3 — Where to? (destination)
Click where you want to go, e.g. **Medical Camp** or **Toilet Block A**

### Screen 4 — Guide
You will see:
- a **big orange arrow** → walk that way
- **Next:** the next QR board on the path
- a **route list** (board → board on man-made paths)
- buttons: **Rescan board**, **Turn left**, **Turn right**

On a laptop, sensors may not move the arrow — use **Turn left / Turn right**.

---

## What this system is doing (idea)

1. Real Kumbh has temporary roads Google Maps does not know.  
2. Staff put QR boards at real places.  
3. You scan/select one → phone knows “I am here”.  
4. You pick destination → phone finds path board-to-board.  
5. Arrow points the way using phone motion sensors (gyroscope).  
6. No internet needed after the map is on the phone.

---

## Two parts of the project

| Part | Folder | URL / role |
|------|--------|------------|
| Website (what you use now) | `frontend/` | http://localhost:5173 |
| Server (stores the map) | `backend/` | http://localhost:8000 |

You mostly only need the website for the demo.

---

## Stop

In the terminal where `./start.sh` is running, press **Ctrl + C**.
