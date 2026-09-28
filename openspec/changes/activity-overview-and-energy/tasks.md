## 1. History

- [x] 1.1 `activity.calories` and `calories_source` columns; Garmin and Strava ingest store them.
- [x] 1.2 Duplicate matching by overlap; tests; re-resolve existing rows.
- [x] 1.3 `history.activities_between` (canonical, all sports).

## 2. Energy

- [x] 2.1 `training_plan/energy.py`: per-activity kcal with source, day estimate, balance, level-1 sentences.
- [x] 2.2 Garmin day calories, cached; `GET /energy/day`; `GET /activities`.
- [x] 2.3 Fuelling load from the whole day.
- [x] 2.4 Tests.

## 3. Web

- [x] 3.1 Week screen "fuori piano" cards.
- [x] 3.2 Fuel screen energy card (numbers from level 2, words at level 1).
- [x] 3.3 Typecheck, lint, build.

## 4. Verify

- [x] 4.1 Real account: activities of the last week, energy of the long-run day; the swim duplicate resolved; `uv run pytest`. *(re-resolved the whole history: 373 duplicates, up from 371 -- the 6 January swim and one more; 9 recent Garmin activities now carry calories; 26 September: Garmin 4,306 kcal, our estimate 4,097 (-5%), the 122' run 1,632 kcal measured)*
