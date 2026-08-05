## Why

Garmin tells the app what to do; nothing in Passo today closes the loop on what actually happened. A runner's watch-recorded pace, heart rate, and felt effort live only in Strava, and the plan has no way to react to them. Separately, the only way to add or change a session today is to re-import a whole YAML plan — there is no in-app way to create or edit a single workout. Both gaps are covered by an existing design handoff (screens 10b, 16, 17, 18, plus entry points added to 09, 10, 15) and are ready to build.

## What Changes

- Add a real Strava OAuth integration (authorization-code flow, connect/disconnect), following the same server-owns-the-token pattern already used for Garmin: the Strava access/refresh token lives in the FastAPI backend and is never sent to the browser.
- Add read-only Strava activity fetching and matching to a planned session (by date + sport), used to render the "Svolta ieri, da Strava" comparison.
- Add shoe/gear wear tracking sourced from Strava's gear API (distance per shoe), including marking a shoe as retired (excluded from future wear calculations, kept visible as archived).
- Add screen **10b Crea o modifica allenamento**: create a new session (opened from 09 Settimana's "+") or edit an existing one (opened from 10 Sessione's pencil icon), including reorderable steps, a per-step editor (duration, target pace/power, recovery), free-text notes, and delete (edit mode only). Saving performs a real write to the Garmin calendar via the existing async sync-job infrastructure, not just a local plan edit.
- Add screen **16 Collega Strava**: OAuth consent screen reached from Settings, updating the Strava row to "connected" on success.
- Add screen **17 Svolto vs pianificato**: planned-vs-actual comparison (distance, pace, heart rate, elevation, Strava's felt-effort note, a "what changes in the plan" callout, and the shoe used), reached from a new card on screen 10 Sessione.
- Add screen **18 Usura scarpe**: shoe list with wear bars (700 km threshold) and an exhaustion estimate, reached from screen 17 or from Settings.
- Update **15 Impostazioni**: add a "Strava" row (connection status, opens 16) and a "Scarpe" row (opens 18).
- Update **10 Sessione**: add a pencil icon in the header (opens 10b in edit mode) and, when applicable, the "Svolta ieri, da Strava" card (opens 17).
- Update **09 Settimana**: add a "+" icon (opens 10b in create mode).

## Capabilities

### New Capabilities
- `strava-integration-api`: FastAPI backend capability for real Strava OAuth (connect/disconnect), fetching the authenticated athlete's activities and gear, matching an activity to a planned session, and computing shoe wear/retirement state. Owns the Strava access/refresh token server-side; never returns it to the client — mirrors the existing Garmin token-handling pattern.
- `workout-editor`: the web app's create/edit workout screen (10b), reachable from 09 (create) and 10 (edit), with reorderable steps and a per-step editor, that writes through to the real Garmin calendar using the existing sync-job flow rather than only updating local state.
- `strava-companion-ui`: the web app's Strava-facing screens (16 Collega Strava, 17 Svolto vs pianificato, 18 Usura scarpe) and their new entry points added to 09, 10, and 15.

### Modified Capabilities
(none — `openspec/specs/` has no synced capabilities yet; the parent `passo-nextjs-web-app` change that defines screens 09/10/15 has not been archived, so this change extends them via new capabilities above rather than deltas against a spec that doesn't exist yet.)

## Impact

- **New backend code**: a Strava adapter (e.g. `training_plan/strava_sync.py`, mirroring the shape of `garmin_sync.py`) handling OAuth token exchange/refresh and Strava API calls; new FastAPI routes (e.g. `training_plan/api/routes_strava.py`) for connect/disconnect/status, activity-for-session lookup, and shoe list/retire; additions to `training_plan/api/schemas.py`; a token store alongside the existing Garmin session/token storage in `training_plan/service.py`.
- **New backend dependency**: an HTTP client for Strava's REST API (`requests`/`httpx`, already available, or a small dedicated wrapper — no OAuth/API SDK currently in `requirements`), plus new configuration for the Strava app's client id/secret and redirect URI (env vars, following whatever pattern Garmin credentials already use).
- **New Garmin write path**: `training_plan/service.py`/`garmin_sync.py` need a single-session create/update entry point (today's write path is plan-wide diff/sync) for screen 10b's "Salva sul calendario" to call into the existing async job store.
- **Frontend**: new routes under `web/src/app/` for 10b, 16, 17, 18; new header affordances on `web/src/app/(tabs)/week/page.tsx` and `web/src/app/session/[id]/page.tsx`; new rows on `web/src/app/settings/page.tsx`; additions to `web/src/lib/types.ts` (hand-mirrored from the new backend schemas, per existing convention), `web/src/lib/queries.ts` (new TanStack Query hooks), and `web/src/lib/store.ts` if any Strava-adjacent state is on-device-only (e.g. last-connected-email-style display state, not tokens).
- **Security**: Strava credentials/tokens follow the same rule as Garmin's — submitted once through the OAuth redirect, held only server-side, never persisted in the browser.
