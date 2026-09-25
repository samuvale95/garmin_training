## Context

`training_plan/history.py` owns four tables: `wellness_day`, `activity`, `activity_stream`, `backfill_progress`. Wellness is filled from Garmin; activities and streams only from Strava (`backfill.backfill_activities`, `backfill.backfill_streams`, both called from `backfill.run`). Nothing calls `backfill.run` automatically: it is run by hand.

Readers today: `history.streams_between` and `history.streams_version` (used by `/coach/plan`), `history.activities_between` plus `history.load_streams` (used by `/coach/execution`). All of them assume one source.

Garmin already exposes what is needed. `GarminSync.list_activities` wraps `get_activities_by_date` (one ranged call), and `garminconnect.Garmin.get_activity_details(activity_id, maxchart, maxpoly)` returns per-sample metrics described by a `metricDescriptors` list (`directHeartRate`, `directSpeed`, `sumDuration`, `directTimestamp`, …). This shape is undocumented, like everything else Garmin returns here.

The stream codec (`pack_streams` / `unpack_streams`) is channel-name based and already handles `heartrate`, `velocity_smooth` and `time`, which is all the analysis reads.

## Goals / Non-Goals

**Goals:**
- A Garmin-only user gets the same history, and so the same `/coach` screens, as a Strava user.
- One real workout counts once, whichever sources recorded it.
- The history stays current without anyone running a script.
- No change to the numbers the analysis modules compute, other than what fixing the input causes.

**Non-Goals:**
- Incremental sync of wellness days. Readiness reads today's values live; the wellness backfill stays as it is.
- Downloading FIT files. The detail endpoint is enough for heart rate, speed and time.
- A progress UI for the sync. The first backfill runs in the background; screens show their existing empty states until data arrives.
- Merging summary fields across sources (for example taking Strava's elevation when Garmin's is missing). The canonical row is used as is.
- Supporting Strava-only users differently from today: they keep working, with Strava rows canonical.

## Decisions

### 1. Garmin streams come from the activity detail endpoint, mapped onto the existing channel names

`GarminSync.get_activity_streams(activity_id)` calls `get_activity_details(activity_id, maxchart=MAX_CHART, maxpoly=0)` (no polyline: the GPS track is not used and is the bulk of the payload), reads `metricDescriptors` to find the index of each metric, and returns `{"heartrate": [...], "velocity_smooth": [...], "time": [...]}`. `time` is built from `sumDuration` when present, otherwise from `directTimestamp` relative to the first sample.

Mapping onto Strava's channel names means `pack_streams`, `unpack_streams`, `intensity.time_in_zone`, `intensity.heart_rate_histogram` and `paces.samples_from_streams` need no change.

`MAX_CHART` is set to 10 000 points: about 2 h 45 min at one sample per second. Longer activities come back downsampled. This is acceptable because every consumer weights samples by the `time` gaps rather than counting them, so a downsampled stream still gives correct time-in-zone. It is not perfect for the pace profile, which counts samples; see Risks.

*Alternative considered*: FIT download (`download_activity`). Exact per-second data, but a binary parser as a new dependency and a much larger payload per activity. Not worth it while the detail endpoint gives what the analysis reads.

### 2. Streams are keyed by source

Migration in `history.ensure_schema`, idempotent so it can run on every startup:

```sql
ALTER TABLE activity_stream ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'strava';
-- replace PRIMARY KEY (user_id, activity_id) with (user_id, source, activity_id)
-- only when the current key does not already include source
```

`save_stream`, `load_streams`, `stored_stream_ids` all take a `source`. The default on the column keeps existing rows correct (they were all written by the Strava backfill); new writes always pass the source explicitly.

### 3. Duplicates are resolved at write time and stored, not recomputed on every read

`activity` gains `start_time TIMESTAMPTZ`, `external_id TEXT` and `duplicate_of BIGINT` (the Garmin activity id this row duplicates; `NULL` means canonical). After every sync, `history.resolve_duplicates(user_id, start, end)` recomputes `duplicate_of` for the Strava rows in the synced window:

1. `external_id` of the form `garmin_ping_<id>` / `garmin_push_<id>` naming a stored Garmin activity: duplicate.
2. Otherwise, a Garmin activity of the same sport family whose `start_time` is within 2 minutes and whose duration is within 10%: duplicate. If several match, the closest start time wins.
3. Otherwise: canonical.

