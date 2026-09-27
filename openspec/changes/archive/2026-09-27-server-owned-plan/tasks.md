## 1. Storage (`plan_store.py`, plan-level fields in `db.py`)

- [x] 1.1 Add the `plan_session` table and index, and `user_plan.sessions_migrated`, to the schema.
- [x] 1.2 Implement the one-time migration of `user_plan.sessions` into `plan_session` (origin `import`, unlocked, ordinality as position), one transaction per user, guarded by the flag.
- [x] 1.3 Implement `list_sessions`, `create_session`, `update_session`, `delete_session` with the lock rules of design.md decision #2 (`SessionLocked`, not-found).
- [x] 1.4 Implement `replace_unlocked(user_id, start, end, sessions, *, origin)` returning written sessions and conflicts.
- [x] 1.5 Implement `import_plan` (replace every session with `import`, unlocked, plus plan-level fields).
- [x] 1.6 Verify migration (twice, no duplicates), lock rules and `replace_unlocked` against the real Postgres in a rolled-back throwaway schema.

## 2. YAML export

- [x] 2.1 Add `serialize_plan(sessions, goal)` next to `parse_plan_document`.
- [x] 2.2 Round-trip test over the existing parser fixtures.

## 3. API

- [x] 3.1 Schemas: session out with `id`, `origin`, `locked`; create / patch requests.
- [x] 3.2 `GET /plan` from `plan_session`; `PUT /plan` as import (with the `import: true` marker, legacy requests only update plan-level fields).
- [x] 3.3 `POST /plan/sessions`, `PATCH /plan/sessions/{id}`, `DELETE /plan/sessions/{id}`.
- [x] 3.4 `GET /plan/export`.
- [x] 3.5 Route tests with `db` faked: create locks, user patch locks, unlock, not-found, legacy `PUT /plan` ignores sessions, import replaces.

## 4. Web

- [x] 4.1 Types: `id`, `origin`, `locked` on `TrainingSession`.
- [x] 4.2 Rewrite `useAddSession`, `useUpdateSession`, `useRemoveSession` onto the per-session endpoints with optimistic update and rollback; keep `useSetPlan` for import, sending `import: true`.
- [x] 4.3 Move `session/[id]`, `workout/[id]`, `workout/[id]/edit` and the strava pages from index to id, with the numeric-param fallback redirect.
- [x] 4.4 Update the week view, `SessionDetailBody`, `DetailScaffold`, `WorkoutEditor`, `PrescriptionCard` and `body/stato` to pass ids.
- [x] 4.5 Add "Esporta YAML" to the plan section of settings. *(already there: "Scarica il YAML" builds the file client-side from the plan; no second button. `GET /plan/export` stays for API and AI use.)*

## 5. Verify

- [x] 5.1 Run the migration against the real account in a rolled-back schema copy and compare sessions before and after. *(the production database holds no saved plan -- the real account trains off the Garmin calendar -- so the dry run on the real tables, in a rolled-back transaction, had nothing to move. The migration with data was verified on a throwaway schema in 1.6: three sessions, run twice, no duplicates.)*
- [x] 5.2 Run `uv run pytest` and `npx tsc --noEmit` in `web/`. *(534 passed; the same 22 pre-existing failures, none in plan code -- the test_api one is a sync-job status test. tsc clean.)*
