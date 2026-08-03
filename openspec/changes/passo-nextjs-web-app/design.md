## Context

The repository currently has:
- `training_plan/parser.py` — pure YAML parsing/validation.
- `training_plan/garmin_sync.py` — `GarminSync`, wrapping the `garminconnect` library: login (with local rate-limit cooldown persisted to `~/.garmin_training_login_state.json`), workout payload construction, create/schedule, diff-against-calendar, delete. Returns plain dataclasses (`SyncResult`, `ScheduledWorkout`, `DeleteResult`, `ChangedSession`, `PlanDiff`); never prints or reads stdin.
- `training_plan/service.py` — orchestration functions (`verify_login`, `preview_plan_sync`, `apply_plan_sync`, `list_workouts`, `preview_deletion`, `apply_deletion`) built for exactly this moment: a non-CLI consumer calling the same logic the CLI calls.
- `training_plan/cli.py` — argparse + print/input, the only current consumer of `service.py`.
- No web framework, no HTTP layer, no database, no auth system anywhere yet (the `web-platform-migration` change deliberately stopped short of choosing any of these).

Separately, a complete high-fidelity design bundle for "Passo" exists at `/Users/samuevalente/Downloads/design_handoff_passo/`: `README.md` (screens, tokens, state model), `MOTION.md` (the full motion/interaction spec — the authoritative source for animation), `Passo - App completa.dc.html` (reference implementation with all keyframes in its `<style>` block — "fonte autorevole" for exact values), and seven 1024×1024 PNG illustrations.

This design document covers two things: (1) a thin FastAPI layer plus a small additive body-data capability that lets a browser talk to the existing Python logic, and (2) a Next.js app that reproduces the 15 screens faithfully, with the one agreed deviation (no Google/account login, replaced by "Inizia") and fully on-device app state.

## Goals / Non-Goals

**Goals:**
- Preserve `training_plan/service.py`'s existing functions and signatures exactly; the API layer calls them, never reimplements their logic.
- Model the long-running Garmin write (screen 06) as a job that survives the client navigating away or closing the tab, matching the design's explicit "continua in background" behavior.
- Reproduce all 15 screens at the fidelity the design bundle demands: exact tokens, exact motion (single easing curve, named gestures, the 3-concurrent-animation ceiling, the three still screens, `prefers-reduced-motion` + the in-app "Meno movimento" toggle converging on the same behavior).
- No server-side user data store: plan/diff/prefs/write-job-history live in the browser (`localStorage`/`IndexedDB`); the only server-held secret is the Garmin session token (never sent to the browser).
- Ship the one agreed deviation cleanly: screen "01 Accesso" becomes a single "Inizia" button with no account concept anywhere in the app (no user ID, no session cookie tied to identity); screen "02 Collega Garmin" is unchanged and still the only path to a real Garmin connection.

