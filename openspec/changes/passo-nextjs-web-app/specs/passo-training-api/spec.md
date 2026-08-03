## ADDED Requirements

### Requirement: Plan diff preview endpoint
The system SHALL expose an endpoint that accepts a parsed training plan (or raw YAML text, parsed server-side via the existing `parser.py`) and returns the same diff shape `service.preview_plan_sync`/`GarminSync.diff_plan` already compute — sessions to create, already-present sessions, changed sessions (era/ora pairs), and Garmin-only extras — without writing anything to Garmin.

#### Scenario: Diff preview returns categorized sessions
- **WHEN** the frontend submits a plan's parsed sessions to the diff endpoint
- **THEN** the response contains `to_create`, `already_present`, `changed`, and `extra_on_garmin` lists matching `PlanDiff`'s fields, with no Garmin write performed

#### Scenario: Invalid plan YAML is rejected before any Garmin call
- **WHEN** the submitted plan fails `parser.py` validation
- **THEN** the endpoint returns a 4xx response with the same per-line validation errors `TrainingPlanValidationError` carries, and no login/diff call is attempted

### Requirement: Asynchronous plan sync job
The system SHALL perform Garmin writes (create-and-schedule for new sessions, delete-and-recreate for changed sessions) as a background job that starts on request, continues independently of the client connection, and reports progress through a separate status endpoint.

#### Scenario: Starting a sync returns a job id immediately
- **WHEN** the frontend calls the start-sync endpoint with a set of sessions to create and/or replace
- **THEN** the response returns a `job_id` without waiting for the writes to finish

#### Scenario: Job status reflects one-at-a-time progress
- **WHEN** the frontend polls the job-status endpoint for a running job
- **THEN** the response reports the current index, total count, and a per-session outcome (ok/failed-with-reason/pending) for every session processed so far, updated as each session completes — never all-at-once at the end

#### Scenario: Job continues after the client disconnects
- **WHEN** the client that started a job closes its connection or navigates away before the job finishes
- **THEN** the job continues running server-side, and a later status poll (from the same or a new client) reflects its current or final progress

#### Scenario: Cancellation takes effect only between sessions
- **WHEN** the frontend requests cancellation of a running job
- **THEN** the job finishes writing the session currently in progress, then stops before starting the next one, and the status endpoint reflects a cancelled/stopped state with the sessions completed so far

### Requirement: Deletion preview and apply endpoints
The system SHALL expose endpoints mirroring `service.preview_deletion`/`service.apply_deletion`: a preview that lists the scheduled workouts a filter (date range, sport, title substring) would select without deleting anything, and an apply step that deletes exactly the previewed set.

#### Scenario: Preview lists matching workouts without deleting
- **WHEN** the frontend requests a deletion preview with a date range and optional sport/title filter
- **THEN** the response lists the matching scheduled workouts and nothing is deleted from Garmin

#### Scenario: Apply deletes exactly the previewed set
- **WHEN** the frontend applies a deletion referencing a previously returned preview
- **THEN** the endpoint deletes only those workouts and returns a per-workout success/failure result matching `DeleteResult`

### Requirement: Scheduled workout listing endpoint
The system SHALL expose an endpoint wrapping `service.list_workouts` that returns scheduled Garmin workouts in a given date range, for the Week/Session screens' calendar-presence display.

#### Scenario: Listing returns workouts in range
- **WHEN** the frontend requests workouts between two dates
- **THEN** the response returns every scheduled workout in that range with date, sport, title, and identifiers, sorted by date

### Requirement: Garmin connection status endpoint
The system SHALL expose a read endpoint reporting the current Garmin connection state — whether a valid cached session exists, and if not, whether a rate-limit/auth-failure cooldown is active and its remaining seconds — derived from the existing token store and `~/.garmin_training_login_state.json` cooldown file, so the frontend never needs to store this itself.

#### Scenario: Connected state is reported when a cached session exists
- **WHEN** the frontend requests Garmin connection status and a valid cached token exists
- **THEN** the response indicates connected, with no cooldown

#### Scenario: Active cooldown is reported with remaining time
- **WHEN** the frontend requests Garmin connection status during an active rate-limit or auth-failure cooldown
- **THEN** the response indicates not-connected with a `retry_after_seconds` value matching the server-side cooldown record, and the primary connect action must stay disabled client-side until it reaches zero

### Requirement: Garmin credentials are never persisted or echoed to the client
The system SHALL accept Garmin email/password only as request input to the connect endpoint, use them solely to perform `GarminSync.login()`, and never include them (or the resulting session token) in any API response body.

#### Scenario: Successful connection response contains no credential material
- **WHEN** a Garmin connect request succeeds
- **THEN** the response confirms success/connection state only, with no password, raw token, or tokenstore path included

#### Scenario: Failed connection surfaces the existing error categories
- **WHEN** a Garmin connect request fails due to bad credentials or a Garmin-side rate limit
- **THEN** the response distinguishes an authentication failure from a rate-limit failure (matching `GarminSyncError` vs. `GarminRateLimitError`) so the frontend can render screen 02's error state or route to the forced-wait screen accordingly