Garmin rows are always canonical. Only Strava rows can point to a Garmin row.

Why store it: readers stay plain SQL (`WHERE duplicate_of IS NULL`), the decision is inspectable in the database, and re-running the pass is cheap and deterministic. Resolving at read time would put the matching logic inside every query.

Existing Strava rows have no `start_time` or `external_id`. The first sync after deploy re-lists Strava activities over the full backfill window (one ranged call, already how `backfill_activities` works) and the upsert fills both columns.

Sport family is a small mapping in `history` (`run`, `ride`, `swim`, `other`) covering both Strava `sport_type` values and Garmin `typeKey` values. Matching across families is never allowed.

### 4. Readers read canonical rows, with a stream fallback

`streams_between` selects canonical activities in the window and, for each, the stream of the canonical row or, when that is missing, the stream of a row that duplicates it. `activities_between` gains a `canonical_only=True` default. `streams_version` includes `source` rows in its count, so a new Garmin stream still changes the cache key.

### 5. Incremental sync on app open, throttled and single-flight

New endpoint `POST /history/sync`, called by the web app once when the authenticated layout mounts. It returns immediately and runs in a background thread:

- If the user has no stored Garmin activities, it runs the full backfill (730 days, activities then streams, Garmin then Strava).
- Otherwise it runs an incremental pass over the last `INCREMENTAL_DAYS = 7`: list activities from both sources, fetch streams only for ids not yet stored, resolve duplicates.

Throttle and single-flight in one step: `history.claim_sync` does a conditional upsert on the `("<user>", "sync")` row of `backfill_progress` and only succeeds when no sync is marked running and the last one finished more than `SYNC_THROTTLE_S = 30 min` ago. A sync still marked running after `SYNC_STALE_S = 3 h` is treated as belonging to a dead process and can be reclaimed. `release_sync` marks it finished, on success and on failure.

*Changed during implementation*: the first version of this design used `pg_try_advisory_lock`. A session-level advisory lock has to hold one pooled connection for the whole run -- up to an hour for the first backfill -- while the run itself needs connections from the same pool. The row claim holds nothing between statements and survives a restart as a visible state instead of a vanished lock.

Full versus incremental is decided by whether the history has any *Garmin* activity yet, not any activity: an account whose history was filled from Strava before this change still needs the full pass once, which is also what fills in the Strava start times duplicate matching needs.

The thread reuses `backfill.run`'s structure (one tokenstore materialisation per provider per run). A missing Strava connection skips the Strava half silently.

After a sync that stored something, the per-user `coach:*` cache entries are invalidated. `/coach/plan` would pick the change up through `streams_version` anyway; `/coach/execution` would not.

### 6. Rate limits stop the run

`GarminRateLimitError` during a detail fetch ends the run: progress is already written per activity, and the next throttled sync resumes. The existing `_with_retry` ladder is kept for transient errors but not applied to rate limits. Pause between Garmin detail calls: `GARMIN_DETAIL_PAUSE_S = 2.0`, the same order as the Strava stream pause.

### 7. Running sport keys

`intensity.RUNNING_SPORTS` gains `trail_running`, `treadmill_running`, `track_running`, `indoor_running`, `street_running`, `virtual_run`. It stays a tuple of exact keys: the zones are anchored on a running threshold, and an explicit list keeps a new Garmin sport out until someone decides it belongs.

## Risks / Trade-offs

- **Undocumented detail shape** → the first task reads one real activity and pins the shape in a fixture-based test before anything is written to the database. The parser returns `None` for anything it does not recognise, and the activity is stored without a stream, never with a wrong one.
- **Downsampling on long activities biases the pace profile slightly** (each sample counts once, whatever its duration) → acceptable for now: long activities are mostly long runs at easy effort, and the effect is a small weight shift, not a wrong pace. Revisit if `MAX_CHART` turns out to be lower than Garmin actually honours.
- **First backfill traffic**: a two-year history of ~400 activities is ~400 detail calls at 2 s, about 15 minutes → acceptable in the background, and newest-first means the recent part lands first.
- **Numbers shift for users who had Strava only in the history** → expected: the same workout now reads from Garmin's stream. The change is the input getting more complete, not a formula changing.
- **Background thread is lost on restart** → the sync is resumable and re-triggered on the next app open; nothing is lost but time.
- **Primary key change on a live table** → done in one transaction inside `ensure_schema`; the table is small (megabytes, see the `history.py` docstring), so the lock is brief.
