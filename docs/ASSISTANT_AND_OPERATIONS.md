# Assistant, report helper and operations (Phase 7)

## Decision: no external AI service (yet)

Sending visitors' questions or reporters' descriptions to an outside AI
company would move personal data off the phone and the server, with a cost.
That needs the owner's explicit decision and a privacy review. Until then:

- **"Ask Setu"** (7a) is **rule-based and works offline**, answering only from the published data saved on the phone.
- **The report helper** (7b) is **rule-based** and runs in the operator's browser.

Both are built so that an AI model, if approved later, could be added
**behind** them. The rule-based answer stays the fallback, and the model may
only rephrase or extract, never add places, statuses or routes.

## 7a: Ask Setu (visitors)

Home → **Ask Setu**: type a question, or tap a quick question (Medical help, Toilet, Drinking water, Help desk, Lost someone, Safety tips).

**Emergencies come first.** If the question suggests someone is in danger, such as "my father fell and is bleeding", "बेहोश हो गए", "आग लगी", "मुलगा बुडतोय" or "stampede":
- the answer is **"This sounds like an emergency"**, with **Call 112**, **Call 108** and **Send SOS** (which opens the SOS screen with the visitor's words as the note);
- then the nearest medical help, help desks and police (never a place reported closed).

Short words must match a whole word (आगे "ahead" is not आग "fire"). The screen always shows "Emergency? Call 112 · Send SOS", whatever the question.

| Asked | Answer |
|---|---|
| "Nearest hospital", "सबसे पास अस्पताल", "जवळचा दवाखाना" | The 3 nearest places of that kind **in the saved data**, with distance, opening status (only while valid) and how each was checked; "Show the way" opens the normal route |
| "Is Kalaram Mandir open?" (also in Marathi or Hindi) | That place's status, with its expiry; after the expiry, "Status not confirmed recently" |
| "Safety tips" | A fixed list of **general tips**, labelled "not official instructions" (version `2026-10-30`) |
| A kind of place the data doesn't have | "There is no place for toilets in the saved data. Ask at a help desk." |
| Anything else | "I can only answer from Setu's saved data: … For anything else, ask at a help desk." |

**Rules:**
- **No invention:** only places in the published pack. A place reported closed is listed last. If none is checked on site, it says so ("this is map data").
- **No routes from the assistant:** "Show the way" hands the place to the normal router.
- **Freshness:** "From Setu data saved 30 Oct, 14:05".
- **No position, no distance:** without GPS or a chosen start, no distance is claimed.
- **Offline**, in English, Hindi and Marathi. Topic words are matched in all three.

## 7b: report helper (operators)

In **Lost persons → New case** (and when editing), **What the reporter said**:
1. paste or type the report;
2. **Suggest fields** lists suggestions, each with the words it came from ("Age about 8 (from '8 years')");
3. the operator ticks the ones to use and taps **Use ticked suggestions**, then reviews and opens the case.

- **What it can suggest:**
  - age;
  - gender: **only** from an explicit word (son, mother, मुलगा, आई…), and not when words for both appear;
  - clothing as colour plus item ("Wearing blue shirt, black shorts");
  - a last-seen place: only one **in the saved data**;
  - a time **as words** ("Last seen around 3 pm", never turned into a date);
  - languages;
  - a name: only after "name is", "नाम", "नाव";
  - the reporter's phone.
- **Still to ask:** a list of missing details (clothing, age, place, time, languages, phone).
- **Limits on its power:** it never saves anything, changes a status, or decides identity.

## 7c: operations

**Operations summary** on the volunteer home (operators and admins; counts only, refreshed every 30 s):
- SOS not acknowledged / being handled, with the median time to acknowledge over 24 h, and alerts marked as a possible flood;
- open lost-person cases (when cases are enabled);
- facilities closed now, and facility statuses that have expired;
- visitor reports to check, closed lanes, QR boards.

Tiles open the matching screen (SOS alerts, Lost persons, Report a blocked lane, Admin map). The endpoint `GET /api/ops/summary` returns counts only, never notes, names or locations.

The other operational tools from earlier phases:
- facility status, access and QR boards (admin map place card);
- data checks, the audit log, publish and rollback (admin map);
- closures (blocked lanes, visitor reports);
- the SOS console and the cases screen (Phase 6).

## Tests

- **T33 (16), assistant:**
  - nearest first, a closed place last; only places from the data, with check status;
  - Hindi and Marathi questions;
  - "is X open" with its expiry, and a lapsed status never answered "open";
  - a place named in Marathi;
  - a kind of place not in the data → says so; unknown questions → "unknown";
  - safety tips from the fixed list; no distance without a position; "lost" → Lost & Found / help / police only;
  - **emergencies** in English, Hindi and Marathi come first; "stampede" / "भगदड़" is an emergency (not tips); "injured" is an emergency; आगे isn't आग; emergency help never lists a closed place.
- **T34 (8), report helper:**
  - English, Marathi and Hindi reports;
  - a vague report → nothing invented, all questions listed;
  - words for both genders → no gender; a place not in the data → not found; a time is never turned into a date.
- **API:** the operations summary is operator-only, with counts only.
- **Browser smoke test:**
  - Ask Setu **in airplane mode** (nearest medical help, a Hindi question, an honest "cannot answer");
  - an emergency ("my father fell and is bleeding") showing Call 112 / Send SOS, where Send SOS opens the alert with those words;
  - the report helper filling a real case form;
  - the operations tiles.

## Limits

- The assistant understands set topics and place names, not free conversation. That is deliberate, until an AI service is approved.
- The safety tips are general advice, not the Mela authority's instructions. Replace them with official text when it is available.
- The report helper and operator screens are English-only (for trained staff).
