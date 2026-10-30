# Volunteer workflow

Volunteers are signed-in phones (phone number + 6-digit PIN, one shift per
sign-in). They put real places and walked lanes into the data, and report
blocked lanes. **Everything a volunteer adds is labelled with how it was
checked** (see trust levels in `NASHIK_GEO_DATA_PIPELINE.md`).

## What a volunteer does

| Task | Screen | What is saved | Trust level |
|---|---|---|---|
| Register a place (standing at it) | Register a mela place | Name, local name, kind, GPS position (the app asks for ±30 m or better; the server refuses worse than ±50 m) | `volunteer_verified` (from live GPS) |
| Confirm a map place ("This is …") | Register → nearby map place | The OpenStreetMap place gets the volunteer's GPS position | `volunteer_verified` (never downgrades `officially_verified`) |
| Walk a lane | Register → Starting point → Start recording → walk → Stop | The GPS track (≥2 points) and walking headings | `volunteer_verified`. A lane an admin **rejected** stays rejected: the walk is saved for review |
| Fix walk direction | Fix walk direction | The compass heading along a lane | unchanged |
| Report a blocked lane | Report a blocked lane | Blocked / door closed / glass wall, note, hours | unchanged (blocked lanes leave visitors' routes) |

## Working without internet

Mela networks are often overloaded, so volunteer changes never need a live
connection:

1. **The screens work offline.** Places and lanes come from the copy saved on the phone when the server can't be reached; the form says so.
2. **Changes wait on the phone.** If a change can't be sent (no connection, timeout, server down, sign-in expired), it is saved in IndexedDB (`setu-outbox`), and the screen says: "Saved on this phone — it will be sent when there is internet."
3. **They are sent automatically, in order:**
   - when the app opens, after signing in, when the phone comes back online, and every 30 s while any are waiting;
   - the volunteer home shows "N changes waiting to send", with **Send now**.
   - Only temporary answers keep a change waiting: no connection, a server error (5xx), sign-in expired (the sign-in sheet opens, even during an automatic send), or "still being saved" (409 with `Retry-After`). Any other refusal, including a one-way lane's 409, is shown and the rest of the queue carries on.
4. **A walk waits for its place.** A new place registered offline has no code yet, so the walk is sent right after it, with the code the server gave filled in.
5. **Never saved twice.** Each change carries an `Idempotency-Key` made on the phone. If the connection drops after the server saved a change, the resend gets the stored answer instead of a second copy (`backend/app/idempotency.py`). Keys are tied to the volunteer, so nobody can replay someone else's change.
6. **Never silently lost.** A change the server refuses (rough GPS, unknown place, walking a one-way lane backwards) stays listed with the server's reason until the volunteer taps **Dismiss**. It is not resent forever. A walk whose place was refused is marked "Not sent".
7. **Another volunteer's changes** on a shared phone wait until that volunteer signs in again.
8. **A waiting change can be cancelled** with two taps (Cancel → "Tap again to cancel it"), for example a block report that is no longer true.

**Limits:**
- Sign-in itself needs the internet once per shift.
- A block report sent late takes effect when it arrives; its hours count from then.
- Registering offline relies on the phone's saved copy to show the nearby map places.

## Languages

The volunteer screens are in **English, Hindi and Marathi**, following the language picker on the volunteer home (the same setting as the visitor screens).
- **What's covered:** sign-in, home, register, the walk recording steps, walk direction, blocked lanes, visitor reports, and the "waiting to send" list. Lane lists show the place's Devanagari name in Hindi and Marathi.
- **How it's written:**
  - Texts live in `src/i18n/vol-en.ts`, `vol-hi.ts` and `vol-mr.ts` (205 texts).
  - The style is simple spoken Hindi and conversational Marathi, keeping the common tech words people already use: GPS, PIN, सेव / सेव्ह, साइन इन.
  - `tsc` forces every key to exist in all three. The tests check that placeholders match, that each text is really translated, that Marathi has no Hindi words, and that digits are Latin.
- **Saved changes keep their language-neutral parts:** a change waiting on the phone stores a text key and values, so the list shows it in whatever language is chosen now.
- **Still in English:**
  - messages written by the server (for example "GPS is only accurate to ±40 m…", or a PIN lock), shown as the server sent them;
  - the compass and sensor status notes;
  - the admin map.
- **Needs native review:** the Hindi and Marathi texts must be read by native speakers (ideally volunteers, not language experts) before the field pilot.

## Testing from outside Nashik

`?sim=1` on a development build gives the volunteer screens simulated GPS (`NASHIK_SIMULATION_MODE.md`). Simulated data is always saved as `unverified`, with a note, and the production server refuses it.

## Tests (2026-10-30)

- **API (SQLite and Postgres):**
  - the same Idempotency-Key twice → saved once, with the same answer (`Idempotent-Replay: true`);
  - another volunteer's key → 422; a malformed key → 400; a refused change keeps its answer; no sign-in → 401;
  - simulated register / walk → `unverified`; production refuses simulated positions;
  - a walk on a rejected lane keeps it rejected.
- **T30:** all 205 volunteer texts are translated in Hindi and Marathi (Devanagari present, nothing left in English except "PIN"); queued-change labels render in the chosen language. T25 covers placeholders, no Hindi in Marathi, Latin digits.
- **Chrome (Marathi and Hindi, 375 px wide):** home, register, blocked lane and walk direction screens fit without overflow; the waiting list showed "रास्ता रामकुंड → कालाराम मंदिर … नहीं भेजा: “टेस्ट घाट दर्ज करें” पर सर्वर ने मना किया".
- **T29 (14 checks):**
  - kept offline; nothing lost while still offline;
  - another volunteer's sign-in doesn't send them;
  - back online, the place and walk are sent and the refused block stays listed with its reason;
  - the keys are sent in order; refused changes are not resent; dismiss works;
  - a refused place marks its walk not sent;
  - an online refusal is shown at once; 5xx → kept;
  - a one-way-lane 409 is refused (online at once; in the queue, the next change is still sent); a 409 with `Retry-After` waits.
- **Chrome, DB copy:** the backend stopped → register with a simulated 414 m walk → both kept and listed; the backend restarted → both sent once, in order (KUMBH-A01), saved as `unverified` with the simulation note.

## Still to do

- Volunteer trust levels on the place lists (shown on the admin map today).
