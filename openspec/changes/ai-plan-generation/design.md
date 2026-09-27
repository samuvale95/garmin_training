## Context

- Sessions live in `plan_session` (`plan_store`), with `locked` for hand edits and `replace_unlocked(user_id, start, end, sessions, origin="ai")` as the one bulk path for non-user writers.
- `plan_rules.validate(sessions, context, start=, end=)` returns every rule a window breaks; `plan_rules.build_context` reads recent volume, longest run and effective level from the history.
- `levels.assess` gives the effective level; `history.daily_training` gives per-day running minutes.
- The goal lives in `user_plan.goal` or `user_goal` (`db`), shaped like `models.RaceGoal`.
- The athlete's paces come from `paces.build_profile`, computed today inside `/coach/plan` from the streams and the Garmin threshold; `prescription.py` already turns them into sessions (`easy_run`, `cruise_intervals`, `vo2_intervals`).
- `llm.py` is the only module that talks to a model: OpenRouter, `httpx`, and every call returns `None` instead of raising.

## Goals / Non-Goals

**Goals:**
- A plan the user can ask for in one tap, written from their own numbers, that never breaks a `plan-limits` rule.
- Every number that bounds the plan is computed by code: weekly minutes, longest run, days, quality count, pace bands. The model picks and orders sessions and writes their words.
- Generation works with no model at all.

**Non-Goals:**
- Adapting the plan after events (check-in, missed session, low readiness). That is the next change; it will reuse the generator on a partial window.
- Strength or cross-training sessions. Running only; `forza` stays a user-added session.
- Pushing the window to Garmin automatically. The existing diff and sync screens do that.
- Proposal mode (review before write). Generation is an explicit user action, so it writes; the `adaptation_mode` setting applies to the adaptation change.
- Food targets tied to the plan.

## Decisions

### 1. Skeleton in code, not in the model

The skeleton is arithmetic on known inputs. Asking a model for it would put the numbers that matter most (how much, how fast it grows, when it steps back) in the one place we cannot recompute by hand. `plan_skeleton.py` is pure: `build_skeleton(inputs) -> list[SkeletonWeek]`.

```python
@dataclass
class SkeletonWeek:
    monday: date
    phase: str              # base | costruzione | picco | scarico | gara | costanza
    target_minutes: int
    long_run_minutes: int
    quality_sessions: int
    running_days: int
    lighter: bool
    reason: str             # Italian, with the user's numbers
```

The numbers (first cut, in one table like `plan_rules.RULES`):

| | L1 | L2 | L3 |
|---|---|---|---|
| starting volume, thin history | 60 | 100 | 160 |
| growth per building week | 5% | 7% | 10% |
| lighter week (every 4th) | 75% | 75% | 80% |
| running days range | 2–4 | 3–5 | 3–6 |
| volume ceiling, no goal | 150 | 240 | 360 |

The growth rates are half the `volume_growth` limits: the skeleton leaves room for the model to be 5% over a target without breaking a rule. The lighter week is 5 points under the `deload` limit for the same reason. The volume ceiling with a goal is by distance (≤ 5 km 210, ≤ 10 km 270, ≤ 21.1 km 330, longer 420 minutes) times 0.5 / 0.75 / 1.0 by level, never below the starting volume. The longest run is a share of the week's target that depends on the running days (45% at 3 days, 40% at 4, 35% at 5 or more: with few runs the long one is naturally a bigger part of the week), capped by distance (70 / 90 / 120 / 180 minutes) or, with no goal, by level (60 / 90 / 120). Phases with a goal use `models.race_phase` on each week's Monday, with the last two weeks forced to taper (75%, then 50% with the race).

Alternative considered: the model writes the skeleton and the code validates it. Rejected: the validation would need exactly this arithmetic to decide what "too much" is, so the model would add nothing but a chance to fail.

### 2. Stored skeleton with its inputs

`user_plan.skeleton JSONB` holds `{inputs, weeks}`, where `inputs` is the goal, the effective level and the start week. A later generation reuses it unless the goal or level differs, the weeks do not cover the window, or `regenerate_skeleton` is set. Stored, not recomputed each time, because recomputing from recent history every two weeks would re-base the progression on whatever the user happened to do, and the block would never build. The drift the other way (skeleton ahead of the user) is handled by decision #3.

### 3. Window targets are capped by today's limits

The window target of a week is `min(skeleton target, plan_rules volume limit for that week)`. This needs the limit as a function, so `plan_rules` exposes `volume_limit(base, context)` and the generator uses the same function the validator does. For the week containing today, the minutes already run (from `daily_training`) are subtracted, and the same minutes enter validation as one synthetic easy session per training day, so the volume rules see the whole week.

### 4. `plan-limits` fix: compare to the highest recent planned week

`_volume_growth` compares each week to `max(previous week, recent average)`. After a lighter week that makes the return to the earlier volume a growth violation, which the skeleton's own cycle would trigger every fourth week. The base becomes `max(recent average, highest of the up to 3 planned weeks before)`. It does not allow compounding: each week can still grow only by the limit over something already planned.

### 5. Pace bands

