## Context

The backend (`training_plan/`) is a presentation-independent service layer (`service.py`) plus one real external integration today: Garmin, via `garmin_sync.py` wrapping the `garminconnect` library. Garmin auth is a local-file tokenstore (`GARMIN_TOKENSTORE`, default `~/.garmin_training_tokens`), re-used across requests by re-instantiating `GarminSync()` and calling `.login()`, which is a no-op network call when a cached token is still valid. There is no database and no user-account system anywhere in the stack (`training_plan/api/app.py` registers three routers — plan, garmin, body — all backed by `service.py`/`garmin_sync.py`/`body_insights.py`, all synchronous and run via `run_in_threadpool`).

Sessions in the app have no stable server-side id: the frontend addresses a session by its index in the imported plan's session array (`plan.sessions[index]`, see `web/src/app/session/[id]/page.tsx`), and the diff engine matches plan sessions to Garmin calendar entries by `(date, sport)` (`garmin_sync.py`'s `diff_plan`). Any new correlation this change needs — a Strava activity to a planned session, a shoe to an activity — must fit that same "no stable id, match by date+sport" shape rather than inventing a new id system.

The one async-job pattern that exists is `training_plan/api/jobs.py`'s in-memory `SyncJobStore`: starts a background thread, runs Garmin writes one item at a time, is polled by the client, and is lost on process restart (an accepted trade-off already documented for that job). `service.apply_plan_sync`/`GarminSync.create_and_schedule`/`GarminSync.replace_session` are the write primitives it drives.

Frontend state is split (per the parent `passo-nextjs-web-app` design): TanStack Query for anything that comes from the backend, and a persisted Zustand store (`web/src/lib/store.ts`) for on-device-only state (prefs, profile display fields, job history) — never Garmin tokens, which stay server-side. `framer-motion` is already a dependency and ships a `Reorder` primitive usable for 10b's drag-reorderable step list with no new package.

## Goals / Non-Goals

**Goals:**
- A real Strava OAuth (authorization-code) integration: connect, disconnect, and a status read, with the token held server-side only — same trust boundary as Garmin.
- Read-only Strava activity fetching, matched to a planned session by `(date, sport)`, surfaced as screen 17's comparison.
- Shoe wear derived from Strava's gear API (`distance` is already tracked per gear by Strava itself — no local mileage accumulation needed), with a "mark as retired" action that's a local exclusion flag, not a Strava write.
- Screen 10b: create or edit a single session, with the save action performing a real Garmin write via the existing `SyncJobStore`, not a Strava write.
- Screens 16, 18, and the new entry points on 09/10/15.

