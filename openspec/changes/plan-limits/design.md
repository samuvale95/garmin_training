## Context

After `server-owned-plan`, sessions are rows (`plan_store`) shaped like `models.TrainingSession`. After `athlete-level`, `levels.assess` gives the effective level (one lower in `pausa` / `ripresa`), and `history.daily_training` gives per-day sessions and running minutes from the canonical history.

Two classifiers already exist and are kept for their own jobs: `nutrition.classify_load` sizes fuelling (`riposo` … `molto_lungo`), `readiness.session_demand` sizes today's readiness advice. Neither separates a long run from intervals, which is the distinction most rules turn on, and both are tuned for their own purpose. The helpers under them are reusable: `models.session_duration_minutes`, `models.flatten_steps`, `nutrition.has_quality_work`, `models.session_fallback_pace`, `nutrition.QUALITY_PACE_DELTA_SEC_PER_KM`.

## Goals / Non-Goals

**Goals:**
- One pure function: `(sessions, context) -> violations`, testable without a database, fast enough to run on every AI attempt and every move.
- Rules as data: key, thresholds per level, evidence, `warn_on_move`, message template. Retuning is editing a table.
- Messages that carry the user's numbers and the limit's origin, because they will be shown to the user as they are (§0.5).

**Non-Goals:**
- Repairing a plan. The validator says what is wrong; the generator (next change) regenerates with the violations as feedback, and phase 1's "Adatta" builds a softer session. A repair step here would be a second planner.
- Nutrition limits. They belong to the nutrition change of phase 2; `nutrition.py` already computes targets.
- Any screen. The API is for the generator and for inspecting a real plan.
- Heart-rate-based rules on planned sessions: a planned session has paces and durations, not a heart rate.

## Decisions

### 1. `session_kind` from structure

```
running + (repeat block, or ≥ 5 min fast work)  -> qualità   (hard)
running + ≥ 90 min                               -> lungo     (hard)
running                                           -> facile
strength_training                                 -> forza
anything else                                     -> altro
```

`lungo` and `qualità` are hard. `forza` and `altro` count as sessions (for rest days) but not as running minutes or hard days. A session with no steps (a bare Garmin entry) is `facile` with zero minutes: unknown content is not evidence of a hard day, and the rules that care about minutes will simply not see it.

### 2. Thresholds (first cut)

| key | evidence | warn_on_move | L1 | L2 | L3 |
|---|---|---|---|---|---|
| `volume_growth` | prudenza | no | +10% | +15% | +20% |
| `hard_in_a_row` | consenso | yes | 1 | 2 | 2 |
| `hard_after_long` | consenso | yes | no | no | allowed |
| `hard_per_week` | consenso | yes | 1 | 2 | 3 |
| `rest_days` | consenso | no | 2 | 1 | 1 |
| `easy_share` | ricerca | no | 90% | 80% | 75% |
| `long_run_growth` | prudenza | no | +15% | +15% | +15% |
| `deload` | consenso | no | 80% | 80% | 85% |

Why these `warn_on_move` choices: a move changes the order of days, which is exactly what `hard_in_a_row`, `hard_after_long` and (across a week boundary) `hard_per_week` are about. Volume and easy share do not change when a session changes day. `rest_days` is about recovery over a week, not a danger that a single move creates. The 10%-a-week rule is folk wisdom with weak evidence — fine as a conservative limit for a generator, not honest as a warning.

### 3. Thin history uses a starting allowance

Weeks are Monday-based, as in `levels`. For volume: if fewer than 2 of the last 4 complete weeks had any running, the limit is a per-level allowance (L1 90, L2 150, L3 240 minutes/week); otherwise `max(recent × (1 + growth), recent + 20)` — the `+ 20` lets a very small base grow at all. For the long run: no run in 8 weeks → allowance (L1 45, L2 70, L3 100 minutes); otherwise `max(longest × 1.15, longest + 10)`.

Volume growth compares each planned week to the recent average; in a multi-week window each later week compares to the previous planned week, so a three-week block cannot compound +10% three times on top of history without it being visible week by week.

### 4. Easy share at step level

Within a `qualità` session each step is hard if it has a pace faster than the session's easy pace by `QUALITY_PACE_DELTA_SEC_PER_KM`, or is an `interval` step with no pace; warm-up, recovery, cool-down and easy-paced steps are easy. `facile` and `lungo` are all easy time. This is what makes a normal interval session (15' + 6×3' + 10') count 18 hard minutes, not 55.

### 5. Deload

Only on windows of 4 weeks or more: after three consecutive weeks each with more running minutes than the one before, the fourth must be at most 80% (85% at L3) of the third. Short windows (the 2–3 week detail of the AI plan) are checked against the skeleton by the generator, not here.

### 6. Data shapes

```python
@dataclass
class RuleContext:
    effective_level: int
    recent_weekly_minutes: float | None      # None: thin history
    recent_longest_run: float | None
    today: date

@dataclass
class Violation:
    key: str
    message: str            # Italian, with numbers
    limit: float
    measured: float
    level: int
    evidence: str           # ricerca | consenso | prudenza
    warn_on_move: bool
    sessions: list[str]     # ids when present, else dates
    dates: list[date]
```

`validate(sessions, context, *, only_move_warnings=False) -> list[Violation]`.

`build_context(user_id, today)` in the same module, reading `history.daily_training` (4 weeks for volume) plus one new query for the longest canonical run of the last 8 weeks, and `levels.assess` for the effective level.

### 7. API

`POST /plan/validate` with an optional `{sessions: [...]}` body. Without sessions: `plan_store.list_sessions` filtered to today … today + 21 days. Response: `{context, violations}`. The threshold read for the level reuses `routes_coach._zones`, as `/profile/level` does; the call is cached there.

## Risks / Trade-offs

- **Thresholds are a first cut**, from coaching consensus and the brainstorming, not tuned on users → they live in one table with the evidence next to each; every violation names its limit so a wrong one is visible the first time it fires.
- **Structure-based kinds can misread a session** (a hilly easy run with no paces reads as `facile`) → the validator errs towards not flagging, which for a generator limit is the safe direction only if the generator writes paces. The generator change will require paces on every running step it writes.
- **`hard_per_week` on a move across weeks** can fire on the week the session leaves as well as the one it joins → only the week that gains the session is reported.
- **The long-run limit follows the longest recent *run*, whatever kind of run it was.** On the real account that is a 16 km mountain run of 3 h 05, which puts the long-run limit at 213 minutes — far above any road long run the account has done. Measuring by time is what the plan speaks (sessions are time-based), and a mountain day is genuinely that much time on the feet, so the rule is not wrong; it is loose for a road block. If it proves too loose, the fix is to take the longest *road* run, or the 90th percentile of recent runs, not to switch to distance.
- **Sessions with no steps are invisible to the minute-based rules.** The example plan `agosto_settembre_2026.yaml` writes its long runs as a title only ("Lungo 15km", no steps): they count as zero minutes, so neither volume nor the long-run cap sees them. For imported plans that is a blind spot the validator cannot close; for the AI plan the generator change must write steps (with paces) on every running session, which closes it.

*Changed during implementation*: the first `session_kind` called any session with fast work `qualità`. On the example plan, "Ritmo costante + allunghi" (2 minutes of strides) became a third hard day every week. Quality now needs a repeat block or at least 5 minutes of fast work.
