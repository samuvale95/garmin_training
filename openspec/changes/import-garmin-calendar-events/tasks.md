## 1. Project setup

- [ ] 1.1 Create project structure (e.g. `import_training_plan.py`, `training_plan/` package with `parser.py`, `garmin_sync.py`, `models.py`)
- [ ] 1.2 Add `requirements.txt` with `garminconnect`, `PyYAML`, `python-dotenv`, pinned to known-good versions
- [ ] 1.3 Add `.gitignore` entries for the credential cache/token directory and any local `.env` file

## 2. Training plan file format (parsing & validation)

- [ ] 2.1 Define entry data model (`date`, `sport`, `title`, `description`, `steps`) per `specs/training-plan-file`
- [ ] 2.2 Implement YAML loading of the `sessions` list into raw dicts
- [ ] 2.3 Implement validation: required fields present, `date` is valid ISO `YYYY-MM-DD`, `sport` is in the supported enum, each `steps` entry has `type`/`duration_type`/`duration_value`
- [ ] 2.4 Implement clear, entry-identifying error messages for each validation failure and stop-before-sync behavior on any failure
- [ ] 2.5 Write unit tests covering: minimal valid entry, structured entry with steps, missing required field, invalid sport, invalid date

## 3. Garmin Connect authentication

- [ ] 3.1 Implement credential loading from environment variables / `.env` via `python-dotenv`
- [ ] 3.2 Implement login via `garminconnect.Garmin(email, password).login()` with token cache reuse (skip re-login when a valid cached session exists)
- [ ] 3.3 Implement a clear authentication-failure error path that stops before any calendar changes
- [ ] 3.4 Write a test (with mocked `garminconnect`) covering fresh login, cached-session reuse, and login failure

## 4. Workout creation & calendar scheduling

- [ ] 4.1 Implement mapping from entry sport enum to Garmin `sportType`
- [ ] 4.2 Implement Garmin workout payload builder for simple (no-`steps`) entries
- [ ] 4.3 Implement Garmin workout payload builder for structured (`steps`) entries, preserving step order, types, and time/distance end conditions
- [ ] 4.4 Implement workout creation call against Garmin Connect via `garminconnect`
- [ ] 4.5 Implement calendar scheduling call to place the created workout on the entry's `date`
- [ ] 4.6 Write tests (with mocked `garminconnect`) covering simple-entry payload, structured-entry payload, and successful create+schedule flow

## 5. Result reporting & dry-run

- [ ] 5.1 Implement per-entry try/except so one entry's failure doesn't stop processing of the rest
- [ ] 5.2 Implement per-entry success/failure log line (including the Garmin API error message on failure)
- [ ] 5.3 Implement final summary line (`N succeeded, M failed`) and non-zero exit code when any entry failed
- [ ] 5.4 Implement `--dry-run` flag: parse/validate and print the per-entry preview (sport, date, title, step summary) without calling create/schedule
- [ ] 5.5 Write tests covering mixed success/failure reporting and dry-run output

## 6. CLI wiring

- [ ] 6.1 Implement `import_training_plan.py` CLI entry point wiring: arg parsing (`--file`, `--dry-run`), load → parse/validate → authenticate → sync loop → summary
- [ ] 6.2 Manually verify end-to-end against a real (or sandbox) Garmin Connect account with a small sample plan file

## 7. Documentation

- [ ] 7.1 Write `README.md` documenting: installation, credential setup (env vars/`.env`), the full YAML file format/field reference with a simple example and a structured-workout example, `--dry-run` usage, and known limitations (from design.md Non-Goals)
- [ ] 7.2 Add a sample training plan file (e.g. `examples/sample_plan.yaml`) referenced from the README
- [ ] 7.3 Document `--list`/`--delete` usage, filter options, and the confirmation flow in `README.md`

## 8. List and delete existing workouts

- [ ] 8.1 Implement a Garmin Connect calendar listing call (via `garminconnect`) with optional date-range filtering
- [ ] 8.2 Implement client-side filtering by sport and case-insensitive title substring match, combinable with the date range
- [ ] 8.3 Implement CLI `--list [--from] [--to]` to print matching workouts (date, sport, title, id)
- [ ] 8.4 Implement CLI `--delete [--from] [--to] [--sport] [--title-match] [--yes]` to select a subset for deletion
- [ ] 8.5 Implement the confirmation prompt showing the full selected subset before deletion, with `--yes` bypassing it
- [ ] 8.6 Implement per-workout deletion call with independent try/except per workout, plus per-workout success/failure reporting and a final summary count
- [ ] 8.7 Write tests (mocked `garminconnect`) covering: list with/without filters, combined filter selection, confirm/decline flow, `--yes` bypass, and mixed delete success/failure
