## Context

This is a greenfield repository (no existing code). The goal is a single-purpose CLI script: read a training plan file, then create and schedule the corresponding workouts on the user's Garmin Connect calendar. It talks to Garmin Connect's private web API (the same one garmin.com's own frontend uses) rather than Garmin's official partner Connect IQ / Health APIs, since there is no public API for arbitrary calendar/workout creation.

## Goals / Non-Goals

**Goals:**
- Let a user hand-write or generate a plain YAML file describing a training plan and get it onto their Garmin Connect calendar with one command.
- Support both simple sessions ("Easy run, 45 min") and structured multi-step workouts (warmup/intervals/cooldown with pace or duration targets).
- Fail loudly and per-entry, so a plan with one bad row doesn't silently lose the rest.
- Make the file format self-documenting via a README with a full field reference and examples.
- Let the user list existing Garmin Connect calendar workouts and delete a chosen subset (e.g. to clean up a previous import or a plan that changed), with a mandatory confirmation step before any deletion.

**Non-Goals:**
- Two-way sync (reading existing Garmin calendar entries back, diffing, or deleting/updating previously-imported workouts).
- Support for every Garmin workout feature (power targets, swim-specific drill libraries, multi-sport/brick workouts). The structured-step schema targets the common case: time/distance-bound steps with an optional pace or heart-rate-zone target.
- A GUI or web frontend — this is a local CLI script.
- Handling Garmin accounts with SSO/OAuth-only login (e.g. "Sign in with Google/Facebook/Apple") — only native Garmin email/password login is in scope, since that's what `garminconnect`/`garth` support today.

## Decisions

### File format: YAML, not CSV/JSON
YAML is chosen over CSV because structured workouts need a nested `steps` list per entry, which CSV can't express without a fragile mini-DSL in a cell. YAML is chosen over JSON because users will hand-edit this file and JSON's punctuation overhead (quoting every key, no comments, trailing-comma errors) makes it worse for that. The format is one top-level `sessions:` list; see the README for the full schema and field reference.

### Library: `garminconnect` (PyPI) over hand-rolled requests
`garminconnect` (cyberjunky/python-garminconnect) already implements Garmin's login flow (including the `garth` token exchange and MFA handling) and exposes higher-level methods for workout upload/scheduling. Re-implementing Garmin's undocumented auth flow directly against `requests` would duplicate that work and be far more brittle to Garmin's changes. Trade-off: the script is coupled to a third-party library's maintenance of an unofficial API — see Risks.

Concretely the script will use:
- `Garmin(email, password)` + `.login()` for authentication, backed by `garth`'s on-disk token cache (`~/.garminconnect` by default) so re-running the script doesn't require re-login every time.
- `.upload_workout(workout_dict)` (or the library's equivalent workout-creation call) to create each workout from a Garmin workout JSON payload built from a parsed entry.
- The library's workout-scheduling call (schedule-by-date) to place the created workout on the calendar for the entry's `date`.

If a needed call is missing from the installed `garminconnect` version, the script falls back to the library's underlying authenticated session/client (which it exposes) to call the specific Garmin Connect REST endpoint directly — the same approach `garminconnect` itself uses internally — rather than duplicating full auth.

### Workout payload mapping
Each parsed entry becomes one Garmin "workout" object:
- Sport enum (`running`/`cycling`/`swimming`/`strength_training`/`other`) maps to Garmin's internal `sportType` IDs.
- No `steps` → a single "no target" step spanning the whole workout, carrying the entry's title/description as the workout name/notes.
- `steps` present → one Garmin workout step per entry step, in order, each with its `stepType` (warmup/interval/recovery/cooldown → Garmin's equivalent step type), and an end condition of either `time` (seconds) or `distance` (meters) built from `duration_type`/`duration_value`.
- The created workout's name is the entry's `title`; `description` (if present) goes into the workout description field.

### Credentials handling
Email/password are read from environment variables (`GARMIN_EMAIL`, `GARMIN_PASSWORD`), optionally loaded from a local `.env` file via `python-dotenv`. Neither is ever written to the training-plan file, logs, or committed anywhere. The `garth`/`garminconnect` token cache is the only thing persisted to disk, in the user's home directory, exactly as the library already does by default.

### CLI shape
A single script, e.g. `import_training_plan.py --file plan.yaml [--dry-run]`:
1. Load `.env`/environment for credentials.
2. Parse + validate the file (fail fast on any validation error, before touching Garmin).
3. Log in to Garmin Connect (skipped in a lightweight sense for `--dry-run`, which still needs a session for future extensibility but performs no write calls).
4. For each entry, in file order: build workout payload → create → schedule → record result.
5. Print a per-entry result line and a final `N succeeded, M failed` summary; exit non-zero if any entry failed.

### Listing and deleting existing workouts
Listing reuses `garminconnect`'s existing calendar/workout retrieval calls to fetch scheduled workouts within a date range. Filtering by sport and by a title substring is done client-side after fetching — Garmin's API doesn't need to support the filter itself, and this keeps the filtering logic testable without mocking multiple query shapes. Deletion uses the library's delete-workout call, invoked once per selected workout (not batched), so a single failure doesn't block the rest — mirroring the sync path's per-entry error handling.

Because the listing call can surface workouts the user created directly in the Garmin app (not just ones this tool imported), and because deletion is irreversible on Garmin's side, the CLI always prints the full selected subset (date, sport, title) and requires an explicit interactive confirmation before deleting, with a flag to bypass that for scripted/non-interactive use. CLI shape:
- `--list [--from DATE] [--to DATE]` — print matching workouts.
- `--delete --from DATE --to DATE [--sport SPORT] [--title-match STR] [--yes]` — select and delete a subset; `--yes` skips the interactive confirmation.

### Error handling / partial failure
Entries are processed independently. A failure on one entry (network error, Garmin API rejecting the payload, etc.) is caught, logged with the entry's date/title and the underlying error message, and processing continues to the next entry. This matches the spec's per-entry reporting requirement and avoids a 30-session plan being lost because of one bad row.

## Risks / Trade-offs

- **[Risk] Garmin Connect's API is unofficial/undocumented and can change without notice, breaking `garminconnect` or this script.** → Mitigation: pin a known-good `garminconnect` version in requirements, document the pin, and keep the workout-payload construction isolated in one module so it's easy to patch if Garmin changes the schema.
- **[Risk] Storing a long-lived session token on disk is a local credential-exposure surface.** → Mitigation: this is the library's existing default behavior (same as garmin.com's own "remember me"); document the token cache location in the README and note it should be treated like a password.
- **[Risk] Rate limiting / throttling from Garmin on large plans (many creates in quick succession).** → Mitigation: process entries sequentially (not concurrently) and surface any 429/throttle error as a normal per-entry failure the user can retry.
- **[Risk] Deleting workouts is irreversible on Garmin's side (no undo) and an overly broad filter (e.g. an empty title match across a wide date range) could delete more than intended.** → Mitigation: mandatory listing + explicit confirmation step showing exactly what will be deleted before any delete call; the bypass flag defaults to off (always interactive unless the user opts in).
- **[Risk] The listing call may also return workouts the user entered manually in the Garmin app, not just ones this tool created.** → Mitigation: the confirmation step surfaces full details (date/sport/title) so the user can visually verify before confirming; documented clearly in the README as a "review before you confirm" warning.
- **[Trade-off] Structured-step schema is intentionally simplified** (no power targets, no swim drills/equipment, no multi-sport bricks) to keep the file format approachable. Documented explicitly in the README as current limitations, not silently unsupported.

## Open Questions

- None blocking — the file format and library choice above are decisions, not open items. Future extension (pace-zone targets from Garmin's own zone config, updating/deleting previously-imported workouts) is left for a follow-up change if needed.
