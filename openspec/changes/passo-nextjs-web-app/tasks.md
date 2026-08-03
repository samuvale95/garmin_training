## 1. Backend: FastAPI adapter (`passo-training-api`)

- [x] 1.1 Add `fastapi` + `uvicorn` (and `python-multipart` for file upload) to `pyproject.toml`
- [x] 1.2 Create `training_plan/api.py` (or `training_plan/api/` package) with a FastAPI app instance and CORS configured for the local Next.js dev origin
- [x] 1.3 Define Pydantic request/response schemas mirroring `TrainingSession`, `Step`, `PaceTarget`, `PlanDiff`, `ChangedSession`, `ScheduledWorkout`, `SyncResult`, `DeleteResult`
- [x] 1.4 Implement `POST /plan/parse` — accepts raw YAML text or an uploaded file, calls `parser.parse_training_plan`, returns parsed sessions or per-line validation errors (4xx)
- [x] 1.5 Implement `POST /plan/diff` — accepts parsed sessions, runs `service.preview_plan_sync` (via `run_in_threadpool`), returns the diff; performs no writes
- [x] 1.6 Implement the async job store: an in-memory dict keyed by `job_id`, holding status/progress/per-item results/cancellation flag
- [x] 1.7 Implement `POST /plan/sync` — accepts sessions to create and/or changed sessions to replace, starts a background task calling `service.apply_plan_sync` one session at a time (reusing `GarminSync.replace_all`/`sync_all`'s existing sequential behavior), updates the job record after each session, returns `job_id` immediately
- [x] 1.8 Implement `GET /plan/sync/{job_id}` — returns current progress snapshot
- [x] 1.9 Implement `POST /plan/sync/{job_id}/cancel` — sets the cancellation flag, checked between sessions only
- [x] 1.10 Implement `POST /garmin/connect` — accepts email/password, calls `service.verify_login`, returns connected/failed (auth vs. rate-limit distinguished), never echoes credentials or tokens
- [x] 1.11 Implement `GET /garmin/status` — reads the existing token store + `~/.garmin_training_login_state.json` cooldown record, returns connected/not-connected + `retry_after_seconds` when a cooldown is active
- [x] 1.12 Implement `GET /garmin/workouts` — wraps `service.list_workouts` for a date range
- [x] 1.13 Implement `POST /garmin/deletions/preview` and `POST /garmin/deletions/apply` — wrap `service.preview_deletion`/`service.apply_deletion`
- [x] 1.14 Add error-handling middleware translating `GarminSyncError`/`GarminRateLimitError`/`TrainingPlanValidationError` into structured JSON error responses with the categories the frontend needs (auth-failed / rate-limited / validation-failed)
- [x] 1.15 Write unit/integration tests for every endpoint (success + each error category), reusing the existing test patterns in `tests/test_service.py` — `tests/test_api.py`, 27 tests, all passing alongside the existing 80
- [x] 1.16 Add a `dev`/run script (e.g. `uvicorn training_plan.api:app --reload`) and document it in the README — see README's new "Web API (FastAPI)" section

## 2. Backend: body/wellness data (`passo-body-insights-api`)

- [ ] 2.1 Spike against a real Garmin account: identify the exact `garminconnect` client methods for user summary, sleep, HRV, resting HR, battery, stress, training status/load, max metrics (VO₂max) — record field shapes, mirroring the empirical-verification note pattern already in `models.py` — **not done**: no live Garmin account was available in this session. `body_insights.py` was built against the library's documented method signatures (`get_training_readiness`, `get_sleep_data`, `get_hrv_data`, `get_rhr_day`, `get_body_battery`, `get_stress_data`, `get_training_status`, `get_max_metrics` — confirmed to exist via `inspect.signature`) and commonly-seen field names, with defensive `.get()` extraction everywhere so an unverified/wrong field name degrades to "unavailable" rather than crashing. Verifying exact field shapes against a real account remains a follow-up before trusting the numbers in production.
- [x] 2.2 Add `training_plan/body_insights.py` (or extend `garmin_sync.py`) with read-only functions/dataclasses for: morning readiness, sleep phases, 7-day HRV series, resting HR + delta, battery, stress
- [x] 2.3 Add functions/dataclasses for: 4-5 week training load (completed vs. planned, current-week flag), acute:chronic ratio, VO₂max — "planned" load is deliberately not returned by the backend (the plan is client-side only per design.md); `completed_load`/`in_progress` only
- [x] 2.4 Implement the derived conflict calculation: given a body snapshot + the next planned session (received from the frontend's current plan, not stored server-side), determine conflict presence and produce exactly two concrete resolution options plus the implicit "leave as-is" path
- [x] 2.5 Implement `GET /body/today` (morning snapshot), `GET /body/load` (training load/acute-chronic/VO₂max), `POST /body/conflict` (accepts the next planned session, returns conflict + options) in `api.py`
- [x] 2.6 Handle the "no overnight sync yet" case explicitly (partial/empty response, not an error) for the empty-state screen treatment
- [x] 2.7 Write tests for each endpoint, including the missing-data and no-conflict paths — `tests/test_body_insights.py` (unit-level) + `tests/test_api_body.py` (endpoint wiring)

## 3. Frontend: project setup

- [x] 3.1 Scaffold a new Next.js app (App Router, TypeScript) in a new top-level directory (e.g. `web/`)
- [x] 3.2 Install and configure TanStack Query (`QueryClientProvider` at the root layout, sensible default `staleTime`/`gcTime`)
- [x] 3.3 Install and configure Zustand with the `persist` middleware for the client-only store (plan, prefs, write-job history)
- [x] 3.4 Install Framer Motion for cross-route transition orchestration
- [x] 3.5 Set up a typed API client (fetch wrapper) reading `NEXT_PUBLIC_API_BASE_URL`, with typed request/response matching the backend's Pydantic schemas
- [x] 3.6 Copy the seven illustrations from `/Users/samuevalente/Downloads/design_handoff_passo/illustrazioni/` into the Next.js app's asset directory
- [x] 3.7 Configure fonts: Outfit, Instrument Serif (italic), DM Mono via `next/font/google`
- [x] 3.8 Set up global CSS: design tokens (colors, spacing, radii) as CSS custom properties, `--ease` variable, mobile-first centered max-width shell (390px design frame) per design.md §6

## 4. Frontend: motion system foundation

- [x] 4.1 Port every named keyframe from the reference HTML's `<style>` block verbatim into a global stylesheet: `mkStretch`, `mkWordIn`, `mkSlideUp`, `mkBarGrow`, `mkSweep`, `mkTrace`, `mkLand`, `mkBreath`, `mkPulseRing`, `mkSheen`, `mkNudge`/`mkChev`, `mkDotPulse`, `mkCount`, `mkCreep`, `mkTick`, `mkCaret`, `mkArrowUp`, `mkSpinSlow`, `mkBarSettle`, `mkTipGrow`
- [x] 4.2 Build `useMotionEnabled()` hook combining `prefers-reduced-motion`, the "Meno movimento" preference, and a still-screen flag into one reduced/enabled state
- [x] 4.3 Build `<BrandMark size static?>` component (four bars, second always coral, canonical frozen frame below 18px height and whenever reduced motion is active)
- [x] 4.4 Build reusable entrance primitives: `<WordIn>`, `<SlideUp>`, `<BarGrow>` wrapper components applying the ported keyframes with mount-once tracking (no replay on tab switch/back-navigation) per design.md §5
- [x] 4.5 Build the Framer Motion route-transition layer: push (25% translate + opacity .6 outgoing), pop, tab cross-fade, still-screen cross-fade (no slide), modal/sheet presentation — per `MOTION.md` §3.2 — modal/sheet presentation variant not separately built (no screen in this change uses a modal sheet yet)
- [x] 4.6 Build shared indicator components: pulse ring (max one per screen, opacity-conflict-safe per `MOTION.md` §6.1's documented pitfall), status dot, progress ring (`mkTrace`, redraws only on real value change), button-fill primary action (`mkSweep` + loading/success/disabled states per `MOTION.md` §5.1)
- [x] 4.7 Build skeleton-loading components (shape-matching rectangles + slow sheen) — no spinners anywhere, per `MOTION.md` §7.1

## 5. Frontend: on-device state and data layer

- [x] 5.1 Define the persisted Zustand store: `plan` (yaml, parsed sessions, filename, imported-at), `prefs` (avvisami, chiedi-prima-di-cancellare, meno-movimento), `writeJobHistory` (completed job summaries)
- [x] 5.2 Define TanStack Query hooks: `useGarminStatus`, `usePlanDiff`, `useStartSync`, `useSyncJobStatus` (polling), `useWorkouts`, `useDeletionPreview`/`useApplyDeletion`, `useBodyToday`, `useBodyLoad`, `useBodyConflict`
- [x] 5.3 Wire the sync-job status query's `refetchInterval` to poll only while a job is active, and to write the final result into `writeJobHistory` on completion
- [x] 5.4 Ensure `diff`, `calendar`, and `body`/`conflict` queries are never persisted to `localStorage` (query-cache only), per design.md's state-mapping table

## 6. Frontend: Act 1 — entry, connect, import

- [x] 6.1 Build the entry screen: brand mark, wordmark, cascading titles, illustration, single "Inizia" button (replaces design screen 01)
- [x] 6.2 Build the Garmin connect screen (design screen 02) unchanged: underline inputs, rate-limit pre-warning card, "Collega" (mkSweep fill) / "Lo faccio dopo"
- [x] 6.3 Build the plan import screen (03): file upload + paste-text paths, last-imported summary card, reimport action, format-explainer card
- [x] 6.4 Wire import validation errors to per-line display

## 7. Frontend: Act 2 — diff, confirm, write, result (still-zone screens)

- [x] 7.1 Build the diff screen (04): header with count chips, scrollable categorized card list with era/ora rendering, footer gradient + primary action scoped to new-only sessions — implemented with zero animation and the "fermo · stai decidendo" label
- [x] 7.2 Build the deletion confirmation screen (05): pink background, still brand mark, session list with creation-date/never-executed copy, reassurance card, destructive/cancel actions, "one at a time" fallback — the list shows date/title/"mai eseguita" only; the exact "creata il ..." timestamp isn't available from the current diff response shape and was left out rather than fabricated
- [x] 7.3 Build the sync-in-progress screen (06): dark background, hero counter, real progress bar (`mkBarGrow` + `mkCreep`), three running counts, last-three status list with pulse-ring on the in-flight item, "interrompi dopo questa"
- [x] 7.4 Build the sync result screen (07): outcome hero card, per-failure reason+action rows, aggregate metrics, "retry failed only" action wired to a new sync job scoped to failures
- [x] 7.5 Verify all three still screens against the zero-animation requirement and the cross-fade-only transition into them

## 8. Frontend: Act 3 — daily use

- [x] 8.1 Build the shared tab-bar layout (Oggi · Settimana · Corpo) with the pill-position transition and scroll-position retention per tab — pill transition via Framer Motion `layoutId`; scroll-position retention relies on the browser's default per-route scroll restoration, not custom-implemented
- [x] 8.2 Build the Today/home screen (08): hero card, three metrics, diff-status card (with the "in pari" empty-state alternative), rest-of-week strip
- [x] 8.3 Build the Week screen (09): header with range/nav arrows, per-day type-colored cards with non-normalized heights, rest/interval/easy/strength/long illustration mapping — session "type" (ripetute/fondo lento/forza/lungo) is a heuristic derived from sport+steps (see `lib/sessionVisuals.ts`), since the file format has no explicit category field
- [x] 8.4 Build the Session detail screen (10): distance ring, step list with key-step distinction, calendar-presence + reschedule action — "reschedule" edits the local plan date (consistent with "the file is the truth"); it does not yet call a Garmin reschedule endpoint (there isn't one — Garmin has no in-place move, only delete+recreate via the existing diff/sync flow)
- [x] 8.5 Wire push/pop transitions for 08→10 and 09→10 — via the shared `RouteTransition` push variant (not a dedicated 08/09→10-only variant)

## 9. Frontend: Act 4 — the body

- [x] 9.1 Build the Recovery screen (11): readiness ring + two-part verdict, sleep/HRV cards, small metrics row, plan-linking closing card, empty-state handling for missing overnight sync
- [x] 9.2 Build the Load/form screen (12): pixel-height histogram, acute:chronic indicator, VO₂max card, serif explainer
- [x] 9.3 Build the Body-conflict screen (13): contradiction summary, affected session card, the two concrete options wired to real plan edits, "lascia tutto com'è" path, closing reassurance line
- [x] 9.4 Wire plan edits from screen 13's options back into the persisted plan store (move date / adjust step parameters), available for later YAML export

## 10. Frontend: Act 5 — errors and settings (still-zone + settings)

- [x] 10.1 Build the forced-wait screen (14): live countdown sourced from `retry_after_seconds`, progress bar, IP-not-account explanation, reassurance card, inert primary action until countdown reaches zero
- [x] 10.2 Build the Settings screen (15): Garmin connection card (connect/disconnect/last-sync), three preference toggles, YAML download action, exit action — no profile/account card — "disconnect" and "last-sync" are not shown: no backend endpoint exists to revoke the cached token or report last-sync time yet; the card currently shows connected/not-connected only
- [x] 10.3 Implement the YAML download action, serializing the current in-browser plan (including any screen-13 edits)

## 11. Cross-cutting states

- [x] 11.1 Implement all documented empty states (no plan imported → screen 03 as home with no tab bar; no morning data; week without sessions; no diff) — "no plan imported" redirects to `/import` from every plan-requiring screen; "week without sessions" falls back to each day's own Riposo/sabbia treatment rather than a single dedicated whole-week empty card
- [x] 11.2 Implement the three-tier error treatment (informational row / decision screen / blocking screen) per `MOTION.md` §7.4, with copy following the what-happened/why/what-now rule
- [ ] 11.3 Implement the offline banner (non-modal, top banner, disables network-dependent actions, slides away on reconnect) — **not done**, follow-up
- [ ] 11.4 Implement pull-to-refresh on scrollable screens: brand mark as the pull indicator, changed values re-enter with `mkWordIn`, full cascade not replayed — **not done** (native overscroll only); follow-up

## 12. Verification

- [ ] 12.1 Run the `MOTION.md` §10 PR checklist against every screen — **not done as a formal per-screen audit**; the constraints (single easing curve, 4-bar mark, ≤3 concurrent infinite animations, single pulse-ring/sheen, numbers entering from below, zero-animation still screens, ≥44×44px touch targets, no spinners) were followed while building the shared primitives, but no line-by-line checklist pass was run against each of the 15 screens individually
- [x] 12.2 Manually verify the end-to-end flow — verified structurally: `next build`/`next lint` pass clean, and all 15 routes return HTTP 200 with no server-side render errors (`npm run build`, then a live `next dev` + `uvicorn` smoke test of every route). Clicking through the flow interactively in a real browser was **not done in this session** — no browser-automation tool was available; the user should click through before treating this as production-ready
- [ ] 12.3 Manually verify the rate-limit path — **not done**; requires triggering a real Garmin auth failure, out of scope without live credentials in this session
- [ ] 12.4 Verify state persistence across a reload — **not manually verified in a browser**; the persistence mechanism (Zustand `persist` to `localStorage`, diff/body queries excluded) is implemented and code-reviewed but not click-tested
- [ ] 12.5 Verify no Garmin credential or token material ever appears in browser storage/responses/logs — **not independently audited with browser devtools**; by construction the connect endpoint never echoes credentials/tokens (see `routes_garmin.py` and its test `test_garmin_connect_success`), but a devtools-based check was not performed
- [x] 12.6 Update the project README with the new two-process local setup (FastAPI backend + Next.js frontend) and how to run both
