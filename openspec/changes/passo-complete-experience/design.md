## Context

The completed `passo-ux-foundations` change and its uncommitted files are the baseline. FastAPI owns sessions in `plan_session` and program metadata in `user_training_plan`, with legacy `user_plan`/`user_goal` mirrors. `PUT /plan` currently saves metadata and imports sessions in separate transactions. `plan_generator.generate(write=False)` still calls `save_skeleton`, whose `ensure_plan` can create an active program. The existing snapshot covers date/position/sport/title/description/steps/locked, but omits program ownership and short-version metadata and does not prevent concurrent insertion. Current goals are embedded `RaceGoal` values. Garmin jobs are process-local, not durable delivery receipts.

## Goals / Non-Goals

**Goals:** Finish the remaining master-plan journeys with honest capability boundaries; make draft editing isolated, durable and recoverable; preserve history and locks; validate the complete active calendar; activate exactly the reviewed change atomically; support independently versioned goals and defensible evaluations.

**Non-Goals:** Changing the application's AI provider/model, adding PDF/Excel/image imports, inventing sport science or unavailable strength measurements, deploying, sending to Garmin during tests, or claiming measured usability outcomes without participants. Existing prediction algorithms remain conditional on their supported inputs.

## Decisions

### 1. Persist proposals outside the calendar

Use a separate user-scoped draft table containing `id`, integer `revision`, `source` (`ai|import`), `mode` (`new|merge|replace`), optional `target_plan_id`, editable name, goal links, inputs, original YAML and filename, proposed sessions, skeleton, validation, generation state/error, activation result and timestamps. Keep the source after parse failures. A draft is not an inactive program: inactive/archived program history must remain distinguishable from an uncommitted proposal.

Statuses are `draft|generating|ready|failed|active`; every content edit increases revision and invalidates validation. An active draft is immutable and returns its stored activation result on retry. Revisions also protect overlapping generation completion: publish a result only for the same request token/input revision. Persist start and failure information; a lost worker becomes an explicit recoverable failure, not an endless spinner. No new queue dependency is required, but the browser must be able to recover persisted results after navigation or reconnect.

### 2. API contract shared by AI and import

All new routes require authenticated user ownership. Unknown or foreign IDs return 404; mutation conflicts return the existing structured error shape and HTTP 409; invalid fields/mandatory conflicts return 422. Declare static draft routes before dynamic program routes.

| Endpoint | Contract |
|---|---|
| `GET /plan/drafts` | User's resumable proposals and status summaries. |
| `POST /plan/drafts` | Create draft with source, mode (default `new`), name, target, inputs, optional source content, sessions and goal IDs; never calendar writes. |
| `GET /plan/drafts/{id}` | Complete server draft, revision and current validation/result. |
| `PATCH /plan/drafts/{id}` | Editable content with `expected_revision`; validate field types, increment revision, clear validation. |
| `POST /plan/drafts/{id}/generate` | `expected_revision`; persist generating state before AI work and publish result only if request remains current. |
| `POST /plan/drafts/{id}/validate` | `expected_revision`; return draft with `validation {token,context_revision,status,conflicts,warnings,missing_data,impact}` and assessment date. |
| `POST /plan/drafts/{id}/activate` | `expected_revision,validation_token,acknowledge_insufficient_data?`; return `{draft_id,plan_id,sessions_count,status:'active'}`. |
| `GET/PUT /plan/constraints` | Versioned availability: `revision, available_days:[0..6], max_daily_minutes, max_sessions_per_day`; updates protect expected revision. |
| `GET/POST /goals` | List/create independent goals; typed payload with optional race-only details. |
| `GET/PATCH /goals/{id}` | Read/update goal; updates require `expected_revision`, retain old version. |
| `GET/POST /goals/{id}/evaluations` | Read/create dated evidence-qualified evaluations tied to a goal version. |

Implementation may add response fields without changing these semantics; backend and frontend share exact DTOs before integration. Import reuses existing YAML parsing but persists original text before attempting validation. Destination `merge` or `replace` requires an existing owned target by ID, never an implicit fallback to `default`. Display the effective generated dates; only promise the actual detailed 15–21-day horizon or a supported extension. A start date outside supported generator inputs is rejected explicitly, never silently ignored.

