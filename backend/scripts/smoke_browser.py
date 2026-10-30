"""
Browser smoke test: real headless Chrome against a production build, on a COPY
of the local database (the real one is never changed).

  .venv/bin/python scripts/smoke_browser.py            # builds the app first
  .venv/bin/python scripts/smoke_browser.py --no-build # reuse frontend/dist

Uses ports 8010 (API) and 4173 (app) and refuses to run if they are busy.
Needs Chrome, a built offline map (frontend/public/map) and backend/setu_local.db
with the Nashik data (start.sh builds it). Exit code 1 if a check fails.
"""
import json
import os
import re
import secrets
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
FRONTEND = os.path.join(os.path.dirname(BACKEND), "frontend")
sys.path.insert(0, HERE)
from cdp import Chrome  # noqa: E402

API_PORT, APP_PORT = 8010, 4173
APP = f"http://localhost:{APP_PORT}"
RAMKUND = (20.007264, 73.792489)

ok = True


def check(cond, msg):
    global ok
    print(("OK   " if cond else "FAIL ") + msg, flush=True)
    ok = ok and bool(cond)


def busy(port: int) -> bool:
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def wait_http(url: str, seconds: float = 60) -> bool:
    end = time.time() + seconds
    while time.time() < end:
        try:
            urllib.request.urlopen(url, timeout=2)
            return True
        except OSError:
            time.sleep(0.4)
    return False


# Helpers injected into the page for each step.
JS = r"""
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const btn = (t) => [...document.querySelectorAll("button")].find((b) => b.textContent.includes(t));
const click = async (t, wait = 600) => { const b = btn(t); if (!b) throw new Error("no button: " + t); b.click(); await sleep(wait); };
const waitFor = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(250); } return null; };
const setInput = (el, v) => { const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); };
const text = () => document.body.innerText;
const back = async (wait = 700) => { const b = document.querySelector('.volunteer-head .back, .topbar .back'); if (!b) throw new Error('no back button'); b.click(); await sleep(wait); };
"""


def run(chrome: Chrome, body: str, timeout_s: float = 60):
    """Run a step in the page; a page error counts as a failed step (None), not a crash."""
    try:
        return chrome.eval(JS + body, timeout_s=timeout_s)
    except Exception as exc:  # noqa: BLE001
        print(f"     page step error: {exc}", flush=True)
        return None


def production_csp() -> str:
    """The Content-Security-Policy production sends (deploy/Caddyfile)."""
    caddy = open(os.path.join(BACKEND, "..", "deploy", "Caddyfile"), encoding="utf-8").read()
    return re.search(r'Content-Security-Policy "([^"]+)"', caddy).group(1)


class Servers:
    """The API (on the database copy) and the built app, stoppable for offline tests."""

    def __init__(self, env, log):
        self.env, self.log, self.procs = env, log, []

    def start(self) -> bool:
        self.procs = [
            subprocess.Popen(
                [os.path.join(BACKEND, ".venv/bin/uvicorn"), "app.main:app", "--host", "127.0.0.1",
                 "--port", str(API_PORT), "--forwarded-allow-ips", "127.0.0.1,::1,::ffff:127.0.0.1"],
                cwd=BACKEND, env=self.env, stdout=self.log, stderr=subprocess.STDOUT, start_new_session=True),
            subprocess.Popen(
                ["npx", "vite", "preview", "--port", str(APP_PORT), "--strictPort"], cwd=FRONTEND,
                env={**os.environ, "SETU_HTTP": "1", "SETU_BACKEND_PORT": str(API_PORT), "SETU_PREVIEW_CSP": production_csp()},
                stdout=self.log, stderr=subprocess.STDOUT, start_new_session=True),
        ]
        return wait_http(f"http://127.0.0.1:{API_PORT}/health") and wait_http(f"http://127.0.0.1:{APP_PORT}/")

    def stop(self) -> None:
        # Each server runs in its own process group (npx starts a child node process).
        for p in self.procs:
            try:
                os.killpg(p.pid, signal.SIGTERM)
            except ProcessLookupError:
                continue
            try:
                p.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(p.pid, signal.SIGKILL)
        end = time.time() + 10
        while (busy(API_PORT) or busy(APP_PORT)) and time.time() < end:
            time.sleep(0.2)