**Non-Goals:**
- Choosing a production hosting/deployment target for either the Next.js app or the FastAPI service — this change targets local/dev usage (two local processes), matching the single-user CLI tool it extends. A deployment story is a later decision.
- Multi-user support, accounts, or any server-side database — explicitly out of scope, consistent with "tutto in memory sul dispositivo."
- Building a native mobile app (the design's own stated target). This change is a mobile-first responsive web app in Next.js, per explicit instruction.
- Perfecting every Garmin wellness metric empirically — `passo-body-insights-api` uses the `garminconnect` library's existing wellness calls as-is; if a field's exact meaning needs empirical verification against live data (the codebase already has precedent for this need in `models.py`'s comment on `CONDITION_TYPE_PAYLOAD`), that is flagged as a task, not silently guessed.

## Decisions

### 1. FastAPI as the HTTP adapter, one process, synchronous underneath
`training_plan/api.py` (or a package) wraps `service.py` with FastAPI route handlers. Handlers stay thin: parse/validate the request, call the existing (synchronous) service function in a thread (FastAPI's `run_in_threadpool`, since `GarminSync` and `garminconnect` are blocking, not async), and shape the response. No business logic moves into the API layer.

Alternatives considered: Flask was the other option raised. FastAPI is chosen for built-in request/response validation (Pydantic — a natural fit for the existing dataclasses), automatic OpenAPI docs (useful given the frontend is being built by a different part of this same change), and native async endpoint support that makes the polling job-status endpoint (many short requests) cheap without extra plumbing.

### 2. The Garmin write job is an in-process async job store, not a queue
`POST /plan/sync` (apply) starts the write loop (one session at a time, matching `GarminSync.sync_all`/`replace_all`'s existing sequential behavior) on a background `asyncio` task (or thread), immediately returns a `job_id`, and records progress (current index, per-session result, done/aggregate counts) in an in-memory dict keyed by `job_id`. `GET /plan/sync/{job_id}` returns the current snapshot — this is what screen 06's progress bar and per-session status dots poll, and what lets a user navigate to screen 07 later (or reopen the tab) and still see where the job landed.

Alternatives considered: a real task queue (Celery/RQ + Redis) is overkill for a single-user local tool with one job running at a time; it adds a broker dependency for no real benefit at this scale. A plain in-memory store is lost on backend restart, which is an accepted trade-off for a local dev tool — flagged under Risks.

Interruption ("Interrompi dopo questa sessione", screen 06) is a flag on the job record the frontend sets via `POST /plan/sync/{job_id}/cancel`; the loop checks it between sessions, never mid-write, matching the design's "no half-finished state" rule.

### 3. `passo-body-insights-api`: additive read-only methods, not a rewrite of `GarminSync`
New functions (in `garmin_sync.py` or a sibling module, e.g. `training_plan/body_insights.py`, reusing the same authenticated `Garmin` client) map to the data screens 11–13 need: morning readiness, sleep phases, 7-day HRV series, resting HR (+ delta), battery, stress, 4-week training load (done vs. planned per week, current-week-in-progress flag), acute:chronic ratio, VO₂max, and a derived "conflict" (today's readiness/sleep/HRV vs. tomorrow's planned session, per the README's `conflict` state, which is explicitly derived and not stored). These call `garminconnect`'s existing wellness endpoints (user summary, sleep, HRV, training status, max metrics) and reshape the results into small dataclasses, the same pattern `garmin_sync.py` already uses for workouts.

The "two concrete options" behavior of screen 13 ("Spostala a domani" / "Tienila, ma più morbida" / "Lascia tutto com'è") is real and reversible: each option is a normal plan edit (a session move or a step-parameter change) that goes through the existing sync path (delete+recreate) and is written back into the in-browser plan state, not a special-cased endpoint. The API doesn't need new logic for this beyond what `passo-training-api` already provides for editing a session.

### 4. Frontend state split: TanStack Query for server state, a persisted client store for on-device-only state
Mapping the README's abstract state model to concrete storage:

| README state | Where it lives here | Why |
|---|---|---|
| `plan` (YAML source, parsed sessions, filename, import date) | Persisted client store (see below) | Genuinely device-only; the backend never stores "the plan," it only ever receives it per-request to diff/sync |
| `prefs` (avvisami, chiedi-prima-di-cancellare, meno-movimento) | Persisted client store | Pure UI/device preference, no server concern |
| `writeJob` history (past run summaries, for screen 07 after leaving/returning) | Persisted client store, seeded/refreshed from the live job snapshot while a job is running | The live snapshot comes from TanStack Query (polling); once a job finishes, its final result is written into the persisted store so it survives a refresh even after the backend's in-memory job record would otherwise be gone |
| `auth` (Garmin session validity), `cooldown` | **Not persisted client-side at all.** Read via TanStack Query from a `GET /garmin/status` endpoint backed by the existing `garmin_sync.py` token/cooldown files | The real source of truth already lives server-side (token store + `~/.garmin_training_login_state.json`); duplicating it into the browser risks drift (e.g. a cooldown that expired server-side but not client-side) |
| `calendar`, `diff` | TanStack Query cache only, refetched, never persisted | The README is explicit: "il diff è derivato... ricalcolarlo a ogni apertura" |
| `body`, `conflict` | TanStack Query cache only (`passo-body-insights-api`), short `staleTime` | Physiological data changes daily; caching it in localStorage would show stale morning numbers |

**Persisted client store**: Zustand with its `persist` middleware (backed by `localStorage`, or `IndexedDB` via a custom storage adapter if the plan's parsed-session payload turns out large for very long plans). Chosen over React Context + manual `localStorage` sync (more boilerplate, easy to get effect timing wrong) and over Redux Toolkit + `redux-persist` (heavier machinery than a single-user local app's client state needs). Zustand's small API and built-in persistence middleware is the closest same-shape analogue to what a mobile app would use (e.g. a lightweight local store), which keeps the port faithful to the design's implied architecture.

**TanStack Query** handles every call to `passo-training-api`/`passo-body-insights-api`: `useQuery` for diff/calendar/body reads (with explicit `staleTime`/`gcTime` tuned per data volatility), `useMutation` for plan import/apply-sync/delete, and polling (`refetchInterval`) for the write-job status query — which is exactly the "operation continues in background, come back and see it" behavior the design calls for, since polling continues as long as the query is mounted regardless of which screen the job status card appears on.

### 5. Motion system: ported CSS keyframes + a thin React layer, Framer Motion only for orchestrated navigation transitions
`MOTION.md` and the reference HTML's `<style>` block are the source of truth. Concretely:
- All named keyframes (`mkStretch`, `mkWordIn`, `mkSlideUp`, `mkBarGrow`, `mkSweep`, `mkTrace`, `mkLand`, `mkBreath`, `mkPulseRing`, `mkSheen`, `mkNudge`/`mkChev`, `mkDotPulse`, `mkCount`, `mkCreep`, `mkTick`, `mkCaret`, `mkArrowUp`, `mkSpinSlow`, `mkBarSettle`, `mkTipGrow`) are ported **verbatim** (durations, easing, transform values) from the HTML's `<style>` block into a global stylesheet, as CSS `@keyframes` + utility classes — not reimplemented as JS animation objects. This is the lowest-risk way to guarantee the "exact" fidelity the design demands, since the HTML file is explicitly the authoritative source for exact values.
- A single CSS custom property `--ease: cubic-bezier(0.22, 1, 0.36, 1)` is the only easing token used outside the explicitly-listed `ease-in-out` (breathing/oscillation cycles) and `steps(1)` (ticks/caret) exceptions.
- A `<BrandMark size static?>` component (the four-bar mark) is the one component every screen imports; `static` is forced by three independent triggers ORed together: `prefers-reduced-motion: reduce`, the app's "Meno movimento" preference, and the screen being one of the three still screens (04, 05, 14) — all three collapse to the same "frozen on the canonical frame" state, per a single `useMotionEnabled()` hook so there is exactly one place this logic lives.
- **Framer Motion** is used only for the screen-to-screen orchestration that plain CSS can't express declaratively across Next.js route changes: push/pop (25% translate + opacity on the outgoing view), tab cross-fade, the cross-fade-only transition into the three still screens, and the modal/sheet presentation. `AnimatePresence` + `layout` transitions drive this; all other motion (entrance cascades within a screen, continuous loops, button fills) stays as CSS animations/classes applied via simple mount-triggered class toggles, since those don't need cross-route orchestration.
- Reduced motion behavior matches §9 of `MOTION.md` exactly: entrances and breathing/inviting loops are disabled; informational indicators (`mkCreep`, `mkTick`, `mkDotPulse`, `mkCount`, `mkCaret`) stay on; `mkPulseRing` is replaced by a static bordered dot; navigation becomes a flat 160ms cross-fade; touch feedback is untouched.
- Entrance cascades run once per screen mount (tracked via a ref/`sessionStorage` flag scoped to the navigation session, cleared on hard reload), not on every tab revisit or back-navigation, per §3.3.

### 6. Layout: mobile-first, centered max-width shell — not a native-feeling full-bleed PWA disguise
The design's reference frame is 390×788 content area. In Next.js this becomes: the app renders full-width on narrow viewports (true mobile web), and on wider viewports (desktop browser testing/demoing) the content column is centered with a `max-width` matching the design frame (with the crema/inchiostro background extending to the viewport edges only as flat color, never stretched UI) — the same pattern most mobile-first web apps use when opened on desktop, rather than trying to fake a native phone chrome. No PWA manifest/installability is required by this change (not requested; can be a trivial follow-up), but nothing here blocks adding one later. Route structure mirrors the five "acts": `/` (Inizia), `/connect-garmin`, `/import`, `/diff`, `/confirm-deletions`, `/sync`, `/sync/result`, `/today`, `/week`, `/session/[id]`, `/body`, `/body/recovery`, `/body/load`, `/body/conflict`, `/settings`, with the tab bar (`Oggi · Settimana · Corpo`) persisting across the Act-3/4 routes via a shared layout.

### 7. Images: `next/image` over the seven provided PNGs, no `<image-slot>`
The seven 1024×1024 alpha PNGs are copied into the Next.js app's asset pipeline (e.g. `public/illustrazioni/` or co-located per-component imports) and rendered with `next/image`, `object-fit: contain`, anchored bottom-right of their card, no shadow — replacing every `<image-slot>` in the reference HTML per the design bundle's own instruction. `mkLand`/`mkBreath` apply to the rendered `<Image>`'s wrapping element (`transform-origin: bottom center`), not to `next/image`'s internal `<img>`, since Next.js wraps it and applying transforms directly to the `<img>` can conflict with its layout-shift-prevention sizing.

## Risks / Trade-offs

- **[Risk] In-memory job store loses in-flight write-job state on a backend restart mid-sync.** → Mitigation: this is a local single-user dev tool restart scenario, not a production multi-tenant one; the frontend's persisted job-history store keeps the last-known snapshot so the user sees "last known state" rather than nothing, and the design's own copy already reassures "le sessioni già scritte restano" — restarting the backend doesn't undo Garmin writes already made, only the live progress view of an in-flight one.
- **[Risk] `passo-body-insights-api`'s exact field mapping from `garminconnect`'s wellness endpoints may not match the design's assumed shapes (e.g. exact VO₂max field, acute:chronic definition) without empirical checking against a real account**, mirroring the exact kind of surprise `models.py` already documents for workout condition types. → Mitigation: task list includes verifying each wellness field against a live Garmin account before wiring it to a screen; until verified, the frontend can render with the API's real shape and a documented TODO rather than inventing a mock.
- **[Trade-off] Choosing Zustand+persist over a native-mobile-analogous storage layer (e.g. MMKV, SQLite) means "in memory sul dispositivo" is implemented as browser storage, which is weaker than device-native secure storage.** Accepted: no secrets are stored client-side (the Garmin token never leaves the backend), so `localStorage`'s lack of encryption is not a credential-exposure risk — only plan/prefs/history, which are not sensitive.
- **[Risk] Two local processes (Next.js dev server + FastAPI/uvicorn) must both run for the app to be functional beyond viewing cached local state.** → Mitigation: documented startup instructions (README update) and a `NEXT_PUBLIC_API_BASE_URL` env var with a sensible local default; a later change can add a single-command dev script if this proves annoying in practice.
- **[Risk] Framer Motion + CSS-keyframe hybrid is two animation mechanisms in one codebase, a potential source of inconsistency.** → Mitigation: the split is drawn along a clear, narrow line (cross-route orchestration = Framer Motion; everything else = ported CSS) and the PR checklist from `MOTION.md` §10 is carried into this change's task list verbatim as a per-screen verification step, so drift is caught screen-by-screen rather than discovered late.

## Open Questions

- Exact request/response schema for `passo-body-insights-api` fields depends on empirical verification against a live Garmin account (see Risks) — resolved during implementation, not before.
- Whether the app eventually needs a PWA manifest/offline shell is left open; not requested for this change and not blocked by anything decided here.
