# Admin workflow

Admins are volunteers with the `admin` role (`scripts/manage_volunteers.py add … --role admin`). Everything below is on the **Admin map** (volunteer home → Admin map) and is admin-only on the server (`require_admin`; volunteers get 403).

## What the admin map shows

- **All places:** hollow until verified on site.
- **All lanes**, coloured by trust:
  - green = verified on site;
  - blue dashed = reviewed on maps;
  - grey dashed = imported / unverified;
  - red = blocked / closed / rejected.
- **Visitor reports:** "this lane is blocked".
- The map shows the **latest data**, including changes that are not yet published.

Tap a place or lane to:
- set its **trust level** with a note (reviewed on maps / officially verified / reject / back to imported / unverified), recorded with your name;
- reopen or close a lane, or mark it (not) walkable;
- see its **History** (who changed it, when, from → to).

## Data checks

**Check data** runs the same checks as `scripts/validate_graph.py` (about 1 s on the pilot data) and lists:

| Check | Level | What to do |
|---|---|---|
| Crosses a river or weir without a bridge | error | Already kept off phones. Approve it in `approved_crossings.json` only after checking it, or reject it |
| Recorded walk crossing water | warning | Check the walk is on a bridge |
| Possible duplicate places (same kind ≤15 m, or same name ≤150 m) | warning | Reject the wrong one |
| Places cut off from the main network | warning | Their lanes don't reach the main streets, so routes fail |
| Place links longer than 60 m | warning | Check the place's position |
| Places with no lane | info | Usually city-wide places outside the walking area |

Tap any item to open it on the map. On the pilot data today:
- 0 unsafe crossings;
- 9 possible duplicates (one is real: Kalaram Mandir / Sri Kala Rama Swamy Temple);
- 1 cut-off place;
- 44 places with no lane.

## Publishing (`PUBLISH_MODE`)

| Mode | What visitors' phones get |
|---|---|
| `manual` (**default in production**) | The **published version**, plus today's closures, reopenings and rejections applied on top |
| `auto` (default in development) | Every change at once (the behaviour before publishing existed) |

**Rule (manual mode):** anything that **takes a route away** reaches phones at once:
- a blocked lane, closed gate or "not walkable" mark;
- a confirmed visitor report;
- an admin's **reject**.

**Reopening** a lane is also immediate. **Everything else waits for Publish:**
- new places and walked lanes;
- confirmed map places;
- trust upgrades, and undoing a rejection;
- OSM imports.

So a safety closure never waits for an admin, and new data never reaches visitors unchecked.

**Data versions panel:**
- **What phones have:** the version, when it was published, by whom, and the note.
- **What is waiting:** places and lanes added (+), changed (~) and removed (−), with examples.
- **Closed lanes phones don't have yet:** shown as a warning. A lane that is new since the last publish isn't on phones, so its closure waits too.
- **Publish:** add a note, then tap twice.
- **Earlier versions:** "Put this version on phones" (tap twice) **rolls phones back** (or forward).
  - The database is not changed: the newer data stays, shown as waiting, so you can fix it and publish again.
  - Today's closures and rejections still apply to the older version.

**Other details:**
- Volunteers see "Saved — visitors will see it after an admin publishes it" when their place waits.
- Versions are stored in the database (`dataset_releases`), so they are in the backups.
- Publishing identical data doesn't change the phone pack, so nobody re-downloads.
- **First switch to manual:** today's data becomes version 1 automatically.
- **On a new server:** after the first import, check and publish:
  ```bash
  python scripts/validate_graph.py        # must end with OK
  python scripts/publish_data.py "First Nashik data"
  ```
  Until then, phones show "the server has no data yet".

## Audit log

Every data change is written to `audit_log`, in the same transaction as the change:
- volunteers registering or confirming places, walking lanes, setting walk directions, blocking or reopening lanes, confirming or rejecting visitor reports;
- admin trust changes ("osm_imported → remotely_reviewed — checked on imagery");
- added places and lanes, batch syncs;
- publish and roll back.

Each entry has the time, the person's **name** (never their phone number), the place or lane, and a sentence. Simulated changes say "simulated".

- **Recent changes:** the latest 50 on the admin map; tap one to open it.
- **History:** on a place or lane card.
- **API:** `GET /api/admin/audit?limit=&target=place:CODE|lane:ID`.

OSM imports run from the command line and are summarised by their own report. Publishing is logged.

## Tests (2026-10-30)

- **API (SQLite and Postgres):**
  - graph report (admin only);
  - audit entries for volunteer and admin changes, from → to, simulated marked, names not phone numbers, filter by target, admin only;
  - publishing (13 checks): refused in auto mode; first version made automatically; a new place waits and the volunteer is told; the waiting summary; a closure, a reopening and a rejection are live at once; publish puts the place on phones; admin-only; rollback takes it off phones but keeps it in the database; closures still apply after a rollback; unknown version → 404; both logged.
- **Chrome** (DB copy, test admin, `PUBLISH_MODE=manual`):
  - Check data matched `validate_graph.py`; tapping a duplicate opened the place;
  - a trust change appeared in the place's History and in Recent changes;
  - the change showed as waiting, and phones were unchanged; Publish (two taps) → version 2, and phones got the change;
  - rolled back to version 1 → phones had the old value, and the change showed as waiting again.

## Limits

- **Removed lanes:** a lane removed from the database after a publish (e.g. by a street re-import) stays on phones until the next publish. Closures of lanes that are new since the last publish wait for the next publish (the panel warns).
- **No two-person approval:** any admin can publish.
- The admin map is **English only**.