def main() -> int:
    if busy(API_PORT) or busy(APP_PORT):
        print(f"Ports {API_PORT}/{APP_PORT} are busy — stop those servers first.")
        return 2
    if not os.path.exists(os.path.join(FRONTEND, "public/map/meta.json")):
        print("No offline map (frontend/public/map). Run: cd frontend && npm run map:fetch")
        return 2
    real_db = os.path.join(BACKEND, "setu_local.db")
    if not os.path.exists(real_db):
        print("No backend/setu_local.db — run ./start.sh once to build the Nashik data.")
        return 2

    tmp = tempfile.mkdtemp(prefix="setu-smoke-")
    db = os.path.join(tmp, "smoke.db")
    shutil.copy(real_db, db)
    env = {**os.environ, "USE_SQLITE": "1", "SQLITE_PATH": db, "PACK_DIR": os.path.join(tmp, "packs"),
           "PUBLISH_MODE": "auto", "SETU_ENV": "development"}
    # A throwaway volunteer in the copy (its PIN never leaves this run).
    phone, pin = "9100000099", "".join(secrets.choice("23456789") for _ in range(6))
    subprocess.run([os.path.join(BACKEND, ".venv/bin/python"), "-c", (
        "import sys; sys.path.insert(0, '.');"
        "from app.auth import hash_pin; from app.db import SessionLocal, Volunteer, init_db; init_db(); db=SessionLocal();"
        f"db.query(Volunteer).filter(Volunteer.phone=='{phone}').delete();"
        f"db.add(Volunteer(phone='{phone}', name='Smoke Test', pin_hash=hash_pin('{pin}'), role='admin', active=True)); db.commit()"
    )], cwd=BACKEND, env=env, check=True, capture_output=True)

    if "--no-build" not in sys.argv:
        print("Building the app…", flush=True)
        subprocess.run(["npm", "run", "build"], cwd=FRONTEND, check=True, capture_output=True)

    log = open(os.path.join(tmp, "servers.log"), "w")
    servers = Servers(env, log)
    chrome = None
    try:
        if not servers.start():
            print(f"Servers did not start — see {tmp}/servers.log")
            return 2
        chrome = Chrome(os.path.join(tmp, "profile"))
        # Record anything the production CSP blocks, on every page load.
        chrome.call("Page.addScriptToEvaluateOnNewDocument", source=(
            "document.addEventListener('securitypolicyviolation', (e) => { try {"
            " const v = JSON.parse(localStorage.getItem('__csp') || '[]');"
            " v.push(e.violatedDirective + ' ' + (e.blockedURI || '')); localStorage.setItem('__csp', JSON.stringify(v));"
            " } catch {} });"))
        chrome.gps(*RAMKUND, accuracy=8, origin=APP)
        chrome.goto(APP + "/")
        run(chrome, "localStorage.setItem('setu-lang','en'); location.reload(); return 1;")
        time.sleep(3)

        smoke_steps(chrome, servers, db_path=db, phone=phone, pin=pin)
        r = run(chrome, """
          const res = await fetch('/', { cache: 'no-store' });
          try { await fetch('https://blocked.invalid/probe'); } catch {}  // proves the recorder works
          await sleep(300);
          return { csp: res.headers.get('content-security-policy') || '', v: JSON.parse(localStorage.getItem('__csp') || '[]') };
        """)
        blocked = [v for v in (r or {}).get("v", []) if "blocked.invalid" not in v]
        check(r and r["csp"] == production_csp() and len(r["v"]) == 1 and not blocked,
              f"the whole run used the production Content-Security-Policy: only the deliberate probe was blocked ({(r or {}).get('v')})")
    finally:
        if chrome:
            chrome.close()
        servers.stop()
        log.close()
    print("\nALL OK" if ok else f"\nSOME FAILED (log kept: {tmp}/servers.log)")
    if ok:
        shutil.rmtree(tmp, ignore_errors=True)
    else:
        # Keep only the log: the database copy holds volunteers' phone numbers.
        for name in os.listdir(tmp):
            if name != "servers.log":
                path = os.path.join(tmp, name)
                shutil.rmtree(path, ignore_errors=True) if os.path.isdir(path) else os.remove(path)
    return 0 if ok else 1