### 3. Server-authoritative coordination

Read all active program IDs, metadata/goals/skeleton phase, future sessions, current availability and relevant stored activity data. Calendar display filters have no influence. Exclude archived programs and other drafts. Deduplicate known Garmin mirrors by stable identity; unknown unlinked external events are disclosed as an assessment limitation rather than counted twice or assumed absent.

The context fingerprint covers active membership (including an empty set), all relevant session fields (including ownership, lock, priority and short variants), target metadata, goal versions and constraints. Check all dates relevant to the proposal and existing rules, not only dates with proposed sessions. Source activity evidence changes invalidate any assessment derived from those facts. Fingerprint immutable canonical content, not only `updated_at`.

Use one pure compatibility evaluator for AI, import, edits and final activation. Check available weekdays, total daily known duration, allowed count of sessions/doubles, protected sessions, target ownership and duplicates. Apply existing sport-specific intensity/load constraints where their inputs support them; never combine running/cycling distance or invent cross-sport load. Duration derived from default running pace is an estimate and cannot prove an otherwise unknown time constraint. Unsupported free-text constraints are shown as unsupported. Lack of time-of-day data prevents claims about exact clock overlap.

Report `compatible`, `conflict` or `insufficient_data`, with per-item reasons and checked/unchecked dimensions. `compatible` means the explicitly checked constraints, never medical clearance. Mandatory conflicts cannot be acknowledged away. Insufficient data requires a separate explicit acknowledgement to activate, still showing which checks passed and which remain unknown. A suggested adjustment is only compatible after it has been incorporated into the visible draft and revalidated. Initial generation preserves existing programs; unsupported coordinated edits are presented as conflicts requiring manual resolution, never silently applied.

### 4. Atomic activation and concurrency

Use one transaction for lock, draft read, revision/token/context validation, target/goal association writes, session writes, metadata/skeleton, legacy mirror updates and activation receipt. Never compose public helpers that each open an independent connection. The implementation uses one global transaction advisory lock with BEFORE STATEMENT triggers, plus explicit acquisition before every legacy SELECT FOR UPDATE. This intentionally serializes planning writes across users: statement triggers run before tuple acquisition and cover direct inserts, while explicit acquisition avoids inversion in legacy read-lock-write paths. A user-scoped trigger was rejected because row triggers would acquire the advisory lock after locking tuples. Acquire the shared lock before reading activation context, recheck mandatory compatibility inside the transaction, and keep AI/Garmin calls outside it. PostgreSQL tests must verify ordering, stale inserts, rollback and repeated activation before acceptance.

`new` creates a distinct active program; `merge` adds sessions without deleting existing IDs; `replace` changes only the explicit reviewed future range and preserves locked, completed and out-of-range sessions and their IDs. Retained rows stay stable. A duplicate activation returns the original receipt and creates nothing. Errors roll back every affected program, session and goal link. Activation never sends to Garmin. Legacy explicit program/session mutators participate in the same lock and update version context. Program activation via legacy toggle must run compatibility too or redirect through review; it cannot bypass mandatory rules.

### 5. Truly read-only AI proposal mode

Refactor generator inputs to allow explicit goal (including explicit no goal), start/context/constraints, and active-program commitments without loading an unrelated default goal. Build skeleton in memory; store it only with committed activation. Other programs' sessions are fixed context but never returned as newly owned sessions. Return proposed sessions only for the intended target. Retain existing AI configuration and deterministic fallback with truthful source labeling. Validate generated proposals using the same evaluator as imports.

### 6. Independent goals and evidence

Use a goal table with stable ID, revision, status, kind (`race|performance|fitness|strength|consistency|maintenance`), title/description, sports, priority, criterion, optional baseline/value/date/source, optional deadline or review date, and evaluation cadence. Store immutable versions and dated evaluations, plus many-to-many program links with a principal/contributing role. Optional goal is valid for a free program. Link changes and target changes invalidate proposal reviews.