The pace profile computed inside `/coach/plan` is factored into a cached helper, so the generator and the coach screen read the same numbers without a second pass over the streams. From a profile with both easy and threshold paces:

- `facile`: easy × `prescription.EASY_PACE_SLOWDOWN`, ± 15 s
- `soglia`: threshold ± 8 s
- `veloce`: threshold × `prescription.VO2_PACE_FACTOR`, ± 8 s

A step's pace is allowed between the fastest `veloce` bound and 45 s slower than the slowest `facile` bound (warm-up and recovery jogs are slower than easy running). Without both paces there are no bands, and running steps carry no pace: an invented pace is a number nobody can recompute.

### 6. The model call

A third role in `llm.py`: `compose_plan(messages) -> str | None`, model `LLM_PLAN_MODEL` (default the text model), timeout `LLM_PLAN_TIMEOUT_S` (90 s), JSON mode, 6000 max tokens. The brief is a system prompt in Italian (the role, the rules in words, the output contract, "non inventare ritmi fuori dalle fasce") plus the facts as JSON. The generator owns the loop, not `llm.py`: it needs the checks between attempts, and `llm.py` stays a transport.

The output is parsed with the plan API's own schema (`schemas.TrainingSessionIn`), so the model writes exactly what a client writes, and a pace format or step shape error is caught by the same code that catches it for a client.

### 7. Checks, then retry with the messages

`plan_generator.check(proposal, window) -> list[str]` returns Italian messages; empty means accepted. Structural checks first; rules only on a structurally valid proposal (a missing step makes rule messages noise). On failure, the next attempt appends the model's previous answer and a user turn with the messages. At most 3 attempts, and none starts after 150 s in total, so the worst case is about three and a half minutes with a slow model and the usual case is one call.

### 8. Deterministic fallback composer

`plan_generator.compose_fallback(window)`: per week, running days on a fixed pattern by count (2: Wed Sun; 3: Tue Thu Sun; 4: Tue Thu Sat Sun; 5: Tue Wed Thu Sat Sun; 6: Mon Tue Wed Thu Sat Sun), skipping days before the window and days held by locked sessions. Long run on the last day, quality on Tuesday then Thursday (never adjacent to each other or to the long run's next day), built from `prescription.cruise_intervals` and `vo2_intervals` when bands exist, or as pace-less repeat blocks otherwise. The remaining minutes are split over the easy days, rounded to 5, at least 20 each (days dropped if they cannot reach 20). It goes through the same checks. It exists so a plan never depends on a model, and it doubles as a test that the skeleton is satisfiable: a skeleton the composer cannot fill is a skeleton bug.

### 9. Race day

When the race day falls in the window, the code writes the race session itself (title "Gara: <name>", one distance step of the goal distance, paced from the target time when there is one) and hands it to the model as fixed, like a locked session. The race is not the model's to schedule.

### 10. API and concurrency

`POST /plan/generate` runs in the thread pool and returns when done; a per-user in-process lock refuses a second concurrent call with 409. No job store: the call is bounded (decision #7), the result is small, and the only client waits for it. The API runs as a single process, so an in-process lock is enough. After a write, the plan caches are invalidated the way `PUT /plan` does.

### 11. Web

A button on the week screen opens a confirmation ("sostituisce le sedute da domani al <data>; quelle modificate a mano restano"), then a pending state ("può volerci un minuto"), then a summary: source, each week's `reason`, conflicts. The mutation invalidates the plan query so the new sessions appear without a reload.

## Risks / Trade-offs

- **Model quality on nested JSON** → shape errors are caught by the API schema and fed back; the fallback covers a model that never gets it right. The response says which source wrote the plan, so a poor model is visible.
- **Skeleton numbers are a first cut** → one table, each week's `reason` shows the numbers, so a bad value is visible the first time it matters.
- **A hard session done today is invisible to the day-order rules** (history rows become synthetic easy sessions) → a hard day tomorrow after a hard today can pass at L1/L2. Accepted for this change; the move-warnings work will read session kinds from the history.
- **Generation replaces imported sessions in the window** → the confirmation says so; locked sessions stay; the file can be re-imported.
- **Latency** → usually one call, bounded at about 3.5 minutes worst case; the button says it can take a minute.
- **In-process lock** → fine for the single API process; a second instance would need a row claim like `history.claim_sync`.

## Migration Plan

`ALTER TABLE user_plan ADD COLUMN IF NOT EXISTS skeleton JSONB` in the existing idempotent `db.ensure_schema`. No backfill. Rollback: the column is ignored by older code.

## Open Questions

- Default model for the plan role: the text model (DeepSeek v3.2) is cheap and handles JSON; if its plans read poorly, switch `LLM_PLAN_MODEL` without a code change.

*Changed during implementation*: on the real account (3 running days a week) the first skeleton made every run hard -- two quality sessions plus the long run. Quality is now capped at running days minus 2, and the long run's share of the week grows as the days shrink. The model's output uses the plan file's format (`parser.parse_sessions`) rather than the API's, so the paces are `M:SS` strings the model writes naturally, checked by the same code that checks an imported file. Errors from `POST /plan/generate` use `schemas.ErrorResponse`, which the web client already reads.
