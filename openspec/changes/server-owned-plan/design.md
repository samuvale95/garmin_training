## Context

`user_plan` (in `training_plan/db.py`) holds one row per user: `yaml_text`, `sessions` (a JSONB array of `TrainingSession`-shaped dicts, stored opaque: "nothing server-side reads into a session's structure"), `filename`, `imported_at`, `goal`. The web app (`web/src/lib/queries.ts`) is the authority:

- `writePlan` updates the TanStack cache and the localStorage mirror, then `PUT /plan` with the whole plan;
- `useUpdateSession(index, …)`, `useAddSession`, `useRemoveSession(index)` all rewrite the whole list;
- screens are routed by list index (`session/[id]`, `workout/[id]`, `workout/[id]/edit`, the strava comparison pages), so deleting session 3 silently renumbers every later URL.

Everything that reads the plan server-side receives it in the request body (`/plan/goal-fit`, `/plan/diff`, `/coach/execution`), never from the database.

`parser.parse_plan_document` turns YAML into `ParsedPlan` (sessions + goal); there is no serializer the other way.

## Goals / Non-Goals

**Goals:**
- Sessions addressable by a stable id, on the server and in URLs.
- Origin and lock recorded per session, and the "manual edits always win" rule enforced on the server, where a future AI writer cannot bypass it.
- No whole-plan rewrites for single edits, so two writers cannot clobber each other.
- Existing plans carried over with nothing lost.

**Non-Goals:**
- Generating or adapting sessions (next phase-2 changes).
- The plan skeleton (phases, weekly targets) — it belongs to the generation change, where its shape is decided by what the generator needs.
- Warnings on moves (phase 1, §0.5). The per-session update endpoint is where they will hook in.
- Changing how endpoints that take the plan in their body work (`/plan/diff`, `/plan/goal-fit`, `/coach/execution`). They keep receiving sessions from the client; moving them to read from the database is a later simplification.
- Offline editing beyond what exists today (optimistic update, best-effort request).
- An "unlock" UI. The API supports it; the screen comes with the AI plan, when there is something that would change an unlocked session.

## Decisions

### 1. A `plan_session` table

```sql
CREATE TABLE IF NOT EXISTS plan_session (
    user_id      TEXT NOT NULL,
    id           UUID NOT NULL DEFAULT gen_random_uuid(),
    date         DATE NOT NULL,
    position     INTEGER NOT NULL DEFAULT 0,   -- order within the day
    sport        TEXT NOT NULL,
    title        TEXT NOT NULL,
    description  TEXT,
    steps        JSONB NOT NULL,
    origin       TEXT NOT NULL,                 -- import | manual | ai
    locked       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS plan_session_day_idx ON plan_session (user_id, date, position);
```

`steps` stays JSON: nothing server-side queries into steps, and `models.TrainingSession` already round-trips them. `user_plan` keeps the plan-level facts (`goal`, `filename`, `imported_at`, `yaml_text` of the last import).

### 2. Lock and origin rules live in the storage layer, not in the routes

*Implemented in its own module, `training_plan/plan_store.py`, rather than in `db.py`: the session rules are a unit of their own, and `db.py` keeps only the plan-level facts (`save_plan`, `ensure_plan`, `delete_plan`).*

- `create_session(user_id, session, *, origin)` — `manual` sessions are created locked. The client may pass the id (a UUID it generated) so it can navigate to the new session before the request returns.
- `update_session(user_id, id, changes, *, by_user)` — `by_user=True` sets `locked = TRUE`; `by_user=False` on a locked session raises `SessionLocked`.
- `delete_session(user_id, id, *, by_user)` — same rule.
- `replace_unlocked(user_id, start, end, sessions, *, origin="ai") -> ReplaceResult` — in one transaction: delete unlocked sessions in `[start, end]`, insert the proposed ones except those whose (date, sport) matches a locked session, return `written` and `conflicts`.

The routes only ever call these with `by_user=True`. Putting the rule in the storage layer means the AI writer (next change) cannot forget it.

*Alternative considered*: a `version` column with optimistic concurrency on every session. Per-session writes already remove the clobbering the spec cares about; a version check would add retry handling to every screen for a race that only matters within a single session. Can be added if it shows up.

### 3. API

- `GET /plan` → plan-level fields + `sessions` ordered by `(date, position)`, each with `id`, `origin`, `locked`.
- `POST /plan/sessions` → create (`manual`, locked); returns the session.
- `PATCH /plan/sessions/{id}` → partial update (date, content, `locked: false` to unlock); user writes lock.
- `DELETE /plan/sessions/{id}`.
- `PUT /plan` → **import only**: replaces all sessions with the given ones (`import`, unlocked) and sets the plan-level fields. Kept at the same path so the import screen's call does not move.
- `GET /plan/export` → YAML (`text/yaml`) with `Content-Disposition` for download.

### 4. YAML export mirrors the importer

A `serialize_plan(sessions, goal) -> str` next to `parse_plan_document`, writing the same keys the importer reads (paces back to `m:ss`). Its test is the round trip: `parse(serialize(x)) == x` over the fixtures the parser tests already use.

### 5. Migration in `db.ensure_schema`

`user_plan` gains `sessions_migrated BOOLEAN NOT NULL DEFAULT FALSE`. At startup, for every row with `sessions_migrated = FALSE`: insert one `plan_session` per element of `sessions` (`jsonb_array_elements … WITH ORDINALITY`, ordinality as `position`), origin `import`, unlocked; set `sessions_migrated = TRUE`. One transaction per user, so a crash halfway leaves that user unmigrated rather than half-migrated. The flag makes it run once.

After this change, `user_plan.sessions` is no longer written (left in place, emptied later, so a rollback of the code still finds data).

### 6. Web: ids everywhere, writes per session

- `TrainingSession` gains `id?`, `origin?`, `locked?` (optional: parsed-but-not-imported sessions and prescriptions have no id yet).
- `useUpdateSession(id, updater)`, `useRemoveSession(id)`, `useAddSession(session)` call the new endpoints with an optimistic cache update and roll back on failure. `useSetPlan` stays for import only.
- Routes take the id: `session/[id]`, `workout/[id]`, `workout/[id]/edit`, `…/strava`. Lookups become `sessions.find(s => s.id === id)`. Old index URLs (bookmarks) fall back: a numeric param resolves by index once and redirects to the id.
- `restorePersistedPlanOnce`'s "push the local plan up" path uses the import endpoint, and only when the server has no plan.

## Risks / Trade-offs

- **Many screens route by index** → the change touches every one of them. The fallback from numeric params keeps old links working; a test per route resolves a known session by id.
- **Migration on a live table** → per-user transactions and a flag; verified in a rolled-back throwaway schema against real rows before deploy, like the history migration.
- **Clients still running the old web code after deploy** would `PUT /plan` with the whole list and, under the new meaning, re-import it (unlocking everything and dropping ids). Mitigation: `PUT /plan` accepts an `import: true` marker from the new client; without it, the server treats the request as legacy and only updates plan-level fields, ignoring the sessions. The PWA refreshes within one load.
- **Locks accumulate**: after months of use most sessions may be locked, leaving the AI little to adapt. That is the rule the user asked for; the unlock path exists for when the AI plan UI needs it.