Migrate embedded race goals without deleting source values, preserving deterministic provenance and IDs on repeated migration. Distinct embedded goals are not merged solely because their names match. Existing race consumers receive a race adapter only for race goals; non-race payloads never enter `RaceGoalIn`. Archiving a program retains goals, evidence and past activities.

Evaluations expose execution, result progress and evidence quality separately. Each includes evaluated goal revision, period, data timestamp, source, relevant observed metrics, missing data and rationale. Dedupe athlete activities by their canonical source identity. A completed session is adherence, not proof of outcome. Strength/performance goals without recorded comparable measurements remain insufficient; predictions remain estimates and are reused only where the existing service supports them. Historical evaluations retain the target version; updating a goal does not rewrite progress or alter the calendar.

### 7. Complete the surrounding experience

Retain the foundation routes and visual tokens. Program entry separates single workout, new AI/file program and updating an existing program. Review shows source, date range, sports, homogeneous weekly totals, all session changes/preserved items, assessment limitations, editing and explicit confirmation of replacements. Program filtering never changes activation. After activation offer calendar and a separate Garmin preview.

Training details show sport-relevant units, real publication state and visible Modifica/Sposta/Versione breve where supported. Move runs preview before save; short version shows duration/phase differences and restore. Editor protects unsaved changes and uses field errors and persistent duration. Local save does not auto-push Garmin; pending diff and explicit publication remain reachable. Existing publication confirmation/destructive scopes are preserved; process-local job disappearance is reported as unknown and requires refresh/reconciliation, not a fabricated success or blind resubmission.

Activities keeps canonical history identity and provides Storico/Andamento/Resoconti with measured/estimated labels and homogeneous comparisons. Recovery provides Oggi/Tendenze with source, time, null/stale states and explained load metrics. Nutrition provides day plan/diary with shared URL date and one meal review/save path; schedules do not imply a workout is running or a meal consumed. Profile groups account/connections/athlete/equipment/preferences, exposes observed connection freshness and preserves optional Strava/first-use continuation where supported. All return paths retain validated origin/date/filters.

Every new page follows `web/AGENTS.md`: `useScreenReady`, `dis`, shared skeletons, `role=alert`, stable tracking names. Read installed Next.js guides before routing changes. Validate 360/390/430/768/1440 widths, 200% text, keyboard/focus and reduced motion. `NEXT_PUBLIC_PROGRAM_DRAFTS_ENABLED=false` disables new creation/generation/activation entry points with an explicit temporary-unavailability state while retaining calendar and saved-draft consultation. It never restores unsafe immediate legacy writes; backend safety is independent of the flag.

For an unknown/404 Garmin job, preserve the operation context, stop indefinite busy states and show “Esito non verificabile”. Offer “Controlla calendario e modifiche” which invalidates cached calendar/diff and opens a fresh comparison before any new send. Never automatically restart the unknown operation. Apply the same behavior to publication results and Garmin-only editor flows.

## Risks / Trade-offs

- Database concurrency cannot be proven by mocked cursor tests alone → add isolated PostgreSQL transaction tests when a test database is available, otherwise explicitly record the missing proof and inspect lock ordering.
- Global planning locking serializes short writes across all users → keep transactions bounded and external calls outside them; measure contention before scaling beyond this conservative implementation.
- Existing Garmin jobs cannot establish durable exactly-once external writes → refresh/reconcile before retry and record this as a live-service limitation; do not invent an external undo.
- Existing generation may lack usable baseline data → preserve draft and request supported input or show unavailable state; never invent fitness.
- UI screenshots cannot establish usability or full WCAG compliance → separate automated/visual evidence from participant and assistive-technology checks.

## Migration Plan

Add tables/columns and lock triggers idempotently, migrate embedded goals without destructive rewrites, deploy compatible backend then enable the frontend flag after isolated checks. Keep legacy URLs and race adapters. Rollback disables new UI entry points and retains drafts/goals/history; never drop new tables as rollback. No production migration, deployment or external sync is executed during this task.

## Open Questions

No product approval is required to implement these scoped decisions. Availability of an isolated PostgreSQL instance, live-service credentials for later acceptance, and actual user-testing participants are verification dependencies to report accurately.
