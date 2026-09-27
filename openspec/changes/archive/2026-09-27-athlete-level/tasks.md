## 1. Level computation (pure)

- [x] 1.1 Create `training_plan/levels.py` with the constants of design.md decision #1, `DayTraining`, `Criterion`, `LevelAssessment` and the level names/meanings in Italian.
- [x] 1.2 Implement weekly bucketing (Monday start, complete weeks only) and the level 2 / level 3 criteria as `Criterion` lists.
- [x] 1.3 Implement the pause/return state and the effective level (decision #2).
- [x] 1.4 Implement `assess(...)`: computed level, high-water mark, missing criteria for the next level, adaptation-mode default.
- [x] 1.5 Unit-test every spec scenario: new user, multi-sport non-runner, runner without threshold, other sports counting, short activities not counting, never lowered, pause, return at day 10, back to normal after 21 days, level 1 in pause, progress report 4 of 6, mode default and override.

## 2. Storage and aggregation (`history.py`)

- [x] 2.1 Add the `athlete_profile` table to `SCHEMA`.
- [x] 2.2 Add `daily_training(user_id, start, end)`: canonical rows of at least 15 minutes, grouped by day into sessions, runs with heart rate and running minutes.
- [x] 2.3 Add `load_profile`, `raise_reached_level` (upsert with `GREATEST`) and `set_adaptation_mode`.
- [x] 2.4 Verify the aggregation and the upserts against the real Postgres in a rolled-back throwaway schema, including that a duplicate Strava row does not add a session.

## 3. API

- [x] 3.1 Add the response and request schemas (`AthleteLevelResponse`, `CriterionOut`, `AdaptationModeRequest`).
- [x] 3.2 Add `GET /profile/level`: aggregates + profile + threshold, `assess`, raise the stored level when higher, cached under `profile:level` keyed on `streams_version`.
- [x] 3.3 Add `PUT /profile/adaptation-mode`; invalidate `profile:level` for the user.
- [x] 3.4 Register the router in `app.py`.
- [x] 3.5 Test the routes with `history`/Garmin faked: level returned, stored level raised only upwards, mode override and reset to default.

## 4. Web

- [x] 4.1 Add the types and the `useAthleteLevel` query.
- [x] 4.2 Add the "Livello" row to the settings screen.
- [x] 4.3 Add `/settings/level`: level and meaning, state note when not `attivo`, criteria rows with measured / required.

## 5. Verify

- [x] 5.1 Compute the level for the real account and check it by hand against the stored history. *(real account: level 3, attivo. Checked by hand against the weekly totals: 7 active weeks of 8 (only 10 Aug empty), 23 runs with HR, 22 of 26 weeks with 3+ sessions, 2159 running minutes over 12 weeks = 180/week, threshold 183 bpm. Computed read-only, profile not written.)*
- [x] 5.2 Run `uv run pytest` and `npx tsc --noEmit` in `web/`. *(522 passed; the same 22 pre-existing failures outside this change. tsc clean.)*
