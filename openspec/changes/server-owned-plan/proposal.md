## Why

Phase 2 puts the plan in the hands of an AI that generates and adapts it, with the user free to move and edit any session and manual edits always winning (`BRAINSTORM-miglioramenti-e-gamification.md` §0.4, §0.5). The plan already lives on the server (`user_plan`), but as an opaque blob the client owns: every change rewrites the whole plan with `PUT /plan`, sessions are identified by their position in a list, and nothing records who made a session or whether the user touched it. With a second writer on the server, the client's next full rewrite would silently undo whatever the AI just did, and the AI would have no way to know which sessions it must leave alone.

This change makes the server the owner of the plan's structure. It generates nothing and adapts nothing: it is the ground the AI changes stand on.

## What Changes

- Sessions become rows with a stable id, stored individually instead of inside one JSON blob.
- Each session records its **origin** (`import`, `manual`, `ai`) and whether it is **locked**. A session the user creates, edits or moves is locked; the server refuses to let a non-user writer change or delete a locked session.
- Per-session API: create, update (including moving to another day), delete. The client stops rewriting the whole plan on every edit.
- **BREAKING (API)**: `PUT /plan` keeps only its import meaning (replace the plan from a YAML file); session edits go through the new endpoints. Session URLs in the web app use the session id instead of the list index.
- The YAML file becomes import and export: `GET /plan/export` returns the current plan as YAML, including sessions added or edited in the app.
- Existing plans migrate once: every session in `user_plan.sessions` becomes a row with origin `import`, unlocked.
- A server-side writer for non-user changes (`replace_unlocked`) that the AI changes will use: it replaces unlocked sessions in a date range and leaves locked ones untouched, and reports any conflict it skipped.

## Capabilities

### New Capabilities
- `plan-ownership`: how the plan's sessions are identified and stored, who may change what (origin and lock rules), the per-session API, YAML import/export, and the migration of existing plans.

### Modified Capabilities
<!-- None: openspec/specs/ has no archived capabilities yet. -->

## Impact

- **Code**: `training_plan/db.py` (new `plan_session` table, migration, writers), `training_plan/api/routes_plan.py` and `schemas.py` (per-session endpoints, export), `training_plan/parser.py` (YAML export next to the existing import), the web plan layer in `web/src/lib/queries.ts` (id-based writes), and every screen routed by session index (`session/[id]`, `workout/[id]`, the editor, the week view).
- **Database**: one new table and a one-time copy out of `user_plan.sessions`. The `sessions` column stays until the change is verified, then stops being written.
- **Garmin sync**: unchanged in behaviour. The diff and sync read session content; ids only travel alongside.
- **Other features**: `/coach/plan` prescriptions already add sessions through `useAddSession`; they become `manual` sessions when the user taps "aggiungi".
