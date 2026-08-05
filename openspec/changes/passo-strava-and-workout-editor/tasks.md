## 1. Backend setup

- [x] 1.1 Promote `httpx` from `[project.optional-dependencies].dev` to `[project].dependencies` in `pyproject.toml` (design.md decision #2).
- [x] 1.2 Add `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` / `STRAVA_REDIRECT_URI` / `STRAVA_TOKENSTORE` env vars, documented the same way `GARMIN_TOKENSTORE` is today (README/`.env.example` if one exists).
- [x] 1.3 Register a real Strava API application (manual, outside the codebase) to obtain client id/secret for local testing — note in the change's README/PR description, not committed. *(user already has an app registered and is adding credentials to `.env` themselves)*

## 2. Strava OAuth backend (`strava-integration-api`)

- [x] 2.1 Create `training_plan/strava_sync.py`: `StravaSync` class with a local JSON tokenstore (mirrors `GarminSync`'s tokenstore shape — design.md decision #1), `authorize_url()`, `exchange_code(code)`, `connection_status()`, `disconnect()`, and a private `_ensure_fresh_token()` that refreshes via Strava's token endpoint when expired.
- [x] 2.2 Implement Strava API calls in `strava_sync.py` using `httpx`: list recent activities (paginated by date range), fetch one activity's detail (heart rate, elevation, description), fetch gear by id.
- [x] 2.3 Add `training_plan/api/schemas.py` request/response models: `StravaStatusResponse`, `StravaAuthorizeResponse`, `StravaConnectRequest`/`ConnectResponse` (code exchange), `StravaActivityMatchResponse`, `ShoeOut`, `ShoesResponse`, `RetireShoeRequest`.
- [x] 2.4 Add `training_plan/api/routes_strava.py`: `GET /strava/authorize`, `POST /strava/connect` (code exchange), `GET /strava/status`, `POST /strava/disconnect`, `POST /strava/activity-match`, `GET /strava/shoes`, `POST /strava/shoes/{gear_id}/retire`. Follow `routes_garmin.py`'s `run_in_threadpool` + thin-adapter pattern. *(activity-match implemented as POST taking the full planned session, not GET ?date=&sport=, so the backend can derive planned distance/pace/duration for the closest-duration tie-break and the plan-note heuristic — see design note in strava_sync.py)*
- [x] 2.5 Register `strava_router` in `training_plan/api/app.py`, alongside a `StravaAuthError`-style exception handler (mirroring the existing `GarminSyncError`/`GarminRateLimitError` handlers) mapped to the same `ErrorResponse` shape.
- [x] 2.6 Implement activity-to-session matching (design.md decision #3): given `date` + `sport`, return the single best match by closest duration when more than one activity exists that day, or no-match.
- [x] 2.7 Implement shoe wear computation (design.md decision #4): 700 km threshold percentage and time-to-exhaustion estimate from Strava's own per-gear `distance` plus recent weekly usage; local `retired_gear_ids` flag stored alongside the Strava tokenstore.

## 3. Backend single-session Garmin write path

- [x] 3.1 Confirm/extend `service.py` or `jobs.py` so a single create (`to_create=[session]`) or single replace (`changed=[ChangedSession(...)]` with placeholder hashes, per design.md decision #5) can be started through the existing `job_store.start(...)` without a full plan diff. *(confirmed: `job_store.start()` already accepts arbitrary-length `to_create`/`changed` lists, including a single item — no change needed)*
- [x] 3.2 Add a `training_plan/api/routes_plan.py` (or `routes_garmin.py`) endpoint for a single-session save if the existing `/plan/sync` payload shape doesn't already cover a one-item `to_create`/`changed` list cleanly — otherwise document that the existing endpoint is reused as-is. *(reused as-is: `POST /plan/sync` with a one-item list is exactly what 10b's frontend calls; `ChangedSessionIn.to_model()` already hardcodes placeholder `local_hash`/`remote_hash`, confirming design.md decision #5 needed no schema change)*
- [x] 3.3 Add a single-session delete path (edit-mode trash icon) — reuse `service.apply_deletion`/`GarminSync.delete_workout` against the one scheduled workout being edited. *(reused as-is: `POST /garmin/deletions/apply` with a one-workout list)*

## 4. Backend tests

- [x] 4.1 `tests/test_strava_sync.py`: token exchange, refresh-on-expiry, disconnect clears tokenstore, activity matching (single match / multiple matches picks closest duration / no match), shoe wear percentage and exhaustion estimate, retire flag persists and excludes from active calculations.
- [x] 4.2 `tests/test_api_strava.py`: each `routes_strava.py` endpoint (success + auth-required + not-connected paths), following `tests/test_api.py`'s `client`/`fake_garmin`-style fixture pattern (add a `fake_strava` fixture).
- [x] 4.3 Extend `tests/test_api.py` or add a focused test for the single-session create/replace/delete write path added in section 3.

## 5. Frontend: types and data hooks

- [x] 5.1 Add to `web/src/lib/types.ts` (hand-mirrored from the new schemas, per existing convention): `StravaStatus`, `StravaActivityMatch`, `Shoe`.
- [x] 5.2 Add to `web/src/lib/queries.ts`: `useStravaStatus`, `useStravaAuthorize`/`useConnectStrava`, `useDisconnectStrava`, `useStravaActivityMatch(date, sport)`, `useShoes`, `useRetireShoe`, following the existing `useGarminStatus`/`useConnectGarmin` pairing and `staleTime` conventions (design.md's rate-limit mitigation — 5 min `staleTime` for activities/shoes). *(`useStravaActivityMatch` takes the full session, not just date/sport, matching the POST activity-match endpoint)*
- [x] 5.3 Add `addSession` action to `web/src/lib/store.ts`'s `PassoStore` (design.md decision #7), alongside the existing `updateSession`. *(also added `removeSession`, needed for 10b's delete action)*

## 6. Frontend: screen 10b (`workout-editor`)

- [x] 6.1 Create `web/src/app/session/[id]/edit/page.tsx` (edit mode) and `web/src/app/week/new/page.tsx` (create mode) — or a single route taking an optional id, matching whichever convention reads more consistently with existing routes; precompose fields from `plan.sessions[index]` in edit mode, empty in create mode. *(both are thin wrappers around a shared `WorkoutEditor` component to avoid duplicating the form; fixed post-review: the component originally called `useRequirePlan()` unconditionally, which redirected create mode to `/import` whenever no plan existed yet — defeating the point of creating one from scratch. Now only edit mode requires an existing plan/session.)*
- [x] 6.2 Build the activity-type chip group (single-select, Corsa/Bici/Forza/Nuoto/Riposo) reusing existing icon/color-per-sport mapping already used elsewhere (e.g. week screen's per-type card treatment). *(pragmatic call: "Riposo" has no dedicated sport in the file format, stored as `sport: "other"`, noted in code)*
- [x] 6.3 Build the inline-editable title field and notes textarea.
- [x] 6.4 Build the reorderable step list with `framer-motion`'s `Reorder.Group`/`Reorder.Item` (design.md decision #6), drag handle, and "+ step" append action.
- [x] 6.5 Build the per-step editor (duration, target pace/power, recovery) as a modal/sheet opened by each row's pencil icon.
- [x] 6.6 Wire "Salva sul calendario": update local plan state (`updateSession`/`addSession`), start the Garmin write job (section 3), poll it inline behind a spinner on the button (no navigation to screen 06 — design.md decision #5), then navigate back to the origin screen; surface job failure inline instead of navigating away.
- [x] 6.7 Wire "×" and "Annulla" to discard in-progress form state and return to the origin screen with no plan/calendar changes.
- [x] 6.8 Wire the header trash icon (edit mode only) with a confirm step, then delete from both plan and Garmin (section 3.3) and navigate to `/week`.

## 7. Frontend: screen 16 Collega Strava

- [x] 7.1 Create `web/src/app/connect-strava/page.tsx`, styled consistently with `web/src/app/connect-garmin/page.tsx`, explaining the read-only connection.
- [x] 7.2 Wire "Autorizza Strava" to the real OAuth flow (redirect to `authorize_url()`, handle the callback/exchange, likely via a `/strava/callback` route that completes `useConnectStrava` and redirects to `/settings`). *(callback route is `web/src/app/connect-strava/callback/page.tsx`, matching the `STRAVA_REDIRECT_URI` documented in README.md)*
- [x] 7.3 Wire "Non ora" to return to `/settings` unchanged.

## 8. Frontend: screen 17 Svolto vs pianificato

- [x] 8.1 Create `web/src/app/session/[id]/strava/page.tsx`, dark-theme variant per the reference screenshot, using `useStravaActivityMatch`. *(matches the existing `/session/[id]` page's own dark theme, so no new visual system needed)*
- [x] 8.2 Render planned-vs-actual distance/pace, heart rate, elevation, felt-effort note, and the "cosa cambia nel piano" callout (design.md open question — implement a simple rule-based comparison of planned vs. actual pace/HR for the first pass). *(the heuristic and its text live server-side in `strava_sync._plan_note`, matching how `body_insights.py` generates other human-readable messages — see design.md decision left as an open question, resolved this way during implementation)*
- [x] 8.3 Add the "Scarpe" row (chevron) linking to screen 18, and "Torna alla sessione" linking back to screen 10.

## 9. Frontend: screen 18 Usura scarpe

- [x] 9.1 Create `web/src/app/shoes/page.tsx` using `useShoes`, with a wear bar per shoe (`BarGrow` primitive) against the 700 km threshold and the exhaustion estimate text.
- [x] 9.2 Wire "Segna [scarpa] come ritirata" to `useRetireShoe`, with the shoe remaining listed but visually marked archived after retirement.
- [x] 9.3 Wire the back arrow to return to whichever screen opened it (17 or 15) — pass origin via route state/query param, consistent with how other screens track their originating screen. *(a `?from=` query param, defaulting to `/settings`; screen 17 links in with its own path)*

## 10. Frontend: existing-screen entry points

- [x] 10.1 `web/src/app/settings/page.tsx`: add a "Strava" row (status from `useStravaStatus`, opens `/connect-strava` or a disconnect action) and a "Scarpe" row (opens `/shoes`).
- [x] 10.2 `web/src/app/session/[id]/page.tsx`: add a header pencil icon (opens 10b edit mode) and the conditional "Svolta ieri, da Strava" card (opens `/session/[id]/strava`) shown only when Strava is connected and `useStravaActivityMatch` returns a match.
- [x] 10.3 `web/src/app/(tabs)/week/page.tsx`: add a "+" icon opening 10b create mode.
- [x] 10.4 (not in the original plan, discovered mid-conversation) Fixed a pre-existing gap: no screen linked to `/settings` at all — `web/src/app/(tabs)/today/page.tsx`'s header `Avatar` is now wrapped in a `Link` to `/settings`, since otherwise none of this section's new Strava/Scarpe rows would be reachable in the running app.

## 11. Verification

- [x] 11.1 Run backend test suite (`pytest`) and confirm new Strava/single-session-write tests pass alongside existing suites. *(140/140 passing; fixed post-review: `training_plan/api/app.py` never called `load_dotenv()` — only `cli.py` did — so a plain `uvicorn training_plan.api:app` never saw GARMIN_*/STRAVA_* from a local `.env` at all, unless the shell happened to export them separately. Added the call to `app.py`; that in turn required hardening `test_authorize_url_requires_credentials` with explicit `monkeypatch.delenv` since importing `app.py` from any test module now loads the developer's real `.env` process-wide for the whole pytest session.)*
- [x] 11.2 Run frontend lint/typecheck (`npm run lint`, `tsc`) for the new routes and store/query additions. *(clean; also ran a full `next build` production build, which additionally caught two missing `<Suspense>` boundaries around `useSearchParams` — fixed)*
- [ ] 11.3 Manually walk the golden path in a browser per this repo's UI-change convention: connect Strava, create a session via "+", edit it via the pencil, confirm it lands on the Garmin calendar, view a matched "Svolta ieri, da Strava" comparison, and retire a shoe. *(needs real STRAVA_CLIENT_ID/SECRET in .env and a real Garmin write — user is testing this manually)*
