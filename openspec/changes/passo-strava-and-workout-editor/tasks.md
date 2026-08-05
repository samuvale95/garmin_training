## 1. Backend setup

- [ ] 1.1 Promote `httpx` from `[project.optional-dependencies].dev` to `[project].dependencies` in `pyproject.toml` (design.md decision #2).
- [ ] 1.2 Add `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` / `STRAVA_REDIRECT_URI` / `STRAVA_TOKENSTORE` env vars, documented the same way `GARMIN_TOKENSTORE` is today (README/`.env.example` if one exists).
- [ ] 1.3 Register a real Strava API application (manual, outside the codebase) to obtain client id/secret for local testing — note in the change's README/PR description, not committed.

## 2. Strava OAuth backend (`strava-integration-api`)

- [ ] 2.1 Create `training_plan/strava_sync.py`: `StravaSync` class with a local JSON tokenstore (mirrors `GarminSync`'s tokenstore shape — design.md decision #1), `authorize_url()`, `exchange_code(code)`, `connection_status()`, `disconnect()`, and a private `_ensure_fresh_token()` that refreshes via Strava's token endpoint when expired.
- [ ] 2.2 Implement Strava API calls in `strava_sync.py` using `httpx`: list recent activities (paginated by date range), fetch one activity's detail (heart rate, elevation, description), fetch gear by id.
- [ ] 2.3 Add `training_plan/api/schemas.py` request/response models: `StravaStatusResponse`, `StravaAuthorizeResponse`, `StravaConnectRequest`/`ConnectResponse` (code exchange), `StravaActivityMatchResponse`, `ShoeOut`, `ShoesResponse`, `RetireShoeRequest`.
- [ ] 2.4 Add `training_plan/api/routes_strava.py`: `GET /strava/authorize`, `POST /strava/connect` (code exchange), `GET /strava/status`, `POST /strava/disconnect`, `GET /strava/activity-match?date=&sport=`, `GET /strava/shoes`, `POST /strava/shoes/{gear_id}/retire`. Follow `routes_garmin.py`'s `run_in_threadpool` + thin-adapter pattern.
- [ ] 2.5 Register `strava_router` in `training_plan/api/app.py`, alongside a `StravaAuthError`-style exception handler (mirroring the existing `GarminSyncError`/`GarminRateLimitError` handlers) mapped to the same `ErrorResponse` shape.
- [ ] 2.6 Implement activity-to-session matching (design.md decision #3): given `date` + `sport`, return the single best match by closest duration when more than one activity exists that day, or no-match.
- [ ] 2.7 Implement shoe wear computation (design.md decision #4): 700 km threshold percentage and time-to-exhaustion estimate from Strava's own per-gear `distance` plus recent weekly usage; local `retired_gear_ids` flag stored alongside the Strava tokenstore.

## 3. Backend single-session Garmin write path

- [ ] 3.1 Confirm/extend `service.py` or `jobs.py` so a single create (`to_create=[session]`) or single replace (`changed=[ChangedSession(...)]` with placeholder hashes, per design.md decision #5) can be started through the existing `job_store.start(...)` without a full plan diff.
- [ ] 3.2 Add a `training_plan/api/routes_plan.py` (or `routes_garmin.py`) endpoint for a single-session save if the existing `/plan/sync` payload shape doesn't already cover a one-item `to_create`/`changed` list cleanly — otherwise document that the existing endpoint is reused as-is.
- [ ] 3.3 Add a single-session delete path (edit-mode trash icon) — reuse `service.apply_deletion`/`GarminSync.delete_workout` against the one scheduled workout being edited.

## 4. Backend tests

- [ ] 4.1 `tests/test_strava_sync.py`: token exchange, refresh-on-expiry, disconnect clears tokenstore, activity matching (single match / multiple matches picks closest duration / no match), shoe wear percentage and exhaustion estimate, retire flag persists and excludes from active calculations.
- [ ] 4.2 `tests/test_api_strava.py`: each `routes_strava.py` endpoint (success + auth-required + not-connected paths), following `tests/test_api.py`'s `client`/`fake_garmin`-style fixture pattern (add a `fake_strava` fixture).
- [ ] 4.3 Extend `tests/test_api.py` or add a focused test for the single-session create/replace/delete write path added in section 3.

## 5. Frontend: types and data hooks

- [ ] 5.1 Add to `web/src/lib/types.ts` (hand-mirrored from the new schemas, per existing convention): `StravaStatus`, `StravaActivityMatch`, `Shoe`.
- [ ] 5.2 Add to `web/src/lib/queries.ts`: `useStravaStatus`, `useStravaAuthorize`/`useConnectStrava`, `useDisconnectStrava`, `useStravaActivityMatch(date, sport)`, `useShoes`, `useRetireShoe`, following the existing `useGarminStatus`/`useConnectGarmin` pairing and `staleTime` conventions (design.md's rate-limit mitigation — 5 min `staleTime` for activities/shoes).
- [ ] 5.3 Add `addSession` action to `web/src/lib/store.ts`'s `PassoStore` (design.md decision #7), alongside the existing `updateSession`.

## 6. Frontend: screen 10b (`workout-editor`)

- [ ] 6.1 Create `web/src/app/session/[id]/edit/page.tsx` (edit mode) and `web/src/app/week/new/page.tsx` (create mode) — or a single route taking an optional id, matching whichever convention reads more consistently with existing routes; precompose fields from `plan.sessions[index]` in edit mode, empty in create mode.
- [ ] 6.2 Build the activity-type chip group (single-select, Corsa/Bici/Forza/Nuoto/Riposo) reusing existing icon/color-per-sport mapping already used elsewhere (e.g. week screen's per-type card treatment).
- [ ] 6.3 Build the inline-editable title field and notes textarea.
- [ ] 6.4 Build the reorderable step list with `framer-motion`'s `Reorder.Group`/`Reorder.Item` (design.md decision #6), drag handle, and "+ step" append action.
- [ ] 6.5 Build the per-step editor (duration, target pace/power, recovery) as a modal/sheet opened by each row's pencil icon.
- [ ] 6.6 Wire "Salva sul calendario": update local plan state (`updateSession`/`addSession`), start the Garmin write job (section 3), poll it inline behind a spinner on the button (no navigation to screen 06 — design.md decision #5), then navigate back to the origin screen; surface job failure inline instead of navigating away.
- [ ] 6.7 Wire "×" and "Annulla" to discard in-progress form state and return to the origin screen with no plan/calendar changes.
- [ ] 6.8 Wire the header trash icon (edit mode only) with a confirm step, then delete from both plan and Garmin (section 3.3) and navigate to `/week`.

## 7. Frontend: screen 16 Collega Strava

- [ ] 7.1 Create `web/src/app/connect-strava/page.tsx`, styled consistently with `web/src/app/connect-garmin/page.tsx`, explaining the read-only connection.
- [ ] 7.2 Wire "Autorizza Strava" to the real OAuth flow (redirect to `authorize_url()`, handle the callback/exchange, likely via a `/strava/callback` route that completes `useConnectStrava` and redirects to `/settings`).
- [ ] 7.3 Wire "Non ora" to return to `/settings` unchanged.

## 8. Frontend: screen 17 Svolto vs pianificato

- [ ] 8.1 Create `web/src/app/session/[id]/strava/page.tsx`, dark-theme variant per the reference screenshot, using `useStravaActivityMatch`.
- [ ] 8.2 Render planned-vs-actual distance/pace, heart rate, elevation, felt-effort note, and the "cosa cambia nel piano" callout (design.md open question — implement a simple rule-based comparison of planned vs. actual pace/HR for the first pass).
- [ ] 8.3 Add the "Scarpe" row (chevron) linking to screen 18, and "Torna alla sessione" linking back to screen 10.

## 9. Frontend: screen 18 Usura scarpe

- [ ] 9.1 Create `web/src/app/shoes/page.tsx` using `useShoes`, with a wear bar per shoe (`BarGrow` primitive) against the 700 km threshold and the exhaustion estimate text.
- [ ] 9.2 Wire "Segna [scarpa] come ritirata" to `useRetireShoe`, with the shoe remaining listed but visually marked archived after retirement.
- [ ] 9.3 Wire the back arrow to return to whichever screen opened it (17 or 15) — pass origin via route state/query param, consistent with how other screens track their originating screen.

## 10. Frontend: existing-screen entry points

- [ ] 10.1 `web/src/app/settings/page.tsx`: add a "Strava" row (status from `useStravaStatus`, opens `/connect-strava` or a disconnect action) and a "Scarpe" row (opens `/shoes`).
- [ ] 10.2 `web/src/app/session/[id]/page.tsx`: add a header pencil icon (opens 10b edit mode) and the conditional "Svolta ieri, da Strava" card (opens `/session/[id]/strava`) shown only when Strava is connected and `useStravaActivityMatch` returns a match.
- [ ] 10.3 `web/src/app/(tabs)/week/page.tsx`: add a "+" icon opening 10b create mode.

## 11. Verification

- [ ] 11.1 Run backend test suite (`pytest`) and confirm new Strava/single-session-write tests pass alongside existing suites.
- [ ] 11.2 Run frontend lint/typecheck (`npm run lint`, `tsc`) for the new routes and store/query additions.
- [ ] 11.3 Manually walk the golden path in a browser per this repo's UI-change convention: connect Strava, create a session via "+", edit it via the pencil, confirm it lands on the Garmin calendar, view a matched "Svolta ieri, da Strava" comparison, and retire a shoe.
