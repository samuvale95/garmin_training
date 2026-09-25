## ADDED Requirements

### Requirement: Garmin is the primary source of the activity history
The system SHALL store, for every user with a connected Garmin account, a summary row and the heart-rate, speed and time streams of each completed Garmin activity, without requiring a Strava connection.

#### Scenario: Garmin-only user gets a history
- **WHEN** a user with Garmin connected and Strava not connected has completed activities in the backfill window
- **THEN** each activity is stored with `source = 'garmin'`, its start time, sport, duration and distance, and its streams are stored when Garmin returns them

#### Scenario: Garmin activity without a heart-rate stream
- **WHEN** Garmin returns an activity whose detail has no heart-rate channel
- **THEN** the summary row is stored and no stream is stored for it, and the backfill continues with the next activity

### Requirement: Strava is an optional secondary source
The system SHALL keep storing Strava activities and streams when Strava is connected, and SHALL NOT require Strava for any history feature.

#### Scenario: Both sources connected
- **WHEN** a user has both Garmin and Strava connected
- **THEN** activities from both are stored, each row tagged with its source

#### Scenario: Strava not connected
- **WHEN** the backfill or incremental sync runs for a user without Strava
- **THEN** it completes using Garmin only and reports no error for the missing Strava connection

### Requirement: Streams of different sources never overwrite each other
The system SHALL key stored streams by `(user_id, source, activity_id)`, and SHALL migrate streams stored before this change as `source = 'strava'` without data loss.

#### Scenario: Same numeric id from two sources
- **WHEN** a Garmin activity and a Strava activity of the same user share the same numeric id
- **THEN** both streams are stored and each is read back unchanged

#### Scenario: Existing streams survive the migration
- **WHEN** the schema migration runs on a database with streams written by the previous Strava-only backfill
- **THEN** every existing stream is still readable, tagged `source = 'strava'`

### Requirement: The same workout from two sources is counted once
The system SHALL recognise a Strava activity as a duplicate of a Garmin activity when Strava's `external_id` names that Garmin activity, or, failing that, when both have the same sport family, start times within 2 minutes of each other and durations within 10% of each other. When a duplicate is recognised, the Garmin row SHALL be the canonical one.

#### Scenario: Garmin-uploaded activity on Strava
- **WHEN** a stored Strava activity has an `external_id` referencing a stored Garmin activity id
- **THEN** the Strava row is marked as a duplicate of the Garmin row

#### Scenario: Match by start time and duration
- **WHEN** a Strava activity has no usable `external_id`, and a Garmin activity of the same sport family starts within 2 minutes and lasts within 10% of it
- **THEN** the Strava row is marked as a duplicate of the Garmin row

#### Scenario: Two different workouts on the same day
- **WHEN** a Garmin run at 07:00 and a Strava run at 18:00 fall on the same day
- **THEN** neither is marked as a duplicate and both count

#### Scenario: Activity only on Strava
- **WHEN** a Strava activity matches no Garmin activity (for example it was recorded on a phone)
- **THEN** it is canonical and counts

### Requirement: Readers see one row per real workout
The system SHALL return only canonical activities from every history read used for analysis, and SHALL fall back to a duplicate's stream when the canonical activity has no stream.

#### Scenario: Distribution over a history with duplicates
- **WHEN** `/coach/plan` reads a history where every run exists on both Garmin and Strava
- **THEN** each run contributes to the distribution exactly once

#### Scenario: Canonical activity without a stream
- **WHEN** the Garmin row is canonical but its stream fetch failed, and the duplicate Strava row has a stream
- **THEN** the reader uses the Strava stream for that workout

### Requirement: The history stays current without manual runs
The system SHALL run an incremental sync of the most recent days when the user opens the app, at most once per throttle interval per user, and SHALL start a full backfill automatically when a user with a connected Garmin account has no stored activities.

#### Scenario: App opened after a new run
- **WHEN** the user opens the app after the throttle interval and a new activity exists on Garmin
- **THEN** the activity and its streams are stored in the background, and the next read of the history includes it

#### Scenario: App opened twice in a row
- **WHEN** the user opens the app again within the throttle interval
- **THEN** no new sync runs

#### Scenario: New user
- **WHEN** a user with Garmin connected and no stored activities opens the app
- **THEN** a full backfill starts in the background, newest activities first

### Requirement: Backfill is polite to Garmin and resumable
The system SHALL fetch Garmin activity details with a pause between calls, newest first, SHALL skip activities whose streams are already stored, and SHALL treat a rate-limit response as a reason to stop the run and resume later rather than to retry immediately.

#### Scenario: Interrupted backfill
- **WHEN** a backfill is interrupted after storing part of the history
- **THEN** the next run skips the stored activities and continues with the missing ones

#### Scenario: Garmin rate limit
- **WHEN** Garmin answers a detail call with a rate-limit error
- **THEN** the run stops, the progress so far is kept, and no further Garmin call is made in that run

### Requirement: Garmin running activities count as running
The system SHALL treat Garmin's running sport keys (at least `running`, `trail_running`, `treadmill_running`, `track_running`) as running wherever the analysis filters by running.

#### Scenario: Trail run from Garmin
- **WHEN** a Garmin activity with sport `trail_running` and a heart-rate stream is in the analysed window
- **THEN** it is included in the running distribution and in the pace profile