**Non-Goals:**
- No writes to Strava of any kind (screen 16's own copy commits to "sola lettura" — read-only). No creating/editing Strava activities, no gear management beyond reading it.
- No Strava webhooks/real-time push subscriptions — activity and gear data are fetched on demand when a relevant screen opens, consistent with how Garmin data is fetched on demand rather than synced continuously.
- No historical backfill job — screen 17 only ever looks at the activity for one specific day; screen 18's shoe list is whatever Strava's gear endpoint currently reports, not a locally-reconstructed history.
- No multi-athlete or multi-account support (single Strava athlete, single Garmin account, same as today).
- No conflict resolution for concurrent edits to the same session from two clients — this is a single-user local tool; last write wins, same assumption the rest of the app already makes.

## Decisions

### 1. Strava token storage mirrors Garmin's: a local file, not a database
A second local JSON file (e.g. `STRAVA_TOKENSTORE`, default `~/.garmin_training_strava_tokens`) holds `{access_token, refresh_token, expires_at, athlete_id}`. A `StravaSync` class (new `training_plan/strava_sync.py`) reads/writes it and refreshes the access token in-place when expired, mirroring `GarminSync`'s constructor/tokenstore shape closely enough that `routes_strava.py` reads like `routes_garmin.py`.
**Alternative considered**: reuse `garmin_sync.py`'s tokenstore file for both — rejected, two unrelated credential sets in one file is a needless coupling and complicates disconnect-one-without-the-other.

### 2. A thin custom Strava HTTP client, not a third-party Strava SDK
`StravaSync` calls Strava's REST API (`www.strava.com/oauth/token`, `www.strava.com/api/v3/athlete/activities`, `.../gear/{id}`) directly with `httpx`, promoted from `dev`-only to a main dependency (it's already trusted enough to be in the dev group for FastAPI's `TestClient`, and is a maintained, sync-capable client — no need to add `requests` as a second HTTP library, and no need for a full SDK like `stravalib` for the ~4 endpoints this uses).
**Alternative considered**: `stravalib` — rejected as heavier than needed and one more dependency to track for a small, stable surface (OAuth token exchange + two read endpoints).

### 3. Activity matching is `(date, sport)` against the plan, same as the Garmin diff
Screen 17's "Svolta ieri, da Strava" card needs to know if *this* session has a matching Strava activity. Rather than inventing a session id, the backend endpoint takes the session's date and sport and returns the best-matching Strava activity for that day (or none), using the same matching shape `diff_plan` already uses for Garmin. This keeps the "no stable session id" property consistent app-wide instead of introducing one just for Strava.

### 4. Shoe wear reads Strava's own gear totals; the app does not re-derive mileage
Strava's `/athlete` and `/gear/{id}` responses already include a running `distance` total per shoe (accumulated by Strava from all logged activities, not just ones this app knows about). The 700 km threshold and "estimated weeks to exhaustion" (from recent per-week pace) are computed by the backend from that single number plus recent activity distances — there is no need to sum activities locally, which would double-count or drift from what the athlete sees in Strava itself.
"Mark as retired" is a local flag (kept in the same tokenstore-adjacent local file, e.g. a small `retired_gear_ids` list) — Strava has no "retire" concept via the public API's write scope this app requests (read-only `activity:read_all,profile:read_all` scope only), so retirement is app-local state layered on top of Strava's read-only gear list.

### 5. Screen 10b's save reuses `SyncJobStore`, addressed as a single-item job, no new job type
Create mode calls `job_store.start(to_create=[session], changed=[])`; edit mode (an existing scheduled workout) calls it with `changed=[ChangedSession(session=edited, workout=existing, local_hash="", remote_hash="")]` — `replace_session` never reads `local_hash`/`remote_hash` (confirmed in `garmin_sync.py`; they're diff-display-only fields), so placeholder values are safe for a manually-triggered replace that didn't come from a diff. The screen does **not** navigate to screen 06 (that screen's "N of M" framing doesn't fit a single item and the design shows 10b resolving inline) — it polls the same job-status endpoint internally behind a spinner on the "Salva sul calendario" button and navigates back to the origin screen only once the job reaches `done`, surfacing the existing per-item error on failure instead of a full progress list.
**Alternative considered**: a dedicated single-session write endpoint bypassing the job store — rejected; it would duplicate `SyncJobStore`'s login/threadpool/error-mapping logic for no real benefit, since the existing polling `useSyncJobStatus` hook already does exactly what 10b needs.

### 6. The step reorder list uses `framer-motion`'s `Reorder.Group`/`Reorder.Item`
No new dependency; `Reorder` gives drag-to-reorder with the same spring/easing system already governing the rest of the app's motion, satisfying the drag-handle (`⠿`) requirement in the spec directly.

### 7. Session identity inside 10b itself stays the plan-array-index scheme
Edit mode is opened with the same `[id]` param the session detail route already uses (`plan.sessions[index]`); 10b reads and writes that index directly through `usePassoStore`'s existing `updateSession`, then separately triggers the Garmin write job described in Decision 5. Create mode appends a new session to the plan array via a new store action (`addSession`) and immediately opens a job for it. This keeps "the plan array is the source of truth for session content" (an existing invariant — see `store.ts`'s comment "il file resta la verità") intact; the Garmin write is a side effect of saving, not a separate source of truth.

## Risks / Trade-offs

- **[Risk]** Strava's rate limits (100 requests/15min, 1000/day per app) are shared across every screen that touches Strava (17, 18, plus 15's status row). → **Mitigation**: `staleTime`-based caching in TanStack Query (activities/gear fetched on-demand per screen visit, not polled), matching the existing `useActivities`/`useBodyToday` pattern (5-minute `staleTime`) rather than the Garmin-status screen's more frequent polling.
- **[Risk]** The local-file token store (Decision 1) means both Garmin and Strava sessions are lost on process restart or machine move, same as today's Garmin behavior — this is an accepted, pre-existing trade-off for a local single-user tool, not a new one introduced here.
- **[Risk]** `(date, sport)` matching (Decision 3) can mis-match or fail to match when a runner logs two runs on the same day, or logs an activity under a different sport than planned. → **Mitigation**: when more than one Strava activity matches, pick the one closest in duration to the planned session and surface only that one — screen 17 is explicitly framed around "yesterday's session," a single card, not a multi-activity picker, so a best-effort single match is consistent with the design.
- **[Trade-off]** Promoting `httpx` out of `dev` (Decision 2) is a small dependency-shape change to `pyproject.toml`; flagged here since `passo-nextjs-web-app`'s design explicitly called out "new dependency" as review-worthy for `fastapi`/`uvicorn`.
- **[Risk]** Screen 10b writing straight to Garmin (Decision 5) bypasses the diff/confirm screens (04/05) that exist specifically to make destructive replace-via-delete-then-recreate visible before it happens. → **Mitigation**: edit mode's save button and the delete (trash) action both get an explicit confirm step (already specified for delete; extended to save-when-editing in tasks), so the "delete-then-recreate is irreversible" property the rest of the app protects isn't silently skipped just because this entry point is new.

## Open Questions

- Exact Strava OAuth scope string and app registration (client id/secret) — needs a real Strava API application to be registered before this is testable end-to-end; tasks.md should surface this as a manual setup step, not something the code can do for itself.
- Whether the "cosa cambia nel piano" (what changes in the plan) box on screen 17 is backend-generated text (some rule/heuristic comparing planned vs. actual pace/HR) or a static template filled with numbers — left to tasks/implementation to decide with a simple rule-based first pass, since no ML/LLM-generation capability exists elsewhere in this stack.
