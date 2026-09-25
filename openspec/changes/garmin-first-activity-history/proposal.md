## Why

The stored activity history — the thing `/coach/plan`, the zones, the pace profile and every future trend read from — is written only from Strava (`training_plan/backfill.py`). A user who has a Garmin watch and no Strava account, which is exactly the user Passo is for ("semplificare l'utilizzo dell'orologio Garmin", see `BRAINSTORM-miglioramenti-e-gamification.md` §0), has no history at all and gets empty screens. The history is also only ever filled by running the backfill by hand, so even a connected user's data stops at the last manual run. This is phase 0 of the priorities: nothing about consistency, levels or an AI plan can work on top of a history that is missing or stale.

## What Changes

- Garmin becomes the primary source of the stored history: activity summaries and per-second heart-rate/speed/time streams are fetched from Garmin Connect and written to the same `activity` / `activity_stream` tables the readers already use.
- Strava stays supported but optional: when connected, its activities are stored too, and used where Garmin has nothing (an activity recorded on another device, or a Garmin detail fetch that failed).
- The same workout arriving from both sources is recognised and counted once. Matching uses Strava's `external_id` when Garmin uploaded the activity, and start time plus duration otherwise. Garmin wins when both exist.
- **BREAKING (storage)**: `activity_stream` gains a `source` column and its primary key becomes `(user_id, source, activity_id)`, so a Garmin id and a Strava id can never overwrite each other. Existing rows are migrated as `source = 'strava'`. `activity` gains a `start_time` column, needed for matching.
- The history keeps itself current: a short incremental sync (the last few days) runs automatically when the app is opened, throttled per user, and a full backfill starts automatically the first time an account has no history.
- Readers (`history.streams_between`, `history.activities_between` and their callers in `routes_coach.py`) see only one row per real workout.
- Garmin's running sport keys (`running`, `trail_running`, `treadmill_running`, …) count as running in `intensity.RUNNING_SPORTS`.

## Capabilities

### New Capabilities
- `activity-history`: how the stored activity history is filled (sources, backfill, incremental sync), how duplicates across sources are resolved, and what readers of the history are guaranteed to see.

### Modified Capabilities
<!-- None: openspec/specs/ has no archived capabilities yet. -->

## Impact

- **Code**: `training_plan/history.py` (schema, migration, writers, canonical-row readers), `training_plan/backfill.py` (Garmin activity and stream fetch, source-aware stream backfill, incremental mode), `training_plan/garmin_sync.py` (activity detail/stream read), `training_plan/intensity.py` (running sport keys), `training_plan/api/routes_coach.py` (readers), a new history-sync endpoint plus the web call that triggers it on app open.
- **Database**: schema migration on `activity_stream` (primary key change) and `activity` (new column). Runs once at startup through `history.ensure_schema`.
- **External APIs**: more Garmin Connect traffic (one detail call per activity during backfill). Garmin rate-limits by IP and undocumented, so the existing slow, resumable, newest-first rules of `backfill.py` apply to it unchanged.
- **Users without Strava**: go from no history to a full one. Users with both: numbers may shift slightly where Garmin's stream replaces Strava's for the same workout.
