## 1. Limits fix

- [x] 1.1 `plan_rules._volume_growth`: base is the higher of the recent average and the highest of the up to 3 planned weeks before; expose `volume_limit(base, context)`.
- [x] 1.2 Test the back-to-volume-after-deload scenario; keep the existing rule tests green.

## 2. Skeleton (pure)

- [x] 2.1 Create `training_plan/plan_skeleton.py` with `SkeletonWeek`, the parameter table and `build_skeleton` (phases, growth, lighter weeks, ceiling, taper, long run, days, quality, reason).
- [x] 2.2 Unit-test every skeleton scenario: race skeleton length and `gara` week, no-goal 3 weeks, athlete 200/220/240/190/265, beginner 60/65/70, L1 no quality, habit caps days.
- [x] 2.3 Store and reuse: `user_plan.skeleton` column, load/save helpers, reuse rule (goal, level, coverage, explicit).

## 3. Generator

- [x] 3.1 Factor the pace profile out of `/coach/plan` into a cached helper; pace bands from it (decision #5).
- [x] 3.2 Window and window targets (decision #3), current-week minutes done, locked sessions, race session.
- [x] 3.3 `check(proposal, window)`: shape, dates, sport, one per day, locked days, paces, weekly bounds, days, quality, long run, `plan_rules.validate`.
- [x] 3.4 `llm.compose_plan` role and the brief (system prompt + facts JSON).
- [x] 3.5 Attempt loop with feedback, 3 attempts, 150 s budget.
- [x] 3.6 Fallback composer (decision #8).
- [x] 3.7 `generate(user_id, today, *, regenerate_skeleton)` writing through `replace_unlocked`.
- [x] 3.8 Tests: checks (invented pace, no-profile pace, rule violation blocks), retry succeeds on attempt 2, no model gives `regole`, fallback passes checks for each level with and without bands, locked session survives, Sunday window.

## 4. API

- [x] 4.1 Schemas for the skeleton week and the generation result.
- [x] 4.2 `POST /plan/generate` with per-user lock (409) and cache invalidation; `GET /plan/skeleton`.
- [x] 4.3 Route tests with the generator faked.

## 5. Web

- [x] 5.1 `useGeneratePlan` in `queries.ts` (adopts the server plan on success; the summary uses the response, so no skeleton query is needed yet).
- [x] 5.2 Week screen: button, confirmation with dates, pending state, summary (source, reasons, conflicts). *(added after review: the state lives in the mutation cache so the wait and the summary survive leaving the week; the days being rewritten refuse moves while it runs; the wait shows the app's run, ride and gym illustrations in turn, with the phase and elapsed time)*
- [x] 5.3 `npm run build` and lint pass. *(built with `next build --webpack`: Turbopack has no native bindings on this machine)*

## 6. Verify

- [x] 6.1 Generate against the real account (rolled-back transaction): read the skeleton and the window for plausibility, with the model and with the fallback. *(level 3, 167 min/week, Venice marathon on 25 Oct: window 29 Sep - 18 Oct at 185 / 205 / 155 minutes. Model: accepted on attempt 2 in 43 s, the first rejected for volume over the maximum and a quality session longer than the long run. Found and fixed: three running days a week were all hard (quality now at most days - 2), the long run was too short at 3 days a week (share now by days), the fallback's quality session could be longer than the week's long run, and tiny weeks under their minimum.)*
- [x] 6.2 Run `uv run pytest`. *(596 passed; the same 22 pre-existing failures in test_db, test_api, test_api_caching, test_api_nutrition)*
