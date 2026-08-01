## 1. Project setup

- [x] 1.1 Create project structure (e.g. `import_training_plan.py`, `training_plan/` package with `parser.py`, `garmin_sync.py`, `models.py`)
- [x] 1.2 Add `requirements.txt` with `garminconnect`, `PyYAML`, `python-dotenv`, pinned to known-good versions
- [x] 1.3 Add `.gitignore` entries for the credential cache/token directory and any local `.env` file

## 2. Training plan file format (parsing & validation)

- [x] 2.1 Define entry data model (`date`, `sport`, `title`, `description`, `steps`) per `specs/training-plan-file`
- [x] 2.2 Implement YAML loading of the `sessions` list into raw dicts
- [x] 2.3 Implement validation: required fields present, `date` is valid ISO `YYYY-MM-DD`, `sport` is in the supported enum, each `steps` entry has `type`/`duration_type`/`duration_value`
- [x] 2.4 Implement clear, entry-identifying error messages for each validation failure and stop-before-sync behavior on any failure
- [x] 2.5 Write unit tests covering: minimal valid entry, structured entry with steps, missing required field, invalid sport, invalid date

## 3. Garmin Connect authentication

- [x] 3.1 Implement credential loading from environment variables / `.env` via `python-dotenv`
- [x] 3.2 Implement login via `garminconnect.Garmin(email, password).login()` with token cache reuse (skip re-login when a valid cached session exists)
- [x] 3.3 Implement a clear authentication-failure error path that stops before any calendar changes
- [x] 3.4 Write a test (with mocked `garminconnect`) covering fresh login, cached-session reuse, and login failure

## 4. Workout creation & calendar scheduling

- [x] 4.1 Implement mapping from entry sport enum to Garmin `sportType`
- [x] 4.2 Implement Garmin workout payload builder for simple (no-`steps`) entries
- [x] 4.3 Implement Garmin workout payload builder for structured (`steps`) entries, preserving step order, types, and time/distance end conditions
- [x] 4.4 Implement workout creation call against Garmin Connect via `garminconnect`
- [x] 4.5 Implement calendar scheduling call to place the created workout on the entry's `date`
- [x] 4.6 Write tests (with mocked `garminconnect`) covering simple-entry payload, structured-entry payload, and successful create+schedule flow

## 5. Result reporting & dry-run

- [x] 5.1 Implement per-entry try/except so one entry's failure doesn't stop processing of the rest
- [x] 5.2 Implement per-entry success/failure log line (including the Garmin API error message on failure)
- [x] 5.3 Implement final summary line (`N succeeded, M failed`) and non-zero exit code when any entry failed
- [x] 5.4 Implement `--dry-run` flag: parse/validate and print the per-entry preview (sport, date, title, step summary) without calling create/schedule
- [x] 5.5 Write tests covering mixed success/failure reporting and dry-run output

## 6. CLI wiring

- [x] 6.1 Implement `import_training_plan.py` CLI entry point wiring: arg parsing (`--file`, `--dry-run`), load → parse/validate → authenticate → sync loop → summary
- [x] 6.2 Manually verify end-to-end against a real Garmin Connect account — done: single-session import created, scheduled, read back, and deleted successfully; step types, end conditions, and pace targets all confirmed correct on the live API.

## 7. Documentation

- [x] 7.1 Write `README.md` documenting: installation, credential setup (env vars/`.env`), the full YAML file format/field reference with a simple example and a structured-workout example, `--dry-run` usage, and known limitations (from design.md Non-Goals)
- [x] 7.2 Add a sample training plan file (e.g. `examples/sample_plan.yaml`) referenced from the README
- [x] 7.3 Document `--list`/`--delete` usage, filter options, and the confirmation flow in `README.md`

## 8. List and delete existing workouts

