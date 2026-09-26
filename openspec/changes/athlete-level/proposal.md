## Why

Passo is meant for users from their first run to athlete level (`BRAINSTORM-miglioramenti-e-gamification.md` §0.3), but today it speaks to everyone as if they were an athlete: lactate threshold, grey zone, a sensitivity table at ±11 bpm. Every phase-1 feature (check-in, rescheduling warnings with per-level thresholds, the weekly summary) and the phase-2 AI plan need to know which of the three levels a user is at. This change gives the app that answer, computed from the history the previous change made complete, and nothing else yet.

## What Changes

- A new deterministic level for each user: **1 abitudine**, **2 struttura**, **3 atleta**, computed from the stored activity history and the Garmin threshold estimate. Same input, same level, explainable criterion by criterion.
- The level is a high-water mark: once reached it is kept. Users are never demoted.
- A **pausa / ripresa** state instead of demotion: after a long stop the level stays, but for a few weeks the app should treat the user as one level lower (the *effective level*), so warnings and loads are sized for someone coming back.
- Consistency counts every sport; levels 2 and 3 also require running with heart rate, because zones and every analysis are anchored on a running threshold.
- The level cannot be chosen by hand. A user with an existing Garmin history is classified straight away from the backfill.
- A per-user **adaptation mode** (`automatico` / `proposta`), defaulting from the level (automatic at level 1, proposal at level 3) and overridable. Stored now; it takes effect when the AI plan adaptation exists (phase 2).
- An API that returns the level, the effective level, the state (`attivo` / `pausa` / `ripresa`), each criterion measured against its requirement, and what is missing for the next level.
- A settings screen showing the level, what it means, and the progress to the next one.

## Capabilities

### New Capabilities
- `athlete-level`: how the level, the effective level and the pause/return state are computed from the history, how the level is kept, what the API exposes, and the adaptation-mode preference.

### Modified Capabilities
<!-- None: openspec/specs/ has no archived capabilities yet. -->

## Impact

- **Code**: a new pure module `training_plan/levels.py`; weekly aggregation in `training_plan/history.py`; a new table for the per-user profile; new routes in `training_plan/api/`; a settings row and a level screen in `web/`.
- **Database**: one new table (`athlete_profile`), created through `history.ensure_schema`.
- **External APIs**: none new. The Garmin threshold read already exists (`sync.lactate_threshold`) and is cached.
- **Other features**: none change behaviour in this change. `/coach` screens keep working as today at every level; gating them by level is phase-1 work that reads this API.
