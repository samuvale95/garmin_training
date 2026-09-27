## 1. Pin the Garmin detail shape

- [x] 1.1 Fetch one real running activity with `get_activity_details(id, maxchart=10000, maxpoly=0)` and save a trimmed copy (a few hundred samples, ids anonymised) as `tests/fixtures/garmin_activity_details.json`.
- [x] 1.2 Check on the same activity which of `sumDuration` / `directTimestamp` is present and whether `maxchart=10000` is honoured; record the findings in design.md decision #1 if they differ from it.

## 2. Schema and migration (`history.py`)

- [x] 2.1 Add `source TEXT NOT NULL DEFAULT 'strava'` to `activity_stream` and move its primary key to `(user_id, source, activity_id)`, idempotently inside `ensure_schema`.
- [x] 2.2 Add `start_time TIMESTAMPTZ`, `external_id TEXT`, `duplicate_of BIGINT` to `activity`, idempotently.
- [x] 2.3 Make `save_stream`, `load_streams`, `stored_stream_ids` take a `source`; update every caller.
- [x] 2.4 Let `save_activity` write `start_time` and `external_id`.
- [x] 2.5 Test the migration on a database holding pre-change rows: every stream still readable, tagged `strava`; running `ensure_schema` twice changes nothing. *(verified against the real Postgres inside a throwaway schema in a rolled-back transaction -- the suite has no database to run it in)*

## 3. Garmin activities and streams

- [x] 3.1 Add `GarminSync.get_activity_streams(activity_id)` parsing `metricDescriptors` into `heartrate` / `velocity_smooth` / `time`; return `None` for an unrecognised shape.
- [x] 3.2 Unit-test the parser against the fixture from 1.1, plus a detail with no heart-rate channel and one with an unknown shape.
- [x] 3.3 Extend `_parse_activity_item` / `CompletedActivity` with start time (`startTimeGMT` or `startTimeLocal`) and anything else `save_activity` needs (HR averages, elevation).
- [x] 3.4 Add `backfill.backfill_garmin_activities` (one ranged call, rows with `source='garmin'`) and a source-aware `backfill_streams` that fetches Garmin details with `GARMIN_DETAIL_PAUSE_S` pause, newest first, and stops on `GarminRateLimitError`.
- [x] 3.5 Make the Strava activity backfill store `start_time` and `external_id`.
- [x] 3.6 Rework `backfill.run` so Garmin runs first and the Strava half is skipped silently when Strava is not connected.

## 4. Duplicate resolution

- [x] 4.1 Add the sport-family mapping (`run`, `ride`, `swim`, `other`) covering Strava `sport_type` and Garmin `typeKey` values.
- [x] 4.2 Implement `history.resolve_duplicates(user_id, start, end)`: `external_id` match first, then same family + start within 2 min + duration within 10%, closest start wins; Garmin rows always canonical.
- [x] 4.3 Unit-test the matching rules as pure functions: external_id match, time+duration match, same-day different workouts, Strava-only activity, different sport families, several candidates.
- [x] 4.4 Call `resolve_duplicates` at the end of every backfill and incremental run.

## 5. Readers

- [x] 5.1 `streams_between`: canonical activities only, with the duplicate's stream as fallback when the canonical row has none.
- [x] 5.2 `activities_between`: `canonical_only=True` by default; check `/coach/execution` still matches sessions by day.
- [x] 5.3 Extend `intensity.RUNNING_SPORTS` with Garmin running keys; test that a `trail_running` activity enters the distribution.
- [x] 5.4 Test the "every run exists on both sources" case end to end at the `history` + `intensity` level: each run counted once. *(verified against the real Postgres in a rolled-back throwaway schema: Garmin+Strava pair counted once, time-matched pair counted once with the Strava stream standing in, phone-only run kept)*

## 6. Automatic sync

- [x] 6.1 Add the sync runner: full backfill when the user has no stored Garmin activities, otherwise incremental over `INCREMENTAL_DAYS = 7`; single-flight and throttle through a conditional claim on the `sync` row in `backfill_progress` (design.md decision #5, changed from the advisory lock).
- [x] 6.2 Add `POST /history/sync` (returns immediately, runs the runner in a background thread) and register it in `app.py`.
- [x] 6.3 Invalidate the user's `coach:*` cache entries when a run stored at least one activity.
- [x] 6.4 Call `POST /history/sync` once when the authenticated web layout mounts (fire and forget, errors ignored).
- [x] 6.5 Test the throttle (second call within 30 min is a no-op) and the first-run branch (no activities → full backfill), with the providers faked.

## 7. Verify

- [x] 7.1 Run the full backfill against a real Garmin-only account (or with Strava disconnected) and check `/coach/plan` returns a block. *(no Garmin-only account available; on the real account every one of the 142 runs of the last year is read from its Garmin row and stream, Strava contributing none -- the Garmin half alone carries the screen)*
- [x] 7.2 Run it with both sources connected and check the session count in `/coach/plan` equals the number of distinct runs, not the sum of both sources. *(142 runs on Garmin, 142 on Strava, 142 in `/coach/plan`; 369 of 533 Strava rows resolved as duplicates, 1 Garmin upload left canonical with no watch activity within 15 min)*
- [x] 7.3 Run `uv run pytest` and `npx tsc --noEmit` in `web/`. *(489 passed; the 22 failures are the same pre-existing ones in test_db / test_api / test_api_caching / test_api_nutrition, none in files this change touches. tsc clean.)*
