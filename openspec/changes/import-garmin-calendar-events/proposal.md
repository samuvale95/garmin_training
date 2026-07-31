## Why

Training plans are typically drafted in a spreadsheet or plain text file, then manually re-typed as calendar entries in Garmin Connect one day at a time. This is slow and error-prone, especially for multi-week plans with many sessions. A script that reads a plan file and pushes the sessions straight into the Garmin Connect calendar removes that manual step entirely.

## What Changes

- Define a plain-text **training plan file format** (YAML) that lets a user describe a list of scheduled workouts: date, sport, title, description, and optional structured steps (warmup/work/recovery/cooldown with duration or distance targets).
- Add a Python script that:
  - Parses and validates a training plan file against that format.
  - Authenticates to Garmin Connect using the `garminconnect` library (the community Python wrapper around the same undocumented API garmin.com's website uses).
  - Creates a Garmin workout for each entry (simple or structured) and schedules it on the corresponding calendar date.
  - Reports per-entry success/failure so partial failures in a large plan are visible.
- Add **management of existing workouts**: list workouts/events already scheduled on the Garmin Connect calendar (optionally filtered by date range, sport, or a title substring match) and delete a selected subset, with a mandatory confirmation step before any deletion — for cleaning up a previous import or a plan that changed.
- Add a `README.md` documenting the file format, installation, credentials setup, and usage of the script.

## Capabilities

### New Capabilities
- `training-plan-file`: Parsing and validation of the training-plan input file format (YAML) into structured workout entries.
- `garmin-calendar-sync`: Authenticating to Garmin Connect; creating/scheduling calendar workouts from parsed training-plan entries; listing existing calendar workouts and deleting a selected subset (with confirmation); per-entry result reporting for both sync and deletion.

### Modified Capabilities
- None (new project, no existing specs).

## Impact

- **New code**: a CLI script (e.g. `import_training_plan.py`), a file-parsing/validation module, and a Garmin sync module.
- **New dependency**: `garminconnect` Python package (and its transitive dependency `garth` for authentication/session handling).
- **New docs**: `README.md` describing the file format and usage.
- **External system**: Garmin Connect account/API — this change performs write operations (creating, scheduling, and **deleting** workouts/calendar entries) against the user's real Garmin Connect account. Deletion is irreversible on Garmin's side, so it requires an explicit confirmation step.
- **Credentials**: requires the user's Garmin Connect email/password (or a cached session token), handled locally — not transmitted anywhere except to Garmin's own API.