- [x] 8.1 Implement a Garmin Connect calendar listing call (via `garminconnect`) with optional date-range filtering
- [x] 8.2 Implement client-side filtering by sport and case-insensitive title substring match, combinable with the date range
- [x] 8.3 Implement CLI `--list [--from] [--to]` to print matching workouts (date, sport, title, id)
- [x] 8.4 Implement CLI `--delete [--from] [--to] [--sport] [--title-match] [--yes]` to select a subset for deletion
- [x] 8.5 Implement the confirmation prompt showing the full selected subset before deletion, with `--yes` bypassing it
- [x] 8.6 Implement per-workout deletion call with independent try/except per workout, plus per-workout success/failure reporting and a final summary count
- [x] 8.7 Write tests (mocked `garminconnect`) covering: list with/without filters, combined filter selection, confirm/decline flow, `--yes` bypass, and mixed delete success/failure

## 9. Target pace on steps

- [x] 9.1 Add optional `target_pace` to the step data model, holding the slower/faster bounds as seconds per kilometre
- [x] 9.2 Implement parsing of `target_pace` accepting a `M:SS-M:SS` range (either order) or a single `M:SS` widened by a fixed tolerance
- [x] 9.3 Implement validation with entry- and step-identifying error messages for malformed paces and identical bounds
- [x] 9.4 Emit Garmin's `pace.zone` target type (ID 6) with the bounds converted to m/s as `targetValueOne`/`targetValueTwo` on the step, slower bound first
- [x] 9.5 Show the target pace in the `--dry-run` per-entry preview
- [x] 9.6 Write tests covering: range parsing, reversed range, single-value widening, m/s conversion, malformed values, payload with and without a pace target
- [x] 9.7 Document `target_pace` in `README.md` (units, range vs single value, limitations) and add pace targets to the sample plan file

## 10. Login rate-limit guards

- [x] 10.1 Catch `GarminConnectTooManyRequestsError` separately (it is not a subclass of the other library exceptions) and map it to a dedicated `GarminRateLimitError`
- [x] 10.2 Fail locally with no login request when credentials are missing
- [x] 10.3 Record login failures to a local state file with a `retry_after` cooldown: 15 min after a 429, backing off 0 → 1 → 5 → 15 min for auth failures
- [x] 10.4 Refuse login during an active cooldown without contacting Garmin; skip the cooldown when a cached session token exists
- [x] 10.5 Clear the failure record on a successful login
- [x] 10.6 Add MFA support by passing a `prompt_mfa` callback through to the library
- [x] 10.7 Add a `login` subcommand to verify credentials with a single attempt
- [x] 10.8 Write tests covering: missing credentials, 429 handling, active/expired cooldown, escalating backoff, cached-token bypass, MFA passthrough
- [x] 10.9 Document the rate limiter and the guards in `README.md`

## 11. Fixes found during live verification

- [x] 11.1 Correct the end-condition IDs (`distance` 1 → 3, `lap.button` 8 → 1) after probing the live API; the library's `ConditionType` helper silently turned every distance step into a lap-button step
- [x] 11.2 Add a unit test pinning the verified end-condition IDs so the library's wrong values cannot creep back in
- [x] 11.3 Read the calendar item's sport from `sportTypeKey` (the real field) instead of guessing `sport.sportName`/`sportType`, which always fell back to `"other"` and broke `delete --sport`
- [x] 11.4 Wrap the calendar-listing API call so `list`/`delete` report a clean error instead of an unhandled traceback on timeout

## 12. Diff a plan against the calendar before importing

- [x] 12.1 Add `PlanDiff` and `diff_plan()` matching sessions on (date, normalized title) over the plan's own date range
- [x] 12.2 Make `sync` diff by default and create only the missing sessions
- [x] 12.3 Print the comparison (already present / extra on Garmin / to be added) before writing anything
- [x] 12.4 Report calendar entries absent from the file without touching them (`sync` stays add-only)
- [x] 12.5 Add `--no-diff` to import everything, and make `--dry-run` preview the diff (`--dry-run --no-diff` = fully offline preview)
- [x] 12.6 Write tests covering: missing/present split, extras, case+whitespace tolerance, same title on different dates, empty plan, date-range scoping, and the CLI paths
- [x] 12.7 Document the diff behaviour and the content-change limitation in `README.md`
