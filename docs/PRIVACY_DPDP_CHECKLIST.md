# Privacy and DPDP review checklist (Phase 8)

A checklist for the **Digital Personal Data Protection Act, 2023** and its
rules, prepared by the developer for the owner and a lawyer to work through.
**It is not legal advice and not a statement that Setu complies.** Each line
says what the software does today and what still needs a human decision.

Status: ✅ done in the software · 🟡 partly done / needs wording · ❌ not done (owner, authority or lawyer)

## 1. Roles and accountability

| Item | Status | Today |
|---|---|---|
| Who is the **data fiduciary** (decides why and how data is used)? | ❌ | Not decided. Probably the Mela authority, with the developer as **data processor**. A written agreement between them is needed |
| A contact for privacy questions and requests (grievance officer) | ❌ | None. Must be named in the app and in the privacy notice |
| A record of what personal data is held, why, and for how long | ✅ | `SECURITY_AND_PRIVACY.md`, "What data is kept" |

## 2. Notice and consent

| Who | Data | Status | Today / needed |
|---|---|---|---|
| **Visitors** (no account) | Nothing personal for navigation: position stays on the phone | ✅ | Nothing to consent to for navigation |
| Visitors sending an **SOS** | Kind, short note, position (if they allow it), nearest place, pseudonymous phone id | 🟡 | The SOS screen says what is sent ("Your location will be sent (GPS ±8 m)") and who receives it. A short notice and a lawyer's view on consent at a moment of emergency (the Act allows some processing for medical emergencies and disasters without consent) are needed |
| Visitors sending a **lane report** | The lane and a pseudonymous phone id | ✅ | No position, no name |
| **Volunteers and operators** | Name, phone number, GPS walks with timestamps, the changes they make | 🟡 | Accounts are made by an admin. Written **consent wording for volunteers** (especially GPS walks) is needed before the pilot |
| **Lost-person cases** (reporters and missing people, **possibly children**) | Minimal description, approximate age, last-seen place and time, reporter contact | ❌ | **Off in production** (`CASES_ENABLED`) until the authority approves the process, the notice and the handling of children's data (the Act needs verifiable parental consent for children, with exceptions; a lawyer must say which apply) |
| A privacy notice in English, Hindi and Marathi | ❌ | Not written. Short, linked from the home screen and the SOS screen |

## 3. Purpose and data minimisation

| Item | Status | Today |
|---|---|---|
| Navigation without collecting positions | ✅ | Routing, guidance and "Ask Setu" run on the phone; no position in any request or URL |
| SOS: only what helps responders | ✅ | Kind, note (≤ 280 chars), position, nearest place, language. No name or phone number asked |
| Cases: minimal fields | ✅ | No photos, no ID numbers, no addresses; **no facial recognition or biometrics** |
| The public data pack has no personal data | ✅ | Walk times, notes and volunteer details removed; checked by tests |
| No analytics, advertising, crash reporting or third-party fonts/maps | ✅ | The production CSP allows this site only, and the browser test confirms nothing is blocked |
| No external AI service | ✅ | The assistant and report helper are rule-based and run locally (`ASSISTANT_AND_OPERATIONS.md`) |

## 4. Retention and deletion

| Data | Status | Kept |
|---|---|---|
| SOS alerts | ✅ | Expire after 48 h unacknowledged; **deleted 7 days** after resolved/expired |
| Lost-person cases and their history | ✅ | **Deleted 30 days after closing** |
| Visitor lane reports | ✅ | Deleted 30 days after settling |
| Failed sign-ins | ✅ | 1 day |
| Sign-in tokens | ✅ | 7 days after expiry |
| Volunteer accounts and GPS walks | 🟡 | While the account exists. **A rule is needed** for after the Mela (e.g. delete accounts 90 days after the event; keep walked lanes without the volunteer link) |
| Audit log (staff names, what changed) | 🟡 | Permanent. Decide a period with the authority |
| Backups | ❌ | `deploy/backup.sh` keeps dumps; **deleted data stays in backups until they rotate**. Set and state a backup retention period |
| Data on phones | ✅ | Pending SOS alerts and volunteer changes stay until sent; signing out removes the token |

## 5. Rights of the people concerned

| Right | Status | How, today |
|---|---|---|
| Access / correction / erasure for **volunteers** | 🟡 | An admin can edit or disable an account (`manage_volunteers.py`); no self-service. A written procedure is needed |
| Requests about an **SOS** or a **case** | ❌ | No procedure. The visitor has no account, so identifying their record needs care (SOS ids are on their phone) |
| Withdrawing consent (volunteers) | 🟡 | Disable the account; decide what happens to their walked lanes |
| Nominating someone else (DPDP) | ❌ | Procedure needed |

## 6. Security safeguards

| Item | Status | Today |
|---|---|---|
| Encryption in transit | ✅ | HTTPS only, HSTS (Caddy) |
| Encryption at rest | ❌ | Depends on the server and disk (not chosen). Backups should be encrypted |
| Access control by role | ✅ | Volunteer / operator / admin, checked on every endpoint |
| Sign-in protection | ✅ | scrypt PIN hashes, per-account lock-out, per-network limit, 16 h tokens |
| Audit trail | ✅ | Who changed what, without personal details of visitors or cases |
| Professional security assessment | ❌ | **Not done.** Recommended before the public launch |

## 7. Breach readiness

| Item | Status | Needed |
|---|---|---|
| Who decides a breach has happened, and who tells the Data Protection Board and the people affected | ❌ | Named people and a contact list (`LAUNCH_READINESS.md`, incident response) |
| Logs to investigate | 🟡 | The API access log (container logs) and the audit log. Decide how long access logs are kept |
| Revoking access fast | ✅ | Disabling a volunteer revokes all their tokens at once |

## 8. Before the pilot / before the public launch

**Before the field pilot (volunteers only):**
1. Volunteer consent wording (GPS walks) and a privacy contact.
2. Data fiduciary / processor agreement in draft.
3. Volunteer data rule for after the event.

**Before the public launch:**
1. Privacy notice in three languages, linked from home and SOS.
2. A lawyer's review of this checklist, especially SOS consent and children's data.
3. Authority approval before `CASES_ENABLED=1`.
4. Backup retention and encryption decided.
5. A rights-request and breach procedure with named people.
6. A professional security assessment.
