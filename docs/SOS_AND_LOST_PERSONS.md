# SOS alerts and lost-person cases (Phase 6)

Two pilgrim-safety features:
- **SOS alerts:** a visitor's "I need help" reaches Setu operators, even if it was made without a connection.
- **Lost-person cases:** authorized operators record and follow a case to "Reunited" or "Closed".

**Setu does not contact the police, fire service or an ambulance.** The app
says so on the SOS screen and offers **112** (emergency) and **108**
(ambulance) as phone calls. Linking to real emergency services needs approval
and testing first, and isn't done.

## Decisions taken (owner's blanket approval, 2026-10-30)

| Question | Chosen |
|---|---|
| SOS channel | **The Setu server only**, received by a new **operator** role (operators and admins). No SMS, radio or Bluetooth (they need approval and real tests) |
| Who handles cases | Operators and admins (`manage_volunteers.py add … --role operator`) |
| Case data | The minimum: description, approximate age, name/gender/languages if known, last seen (place, note, time), reporter name and phone |
| Retention | Open SOS alerts close as **expired after 48 h**; resolved/expired alerts are deleted after **7 days**; closed cases (with their history) after **30 days** (`SOS_RETENTION_DAYS`, `CASE_RETENTION_DAYS`) |
| Live use of cases | **Off in production** until an authority approves (`CASES_ENABLED=1`); on in development |

## SOS alerts

**Visitor:**
1. Home → **Need help?** → choose the help needed (medical, someone is lost, unsafe crowd, other), optionally add a short note, then **Send alert**.
2. The GPS position is sent if usable; otherwise "near <the place you chose>"; otherwise nothing ("say in the note where you are").
3. The alert is **saved on the phone first** and sent in the background, also after leaving the screen: at start, on reconnect, and every 20 s.

**Truthful states (shown on the phone):**

| State | Shown when | Text |
|---|---|---|
| Pending | Saved on the phone; the server hasn't confirmed receipt (no connection, server error, busy) | "Not sent yet — saved on this phone. It will be sent as soon as there is a connection." |
| Sent | The server answered 201/200 with an alert id | "Received by the Setu server at 14:05. Waiting for an operator to confirm." |
| Acknowledged | The server says an operator acknowledged it | "An operator confirmed at 14:07." plus the operator's message |
| Resolved | An operator resolved it | "Marked resolved by an operator." |
| Expired | Open for 48 h without anyone resolving it (the server closes it) | "Closed after 48 hours without an operator's confirmation. If you still need help, call 112 or send a new alert." |
| Refused | The server rejected it (e.g. invalid) | "Could not be sent: <reason>" |

**Rules:**
- A rate limit (429) keeps the alert *pending*, with the reason; it never claims "sent".
- **Never a duplicate:** each alert carries a random id made on the phone. Sending again returns the same alert.
- The same random id is the phone's only key to its alert's status; other people's alerts can't be read.
- **Limits:** 5 new alerts per phone per hour. Resends don't count.
- **No refusal by network address:** at the mela thousands of phones share a few mobile-carrier addresses, so an SOS is **never refused because of other people**.
  - Past 60 alerts an hour from one address, alerts are still accepted, but **marked as a possible flood**.
  - The operator screen lists them after the others, with a note to still check them.

**Operator** (volunteer area → **SOS alerts**, operators and admins):
- Open alerts, newest first (possible-flood ones last), refreshing every 10 s. **A new alert vibrates and plays a short tone**, and the tab title shows the number not yet acknowledged. Each shows its type, age, note, and location, with the nearest known place for context.
- **Acknowledge**, with a message the visitor sees (presets such as "A volunteer is coming to you"). Acknowledge only when someone is acting on it.
- **Resolve.**
- **Open lost-person case** from a "someone is lost" alert.
- The audit log records "SOS #12 (medical) acknowledged": never the note or location.

## Lost-person cases

**Operators and admins only** (volunteer area → **Lost persons**). There is no public case data and no case API for visitors.

- **Public side:** the SOS screen's **Lost someone?** section lists the nearest Lost & Found, help desks and police posts (with status) and "Show the way", plus the "Someone is lost" alert.
- **Case number:** `LP-` plus 5 characters without look-alikes.
- **Statuses:** NEW → UNDER_REVIEW → POSSIBLE_MATCH → ESCALATED → REUNITED → CLOSED.
  - Only the allowed changes are offered.
  - Escalated, Reunited and Closed need a note.
  - A case can't go back to NEW.
  - CLOSED is final for operators; an admin can reopen it.
- **History:** every change records who, when, from → to, and the note.
- **No two operators overwrite each other:** each case has a version, and a stale change gets "Someone else changed this case — reload it and try again" (409). The check is atomic in the database.
- **Children:** an age under 18 marks the case as a child, and the reporter's phone is **masked in lists** ("•••• 10"), shown only inside the case.
- **No automatic identity decisions:** only people change a status. The screen reminds operators to check identity in person before "Reunited". No photos, no face recognition.
- **The audit log** records only the case number and statuses ("Case LP-K7M4Q: UNDER_REVIEW → REUNITED"): no names, contacts or descriptions.
- **Retention:** closed cases and their history are deleted 30 days after closing (checked regularly and on every list).
- **Off in production** until approved. The server answers 404 ("not enabled on this server"), and the operator screen says it needs the authority's approval.

## Tests

- **API** (SQLite and Postgres):
  - SOS (11 checks): stored once, then a resend gets the same alert; the phone sees only its state; unknown → 404; validation; operator-only (401/403); the operator sees the note and location; acknowledge, so the phone sees the message; resolve (then no second acknowledgement); 5 per phone per hour → 429; no note or location in the audit log; deleted 7 days after resolving.
  - Cases (13 checks): operator-only (401/403); case number, NEW, child flag; contact masked in lists; a note needed for Reunited; **a stale concurrent change → 409**; edits need the current version; no going back to NEW; reunited, then closed, with full history; final for operators, reopenable by an admin; audit without personal data; search; deleted 30 days after closing; off in production.
- **T32 (10):** pending offline; still pending on 5xx and on 429 (with reason); sent only with the server's id; never duplicated; not acknowledged until the server says so; refused with reason; kept across a restart; an offline refresh changes nothing.
- **Browser smoke test** (real headless Chrome, a copy of the database), Phase 6 part:
  - an alert sent with **every server stopped** shows *Not sent yet*; once servers are back it shows *Received by the Setu server*;
  - an operator acknowledges it **in the operator screen** with a message; the visitor's phone then shows *An operator confirmed* with that message;
  - a "someone is lost" alert becomes a case in the UI, goes New → Under review → Reunited → Closed, and every step is in its history.

## Limits and approvals needed

- **No real emergency services:** 112/108 are phone calls by the visitor. Any SMS, radio or Bluetooth channel needs approval and real tests.
- **The operator screens are English only.** Operators are trained staff; translating them is a later task.
- **Operators must have the screen open:** a new alert vibrates and beeps there (the browser may block sound until the operator has tapped the page once). There are no push notifications when the screen is closed yet.
- **Lost-person cases need an authority's approval** (who may operate, data rules, retention, children's data, legal basis under the DPDP Act) before `CASES_ENABLED=1` in production.
- **SOS alerts hold live locations.** The privacy notice must cover them before launch (`SECURITY_AND_PRIVACY.md`).
- Nothing has been tested on real phones or in the field.