def smoke_steps(chrome: Chrome, servers: Servers, db_path, phone, pin):
    # 1. First visit: app shell, places saved on the phone.
    r = run(chrome, """
      await waitFor(() => btn('I am a visitor'));
      await click('I am a visitor', 1500);
      const status = await waitFor(() => document.querySelector('.pack-status')?.textContent.includes('Offline data') && document.querySelector('.pack-status').textContent);
      const sw = await navigator.serviceWorker.ready.then(() => true);
      return { status, sw };
    """)
    check(r and r["status"] and r["sw"], f"first visit: service worker active and places saved on the phone ({r and r['status']})")

    # 2. Download the offline map.
    r = run(chrome, """
      await click('Download offline map', 500);
      const done = await waitFor(() => /saved on this phone/.test(document.querySelector('.map-save')?.innerText || ''), 90000);
      return !!done;
    """, timeout_s=120)
    check(r, "offline map downloads and is saved on the phone")

    # 3. Airplane mode: both servers stopped and the network switched off.
    servers.stop()
    chrome.offline(True)
    chrome.goto(APP + "/", settle_s=3)
    r = run(chrome, """
      await waitFor(() => btn('I am a visitor'));
      await click('I am a visitor', 1200);
      await click('Find my way', 1500);
      await click('Ramkund Ghat', 1000);
      await click('Kalaram Mandir', 3500);
      return { top: document.querySelector('.topbar')?.innerText || '', now: document.querySelector('.guide-now')?.textContent || '',
               map: !!document.querySelector('.maplibregl-canvas') };
    """)
    check(r and "to go" in r["top"] and r["map"], f"airplane mode: route Ramkund → Kalaram with the map ({r and r['top'].replace(chr(10), ' | ')})")
    chrome.offline(False)
    check(servers.start(), "servers back up")

    # 4. Language: Hindi.
    chrome.goto(APP + "/", settle_s=2.5)
    r = run(chrome, """
      await waitFor(() => btn('हिंदी'));
      await click('हिंदी', 600);
      const hi = text().includes('मैं');
      await click('English', 400);
      return hi;
    """)
    check(r, "language switch: the start screen changes to Hindi and back")

    # 4b. "Ask Setu" (Phase 7): offline answers from the saved data.
    servers.stop()
    chrome.offline(True)
    chrome.goto(APP + "/", settle_s=3)
    r = run(chrome, """
      await click('I am a visitor', 1000);
      await click('Ask Setu', 1200);
      await click('Medical help', 800);
      const ans = document.querySelector('.ask-answer')?.innerText || '';
      setInput(document.querySelector('.ask-screen input'), 'सबसे पास अस्पताल');
      document.querySelector('.ask-screen form').requestSubmit(); await sleep(500);
      const hi = document.querySelector('.ask-answer')?.innerText || '';
      setInput(document.querySelector('.ask-screen input'), 'what is the weather tomorrow');
      document.querySelector('.ask-screen form').requestSubmit(); await sleep(500);
      const unk = document.querySelector('.ask-answer')?.innerText || '';
      setInput(document.querySelector('.ask-screen input'), 'my father fell and is bleeding');
      document.querySelector('.ask-screen form').requestSubmit(); await sleep(500);
      const em = document.querySelector('.ask-emergency')?.innerText || '';
      const sosBtn = [...document.querySelectorAll('.ask-emergency button')].find((b) => b.textContent.includes('Send SOS'));
      sosBtn?.click(); await sleep(1200);
      const note = document.querySelector('.sos-note textarea')?.value || '';
      return { ans, hi, unk, em, note };
    """)
    check(r and "This sounds like an emergency" in r["em"] and "Call 112" in r["em"] and r["note"] == "my father fell and is bleeding",
          "Ask Setu: 'my father fell and is bleeding' → emergency box (Call 112, Send SOS); Send SOS opens the alert with those words")
    check(r and "Nearest medical help" in r["ans"] and "Show the way" in r["ans"] and "Nearest" in r["hi"]
          and "I can only answer from Setu's saved data" in r["unk"],
          "Ask Setu in airplane mode: nearest medical help from the saved data; Hindi question; honest 'cannot answer'")
    chrome.offline(False)
    check(servers.start(), "servers back up")

    # 4c. Stale saved data (Phase 8): warned offline, cleared once the server confirms it again.
    servers.stop()
    chrome.offline(True)
    run(chrome, "localStorage.setItem('setu-pack-confirmed', '2026-01-01T00:00:00Z'); return 1;")
    chrome.goto(APP + "/", settle_s=3)
    stale = run(chrome, "await click('I am a visitor', 1000); return [...document.querySelectorAll('.pack-status.warn')].map((p) => p.innerText).join(' ');") or ""
    chrome.offline(False)
    check(servers.start(), "servers back up")
    chrome.goto(APP + "/", settle_s=5)
    fresh = run(chrome, "await click('I am a visitor', 1000); return [...document.querySelectorAll('.pack-status.warn')].map((p) => p.innerText).join(' ');") or ""
    check("Lanes may have closed since" in stale and "Lanes may have closed since" not in fresh,
          f"stale data: warned offline ('{stale[:60]}'), cleared once the server confirms it")

    # 5. QR boards, facility status and search (Phase 5), set up through the API as the test admin.
    def api(path, body=None, token=None):
        req = urllib.request.Request(f"http://127.0.0.1:{API_PORT}{path}", method="POST" if body is not None else "GET",
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Content-Type": "application/json",
                                              **({"Authorization": f"Bearer {token}"} if token else {})})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)

    token = api("/api/auth/login", {"phone": phone, "pin": pin})["token"]
    nodes = api("/api/pack/latest/json")["nodes"]
    ramkund = next(n["code"] for n in nodes if n["name"] == "Ramkund Ghat")
    kalaram = next(n["code"] for n in nodes if n["name"] == "Kalaram Mandir")
    board = api("/api/admin/board", {"code": ramkund}, token)["board_code"]
    api("/api/admin/place-status", {"code": kalaram, "status": "closed", "hours": 3, "note": "smoke test"}, token)

    chrome.goto(APP + f"/?at={board}", settle_s=4)
    r = run(chrome, """
      const chip = await waitFor(() => document.querySelector('.start-chip')?.innerText);
      return { chip, url: location.search };
    """)
    check(r and "Ramkund Ghat" in (r["chip"] or "") and board in (r["chip"] or "") and r["url"] == "",
          f"scanned board link /?at={board}: 'You are at Ramkund Ghat · From board {board}' (link removed from the address)")

    r = run(chrome, """
      setInput(document.querySelector('.place-search'), 'kala');
      await sleep(400);
      const cards = [...document.querySelectorAll('.dest')].map((d) => d.innerText);
      return { first: cards[0] || '', n: cards.length };
    """)
    check(r and "Kalaram Mandir" in r["first"] and "Closed" in r["first"],
          f"search 'kala' finds Kalaram Mandir first, with its 'Closed' badge ({r and r['n']} results)")
    r = run(chrome, """
      [...document.querySelectorAll('.dest')][0].click(); await sleep(3500);
      return [...document.querySelectorAll('.guide-gps.warn')].map((p) => p.textContent).join(' | ');
    """)
    check(r and "reported closed" in r, f"the guide warns that the destination is reported closed ({(r or '')[:90]})")

    # A lane on the route is closed while the visitor is being guided (Phase 8): the phone's next
    # data check (every 3 min while guiding; here the reconnect check) reroutes and says so.
    pack_file = os.path.join(tempfile.mkdtemp(prefix="setu-route-"), "pack.json")
    with open(pack_file, "w") as f:
        json.dump(api("/api/pack/latest/json"), f)
    codes = json.loads(subprocess.run(["npx", "--yes", "tsx", "scripts/routeCodes.ts", pack_file, ramkund, kalaram],
                                      cwd=FRONTEND, capture_output=True, text=True, check=True).stdout.strip().splitlines()[-1])
    shutil.rmtree(os.path.dirname(pack_file), ignore_errors=True)
    mid = len(codes) // 2
    lane = {"from_code": codes[mid - 1], "to_code": codes[mid]} if len(codes) >= 2 else None
    if lane:
        api("/api/volunteer/edge-status", {**lane, "blocked": True, "hours": 1}, token)
    r = run(chrome, """
      const togo = () => [...document.querySelectorAll('p, span, div')].map((e) => e.textContent).find((x) => /m to go/.test(x || '') && x.length < 60) || '';
      const before = togo();
      if ([...document.querySelectorAll('.guide-gps.warn')].some((p) => p.textContent.includes('Route updated'))) return { early: true };
      window.dispatchEvent(new Event('online'));
      const msg = await waitFor(() => [...document.querySelectorAll('.guide-gps.warn')].map((p) => p.textContent).find((x) => x.includes('Route updated')), 8000);
      return { before, after: togo(), msg: msg || '' };
    """)
    check(lane and r and not r.get("early") and "Route updated" in r["msg"] and r["before"] != r["after"],
          f"lane {lane and lane['from_code']}–{lane and lane['to_code']} closed during guidance → rerouted on the next data check, "
          f"'Route updated' shown only then ({r and r.get('before')} → {r and r.get('after')}; early={r and r.get('early')})")
    if lane:
        api("/api/volunteer/edge-status", {**lane, "blocked": False}, token)

    chrome.goto(APP + "/", settle_s=2.5)
    r = run(chrome, f"""
      await click('I am a visitor', 1000);
      await click('Find my way', 1500);
      const input = document.querySelector('#board-code');
      setInput(input, 'zzzzz'); input.closest('form').requestSubmit(); await sleep(500);
      const unknown = document.querySelector('.board-entry .gps-status.err')?.textContent || '';
      setInput(input, '{board.lower()}'); input.closest('form').requestSubmit(); await sleep(1200);
      return {{ unknown, chip: document.querySelector('.start-chip')?.innerText || '' }};
    """)
    check(r and "not in the data on your phone" in r["unknown"] and "Ramkund Ghat" in r["chip"],
          "typed board code: unknown code explained; the real code (lower case) finds Ramkund Ghat")
    # The same board link with no internet: answered from the data saved on the phone.
    servers.stop()
    chrome.offline(True)
    chrome.goto(APP + f"/?at={board}", settle_s=4)
    r = run(chrome, "return await waitFor(() => document.querySelector('.start-chip')?.innerText) || '';")
    check(r and "Ramkund Ghat" in r, "scanned board link in airplane mode: found in the saved data")
    chrome.offline(False)
    check(servers.start(), "servers back up")
    api("/api/admin/place-status", {"code": kalaram, "status": "unknown"}, token)
    chrome.goto(APP + "/", settle_s=2.5)

    # 6. SOS (Phase 6): saved as pending with no network, sent once back, acknowledged by an operator.
    servers.stop()
    chrome.offline(True)
    chrome.goto(APP + "/", settle_s=3)
    r = run(chrome, """
      await click('I am a visitor', 1000);
      await click('Need help?', 1500);
      await click('Medical help', 300);
      setInput(document.querySelector('.sos-note textarea'), 'smoke test: dizzy near the steps');
      await click('Send alert', 2000);
      return document.querySelector('.sos-item')?.innerText || '';
    """)
    check(r and "Not sent yet" in r, f"SOS with no network: shown as NOT SENT YET (saved on the phone) ({(r or '')[:70]!r})")
    chrome.offline(False)
    check(servers.start(), "servers back up")
    r = run(chrome, """
      window.dispatchEvent(new Event('online'));
      return await waitFor(() => /Received by the Setu server/.test(document.querySelector('.sos-item')?.innerText || '') && document.querySelector('.sos-item').innerText, 30000) || document.querySelector('.sos-item')?.innerText;
    """, timeout_s=45)
    check(r and "Received by the Setu server" in r and "confirmed" not in r,
          "back online: SENT (received by the server), not yet confirmed")

    # 7. Volunteer: a place and its walk saved with no network, sent once back online.
    chrome.goto(APP + "/", settle_s=2.5)
    r = run(chrome, f"""
      await click('I am a volunteer', 1000);
      setInput(document.querySelector('input[type="tel"]'), '{phone}');
      setInput(document.querySelector('input[inputmode="numeric"]'), '{pin}');
      document.querySelector('input[inputmode="numeric"]').closest('form').requestSubmit();
      return !!(await waitFor(() => document.querySelector('.volunteer-who')));
    """)
    check(r, "volunteer sign-in works")

    # Operator screen: acknowledge the visitor's alert with a message.
    r = run(chrome, """
      await click('SOS alerts', 2500);
      const card = await waitFor(() => [...document.querySelectorAll('.sos-op')].find((c) => c.innerText.includes('dizzy near the steps')));
      if (!card) return 'no alert card';
      setInput(card.querySelector('input'), 'A volunteer is coming to the steps');
      [...card.querySelectorAll('button')].find((b) => b.textContent.includes('Acknowledge')).click();
      await sleep(1500);
      const again = [...document.querySelectorAll('.sos-op')].find((c) => c.innerText.includes('dizzy near the steps'));
      return again?.innerText || '';
    """)
    check(r and "Acknowledged" in r and "A volunteer is coming to the steps" in r,
          "operator screen: the alert is listed with its note; acknowledged with a message")
    run(chrome, "await back(); return true;")
    # A 'someone is lost' alert becomes a case; the case goes through review to reunited and closed.
    lost_id = api("/api/sos", {"client_id": secrets.token_hex(12), "kind": "lost", "note": "smoke: boy, blue shirt, near Kalaram",
                                "device": "smoke-device-lost"})["id"]
    r = run(chrome, f"""
      await click('SOS alerts', 2500);
      const card = await waitFor(() => [...document.querySelectorAll('.sos-op')].find((c) => c.innerText.startsWith('#{lost_id}')));
      if (!card) return 'no lost alert';
      [...card.querySelectorAll('button')].find((b) => b.textContent.includes('Open lost-person case')).click();
      await sleep(1500);
      const form = document.querySelector('.case-form');
      setInput(form.querySelector('.report-helper textarea'), 'my son, 8 years, blue shirt and black shorts, last seen near Kalaram Mandir at 3 pm, speaks Marathi');
      await click('Suggest fields', 400);
      const sugg = form.querySelector('.report-helper')?.innerText || '';
      await click('Use ticked suggestions', 400);
      const filled = [...form.querySelectorAll('textarea')].find((t) => !t.closest('.report-helper'))?.value || '';
      window.__helper = {{ sugg, filled }};
      setInput([...form.querySelectorAll('textarea')].find((t) => !t.closest('.report-helper')), 'Boy about 8, blue shirt, black shorts');
      const age = [...form.querySelectorAll('label')].find((l) => l.textContent.startsWith('Age')).querySelector('input');
      setInput(age, '8');
      await click('Open case', 2000);
      const head = document.querySelector('.volunteer-head h2')?.textContent || '';
      await click('Under review', 1500);
      setInput(document.querySelector('.report-card input'), 'found at help desk 2, mother confirmed');
      await click('Reunited', 1500);
      setInput(document.querySelector('.report-card input'), 'family left together');
      await click('Closed', 1500);
      const hist = document.querySelector('.admin-audit')?.innerText || '';
      return {{ head, after: document.querySelector('.volunteer-head h2')?.textContent || '', hist, helper: window.__helper }};
    """, timeout_s=60)
    check(r and isinstance(r, dict) and r["head"].startswith("LP-") and "New" in r["head"] and "Closed" in r["after"]
          and "Under review → Reunited" in r["hist"] and "Reunited → Closed" in r["hist"],
          f"lost-person case from a 'lost' SOS: opened (New), reviewed, reunited, closed, all in its history ({r and r.get('head') if isinstance(r, dict) else r})")
    h = (r or {}).get("helper") if isinstance(r, dict) else None
    check(h and "Age about 8" in h["sugg"] and "Last seen at Kalaram Mandir" in h["sugg"] and h["filled"] == "Wearing blue shirt, black shorts",
          "report helper: a pasted report becomes suggested fields; the operator applies them")
    run(chrome, "await back(); await back(); return true;")
    r = run(chrome, "return [...document.querySelectorAll('.ops-tile')].map((t) => t.innerText.replace(/\\n/g, ' ')).join(' | ');")
    check(r and "SOS not acknowledged" in r and "Open lost-person cases" in r, f"operations summary tiles on the volunteer home ({(r or '')[:100]})")

    # The visitor's phone now shows the operator's confirmation.
    chrome.goto(APP + "/", settle_s=2.5)
    r = run(chrome, """
      await click('I am a visitor', 1000);
      await click('Need help?', 1500);
      window.dispatchEvent(new Event('online'));
      return await waitFor(() => /An operator confirmed/.test(document.querySelector('.sos-item')?.innerText || '') && document.querySelector('.sos-item').innerText, 30000) || document.querySelector('.sos-item')?.innerText;
    """, timeout_s=45)
    check(r and "An operator confirmed" in r and "A volunteer is coming to the steps" in r,
          "the visitor's phone shows ACKNOWLEDGED with the operator's message")
    chrome.goto(APP + "/?mode=volunteer", settle_s=2.5)
    r = run(chrome, "return !!(await waitFor(() => document.querySelector('.volunteer-who')));")
    chrome.offline(True)
    r = run(chrome, """
      await click('Register a mela place', 2500);
      const form = document.querySelector('.volunteer-form');
      const inputs = [...form.querySelectorAll('input:not([type]), input[type="text"]')];
      setInput(inputs[0], 'Smoke Test Place'); setInput(inputs[1], 'स्मोक टेस्ट');
      const start = [...form.querySelectorAll('select')].find((s) => s.closest('label')?.textContent.includes('Starting point'));
      setInput(start, [...start.options].find((o) => o.text.includes('Ramkund Ghat')).value);
      await sleep(400);
      await click('Start recording walk', 800);
      return true;
    """, timeout_s=60)
    # Walk about 40 m east: the phone's GPS moves, as on a real walk.
    for i in range(1, 8):
        chrome.gps(RAMKUND[0], RAMKUND[1] + i * 0.00006, accuracy=6)
        time.sleep(1.1)
    r = run(chrome, """
      await click('Stop recording', 2500);
      await click('Save destination', 2500);
      return document.querySelector('.volunteer-card')?.innerText || ('form: ' + (document.querySelector('.gps-status.err')?.textContent || document.querySelector('.volunteer-form')?.innerText.slice(0, 300)));
    """, timeout_s=60)
    check(r and "Saved on this phone" in r, f"offline: the new place and its walk are kept on the phone ({(r or '')[:120]!r})")
    chrome.offline(False)
    r = run(chrome, """
      await click('Back', 800);
      window.dispatchEvent(new Event('online'));
      const gone = await waitFor(() => !document.querySelector('.outbox'), 20000);
      return !!gone;
    """)
    check(r, "back online: the waiting changes are sent and the list empties")
    con = sqlite3.connect(db_path)
    n = con.execute("select count(*) from qr_nodes where name='Smoke Test Place'").fetchone()[0]
    walks = con.execute(
        "select count(*) from edges e join qr_nodes n on n.code=e.to_code where n.name='Smoke Test Place'"
    ).fetchone()[0]
    con.close()
    check(n == 1 and walks == 1, f"the server has the place once and its walk once (places {n}, walks {walks})")


if __name__ == "__main__":
    sys.exit(main())
