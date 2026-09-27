## Why

The plan is still written outside the app: an AI chat produces a YAML file, the user imports it. Phase 0 moved the plan onto the server (`server-owned-plan`) and phase 2 gave the code its limits (`plan-limits`); the missing piece of `BRAINSTORM-miglioramenti-e-gamification.md` §0.4 is the generation itself — the app writing the next weeks for this user, from their history, level and goal, with the code deciding the boundaries and checking the result. Without it every other phase 2 step (adaptation, food targets tied to the plan) has nothing to adapt.

## What Changes

- A deterministic **skeleton**: one row per week from now to the goal race (or just the next weeks when there is no goal), with phase, target running minutes, longest run allowed, hard sessions allowed, running days, deload and taper weeks, and a sentence saying why with the user's numbers. Computed by code from the stored history, the effective level and the goal; stored with the plan and recomputed only when its inputs change.
- A **generator** that fills the rolling window (from tomorrow to the Sunday two weeks later, 15–21 days) with complete sessions. The model composes: which sessions, in which order, with steps, paces from the athlete's own pace bands, and a description saying what each session is for. The code checks every proposal against the `plan-limits` rules, the skeleton targets and a set of structural checks, and sends the violations back to the model; at most three attempts.
- A **deterministic fallback** composer that writes a plain window inside the same limits when no model is configured, the model is unreachable or three attempts all fail. A plan must never depend on a model being up (`llm.py`'s rule).
- The result is written through `plan_store.replace_unlocked`: locked (user-edited) sessions stay as they are, a proposed session that collides with one is reported as a conflict, never written over it.
- `POST /plan/generate` and `GET /plan/skeleton`.
- A "Genera le prossime settimane" action on the week screen, showing what was written, from what source (AI or rules), each week's reason, and any conflict with a locked session.

## Capabilities

### New Capabilities
- `plan-generation`: the skeleton, the generation window, the model's brief and output contract, the check-and-retry loop, the fallback composer, the write through locks, the API and the week-screen action.

### Modified Capabilities
- `plan-limits`: a week in a multi-week window is compared against the highest of the up to 3 planned weeks before it, not only the one just before, so the week after a deload can return to the earlier volume.

## Impact

- **Code**: new `training_plan/plan_skeleton.py` (pure), `training_plan/plan_generator.py` (brief, checks, loop, fallback); a new `plan` role in `llm.py`; routes in `api/routes_plan.py`; schemas; web week screen and `queries.ts`.
- **Database**: one nullable JSONB column on `user_plan` for the stored skeleton.
- **Configuration**: `LLM_PLAN_MODEL` (default: the text model) and `LLM_PLAN_TIMEOUT_S`.
- **Garmin calendar**: unchanged. The generated window is ordinary plan sessions; the existing diff and sync screens push it, and only the window exists as sessions, so only the window can reach the watch.
- **Existing behaviour**: unchanged until the user asks to generate. Imported and hand-written plans keep working.
- **Next changes**: adaptation reuses the generator for a partial window; move warnings and food targets read the same sessions.
