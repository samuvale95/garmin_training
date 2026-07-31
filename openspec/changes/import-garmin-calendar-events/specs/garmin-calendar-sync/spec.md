## ADDED Requirements

### Requirement: Garmin Connect authentication
The system SHALL authenticate to Garmin Connect using the `garminconnect` Python library, accepting credentials (email/password) via environment variables or a local `.env` file, and SHALL reuse a cached session token across runs when the library supports it so the user is not required to re-enter credentials or re-solve MFA on every invocation.

#### Scenario: First run with fresh credentials
- **WHEN** the script runs with no cached session and valid credentials are supplied
- **THEN** the system logs in via `garminconnect`, persists the resulting session token locally, and proceeds to sync entries

#### Scenario: Subsequent run with cached session
- **WHEN** the script runs and a valid cached session token exists
- **THEN** the system reuses the cached session without prompting for credentials again

#### Scenario: Authentication failure
- **WHEN** login to Garmin Connect fails (invalid credentials or Garmin rejects the request)
- **THEN** the system reports a clear authentication error and stops before attempting any calendar changes

### Requirement: Workout creation from a training-plan entry
For each parsed and validated training-plan entry, the system SHALL build a Garmin workout definition matching that entry's sport, title, description, and steps (if any), and SHALL create it in the user's Garmin Connect account via the API before scheduling it.

#### Scenario: Simple workout entry
- **WHEN** a training-plan entry has no `steps`
- **THEN** the system creates a single-step Garmin workout for the entry's sport carrying the entry's title and description

#### Scenario: Structured workout entry
- **WHEN** a training-plan entry has one or more `steps`
- **THEN** the system creates a Garmin workout whose step sequence, types, and durations/distances match the entry's `steps` in order

### Requirement: Calendar scheduling
The system SHALL schedule each created workout onto the Garmin Connect calendar on the entry's `date`.

#### Scenario: Successful scheduling
- **WHEN** a workout is created for an entry
- **THEN** the system schedules that workout on the Garmin Connect calendar for the entry's `date` and the workout becomes visible on that day in Garmin Connect

### Requirement: Per-entry result reporting
The system SHALL process all entries in a training-plan file even if one entry fails, and SHALL report, per entry, whether creation and scheduling succeeded or failed (including the Garmin API error message on failure), plus a final summary count of successes and failures.

#### Scenario: Mixed success and failure
- **WHEN** one entry in a multi-entry file fails to create or schedule on Garmin Connect (e.g. a transient API error)
- **THEN** the system continues processing the remaining entries, reports the failed entry with its error, and prints a summary showing how many entries succeeded versus failed

### Requirement: Dry-run mode
The system SHALL support a dry-run mode in which parsed and validated entries are printed as a preview of what would be created/scheduled, without making any create or schedule calls to Garmin Connect.

#### Scenario: Dry-run invocation
- **WHEN** the script is invoked with the dry-run option
- **THEN** the system authenticates (if needed for validation) but performs no workout-creation or scheduling API calls, and instead prints, per entry, the sport, date, title, and step summary that would have been sent

### Requirement: List existing calendar workouts
The system SHALL support listing workouts/events currently scheduled on the user's Garmin Connect calendar, optionally restricted to a date range, and SHALL display for each one at least its date, sport, title, and a stable identifier usable for later deletion.

#### Scenario: List all workouts in a date range
- **WHEN** the user requests a listing with a start and end date
- **THEN** the system fetches and displays every Garmin Connect calendar workout scheduled within that range, in date order

#### Scenario: Empty result
- **WHEN** no workouts are scheduled within the requested range
- **THEN** the system reports that no matching workouts were found rather than failing

### Requirement: Select a subset of existing workouts for deletion
The system SHALL allow the user to select a subset of the listed workouts by date range, sport, and/or a case-insensitive substring match on the title, and SHALL support combining these filters.

#### Scenario: Filter by date range and sport
- **WHEN** the user specifies both a date range and a sport filter
- **THEN** the system selects only workouts within that range whose sport matches

#### Scenario: Filter by title match
- **WHEN** the user specifies a title substring
- **THEN** the system selects only workouts whose title contains that substring (case-insensitive)

#### Scenario: No filters match
- **WHEN** the combined filters match zero workouts
- **THEN** the system reports zero workouts selected and performs no deletion

### Requirement: Confirm before deleting
The system SHALL show the user the full list of selected workouts (date, sport, title) and SHALL require explicit confirmation before deleting any of them, unless an explicit non-interactive override flag is supplied.

#### Scenario: Interactive confirmation
- **WHEN** the selected subset is shown to the user and the user confirms
- **THEN** the system proceeds to delete exactly the shown workouts

#### Scenario: User declines
- **WHEN** the user declines the confirmation prompt
- **THEN** the system deletes nothing and exits without error

#### Scenario: Non-interactive override
- **WHEN** the script is invoked with the explicit skip-confirmation flag
- **THEN** the system deletes the selected subset without prompting

### Requirement: Deletion result reporting
The system SHALL delete each selected workout independently (a failure on one does not stop the others) and SHALL report, per workout, whether deletion succeeded or failed, plus a final summary count of successes and failures.

#### Scenario: Mixed success and failure
- **WHEN** one of several selected workouts fails to delete (e.g. it was already removed on Garmin's side)
- **THEN** the system continues deleting the rest, reports the failed one with its error, and prints a summary showing how many deletions succeeded versus failed
