# QR boards, facility status and search (Phase 5)

Phase 5 lets a visitor confirm **where they are** from a board, see **whether a
facility is open** (only while that is confirmed), see **how each place was
checked**, and **search places by name**, all offline from the data saved on
the phone.

## Decisions taken (owner's blanket approval of 2026-10-30)

| Question | Chosen | Why |
|---|---|---|
| QR boards back? (They reverse the earlier "no camera" decision) | **Yes, as a link plus a typed code, with no camera inside the app** | Keeps "no camera in the app"; needs no scanner library; the typed code works offline on every phone |
| Who sets open / closed? | **Operators and admins** (admin map), each status with an **expiry** | Facility status changes during the day; an expiry stops stale "open" claims |
| Which access details? | **Step-free (yes / no / unknown), open to all / restricted, and a short note** (e.g. "women only, 6–22 h") | The minimum that helps pilgrims choose; more can be added |

Each can be changed later. Physical boards need the **authority's approval**
before they are installed. Nothing has been installed or field-tested.

## QR boards

- **One stable code per place.** An admin taps **Create board code** on the place card.
  - The code has **5 characters without look-alikes** (no 0/O, 1/I/L), e.g. `K7M4Q`.
  - Asking again gives the same code.
  - The database refuses two places with the same code.
- **The board** (Print board on the admin map) shows:
  - the place name;
  - a QR holding `https://<site>/?at=<code>`;
  - the code in large letters;
  - "Scan with your phone camera, or open Setu and type this code" in English, Hindi and Marathi.
  - The QR holds the **code, never coordinates**: if a place moves or is corrected, the board stays right.
- **Visitor, scanning:** the phone's own camera opens Setu at "You are at Ramkund Ghat · From board K7M4Q", ready to choose a destination. The link is then removed from the address bar.
- **Visitor, typing:** start screen → **Code on a Setu board**. Case, spaces and dashes are ignored.
- **Offline:** codes are looked up in the data saved on the phone.
- **Stale data:** when online, the app waits for the update check before saying a code is unknown, because a new board isn't in an older saved copy. When offline it answers at once.
- **Unknown code:** "Code K7M4Q is not in the data on your phone. Connect to the internet to update, or ask at a help desk."
- **Not a code:** "That is not a board code — board codes have 5 letters and numbers."
- **Wrong board / removed board:** **Retire** on the place card.
  - The code stops working everywhere after the next update, and it is **never given to another place** (a board may still hang there). Board history is checked in the audit log.
  - The place gets a new code if needed.
- **Rejected places** can't get a board. If a place is rejected later, its board becomes "unknown" on phones, never a wrong place.
- **Board codes are live**, like a facility status: creating or retiring a code reaches phones at once, even with manual publishing, so a board on the wrong place stops misleading people immediately.
  - Exception: a board on a place that is **new since the last publish** stays "unknown" on phones until that place is published.

**iOS caveat:**
- A Setu app added to the home screen keeps its storage separate from Safari.
- A scanned link opens in Safari, which may not have the saved data.
- On iPhones **the typed code is the reliable offline route**.
- On Android Chrome the link opens the installed app and works offline.

## Facility status

- **Open / Limited service / Closed**, valid for 2 h, 6 h, 12 h, 1 day or 3 days, with an optional note. Set by an **operator or admin** (`POST /api/admin/place-status`).
- **Live:** like a lane closure, a status reaches phones at once, even with manual publishing, and doesn't count as "waiting to publish".
- **Never stale:** after its expiry the app shows "Status not confirmed recently". With no status: "Opening status not confirmed". The phone checks the expiry itself, so this also holds offline.
- **Visitors see:**
  - "Closed · confirmed until 18:00" (plus the note) on the place;
  - a "Closed" or "Limited service" badge in lists;
  - in the guide, "Kalaram Mandir is reported closed — check before you go."
  - Routing is not blocked (the visitor may still need to go there).
- **Who set it** is kept on the server and in the audit log, never sent to phones.

## Trust and freshness shown to visitors

- **Each place shows how it was checked:**
  - "Checked on site 29 Oct";
  - "Officially confirmed 29 Oct";
  - "Reviewed on maps";
  - "From map data — not checked on site".
- **Only the day** is published, not the time, which would reveal when a volunteer was there.
- Places also carry their **source** (`osm`, `volunteer`, `admin`).
- Older places got their dates from their last save, and their source from their code.

## Access

Step-free and restricted badges on places, with the note on the place view.
Set by admins (`POST /api/admin/place-access`); published with the next
Publish.

## Search

The destination screen has **Search a place by name**:
- it matches the English name, the local (Devanagari) name and the category, in any case, with several words;
- names starting with the query come first;
- it works offline and with the area and category filters.

## Tests

- **API** (SQLite 167 checks, Postgres): 16 new.
  - Status: operator/admin only; live with manual publishing and not "waiting"; who set it isn't public; validation.
  - Access: admin only.
  - Boards: stable code; no look-alikes; unique in the database; junctions and rejected places refused; retire, then a new code that is never reused.
  - Audit entries.
  - Only the day of a check is published.
- **T31 (12):** status expiry; trust never more than recorded; search (English, Devanagari, several words); board-code normalisation (look-alikes and lengths invalid); offline lookup; unknown vs invalid; junctions; rejected places.
- **Browser smoke test** (`backend/scripts/smoke_browser.py`, a copy of the database, real headless Chrome; 15 checks), Phase 5 part:
  - the scanned link `/?at=CODE` (online, when the saved copy predates the board, and **with every server stopped**);
  - typed code (unknown, then the real code in lower case);
  - search "kala" → Kalaram Mandir with its "Closed" badge;
  - the guide's closed warning.

## Limits

- Boards aren't installed or field-tested; the authority's approval is needed.
- On iOS, scanned links may open without the offline data (use the typed code).
- Status depends on operators keeping it current; the expiry makes a lapse visible, but can't fill it.
- The admin map is English only.
