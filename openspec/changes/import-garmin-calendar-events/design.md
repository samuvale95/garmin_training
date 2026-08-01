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
- Support for every Garmin workout feature (power/heart-rate/cadence targets, swim-specific drill libraries, multi-sport/brick workouts, repeat-loop blocks). The structured-step schema targets the common case: time/distance-bound steps with an optional **pace** target.
- A GUI or web frontend — this is a local CLI script.
- Handling Garmin accounts with SSO/OAuth-only login (e.g. "Sign in with Google/Facebook/Apple") — only native Garmin email/password login is in scope, since that's what `garminconnect`/`garth` support today. Native accounts with two-factor authentication *are* supported, via an interactive code prompt.

## Decisions

### File format: YAML, not CSV/JSON
YAML is chosen over CSV because structured workouts need a nested `steps` list per entry, which CSV can't express without a fragile mini-DSL in a cell. YAML is chosen over JSON because users will hand-edit this file and JSON's punctuation overhead (quoting every key, no comments, trailing-comma errors) makes it worse for that. The format is one top-level `sessions:` list; see the README for the full schema and field reference.

### Library: `garminconnect` (PyPI) over hand-rolled requests
`garminconnect` (cyberjunky/python-garminconnect) already implements Garmin's login flow (including the `garth` token exchange and MFA handling) and exposes higher-level methods for workout upload/scheduling. Re-implementing Garmin's undocumented auth flow directly against `requests` would duplicate that work and be far more brittle to Garmin's changes. Trade-off: the script is coupled to a third-party library's maintenance of an unofficial API — see Risks.

Concretely the script will use:
- `Garmin(email, password)` + `.login(tokenstore=path)` for authentication, with the token cache path defaulting to `~/.garmin_training_tokens` (overridable via `GARMIN_TOKENSTORE`) so re-running the script doesn't require re-login every time.
- `.upload_workout(workout_dict)` (or the library's equivalent workout-creation call) to create each workout from a Garmin workout JSON payload built from a parsed entry.
- The library's workout-scheduling call (schedule-by-date) to place the created workout on the calendar for the entry's `date`.

If a needed call is missing from the installed `garminconnect` version, the script falls back to the library's underlying authenticated session/client (which it exposes) to call the specific Garmin Connect REST endpoint directly — the same approach `garminconnect` itself uses internally — rather than duplicating full auth.

### Workout payload mapping
Each parsed entry becomes one Garmin "workout" object:
- Sport enum (`running`/`cycling`/`swimming`/`strength_training`/`other`) maps to Garmin's internal `sportType` IDs.
- No `steps` → a single "no target" step spanning the whole workout, carrying the entry's title/description as the workout name/notes.
- `steps` present → one Garmin workout step per entry step, in order, each with its `stepType` (warmup/interval/recovery/cooldown → Garmin's equivalent step type), and an end condition of either `time` (seconds) or `distance` (meters) built from `duration_type`/`duration_value`.
- The created workout's name is the entry's `title`; `description` (if present) goes into the workout description field.

### Pace targets
A step may carry an optional `target_pace` in min:sec per kilometre, either as an explicit range (`"4:30-4:20"`) or a single value (`"4:30"`). Garmin models pace as a **range of speeds**, never an exact value, so a single value is widened by a fixed ±5 s/km tolerance rather than sent as a zero-width range (which Garmin would either reject or render oddly).

The Garmin representation, verified against the installed library's step model and against working community implementations:
- `targetType` = `{"workoutTargetTypeId": 6, "workoutTargetTypeKey": "pace.zone", "displayOrder": 6}`.
- The two bounds go on the **step itself** as `targetValueOne`/`targetValueTwo`, *not* nested inside `targetType`.
- Both are speeds in **metres per second**, converted as `1000 / seconds_per_km`. `targetValueOne` is the slower bound (lower speed), `targetValueTwo` the faster one.

Note the bundled `garminconnect` package's own `TargetType` helper enum is unreliable here — it lists `SPEED = 5` / `OPEN = 6` and has no `pace.zone` entry at all. Garmin treats the numeric ID as authoritative, so this project defines its own target-type constants in `models.py` alongside the other payload fragments instead of importing the library's enum. The step model accepts the extra fields because it is declared with `extra = "allow"`.

### End-condition type IDs (verified against the live API)
The library's `ConditionType` helper is wrong in the same way, and here the failure is **silent and damaging**: it claims `DISTANCE = 1`, but ID 1 is actually `lap.button`. Sending it produces a workout that looks plausible but waits for a manual lap press instead of auto-advancing at the target distance — the value (`1000.0`) is even preserved, so nothing looks obviously broken.

Probing the live API with IDs 1–5 on a throwaway workout gave the authoritative mapping:

| ID | key |
|----|-------------|
| 1 | `lap.button` |
| 2 | `time` |
| 3 | `distance` |
| 4 | `calories` |
| 5 | `power` |

`models.py` therefore hard-codes `time = 2`, `distance = 3`, `lap.button = 1`, with a unit test asserting these exact IDs so a future refactor cannot quietly regress to the library's values.

### Calendar item field names (verified against the live API)
Scheduled calendar items expose the sport as a flat `sportTypeKey` string. The original defensive parsing guessed `sport.sportName` / `sportType` and silently fell back to `"other"` for every item, which would have made `delete --sport` match nothing. Other confirmed fields: `id` (the scheduled-workout id), `workoutId`, `date`, `title`, `itemType`.

File-format shape: `target_pace` is a flat field on the step, mirroring the existing flat `duration_type`/`duration_value` style, rather than a nested `target:` object. It keeps the file hand-editable (the stated reason for choosing YAML) and leaves room for sibling `target_hr_zone`/`target_power` fields later without restructuring existing files.

### Guarding against Garmin's login rate limiter
Garmin rate-limits logins **by IP address** with undocumented thresholds, and returns misleading errors when it does — a throttled login often surfaces as `401 Invalid Username or Password` even with a correct password. Worse, one `login()` call is not one attempt: `garminconnect` runs a chain of up to 5 login strategies, several of which make multiple HTTP requests, and only a detected credential error stops the chain early. A few retries with a wrong password can therefore throttle the whole network.

Three design consequences:

1. **Spend no attempt that cannot succeed.** Missing credentials are detected locally, before constructing the client, so such a run costs zero login requests.
2. **Fail closed after a failure.** Failures are recorded to a small local state file (`~/.garmin_training_login_state.json`) holding a failure count and a `retry_after` timestamp. A 429 sets a 15-minute cooldown; auth failures back off 0 → 1 → 5 → 15 minutes, so a single typo isn't punished but a loop of retries is. A successful login clears the record. Nothing is ever retried automatically.
3. **Don't let the guard block work that needs no login.** The cooldown is skipped when a cached session token exists, since that path makes no SSO request.

`GarminConnectTooManyRequestsError` is deliberately caught separately from `GarminConnectAuthenticationError` — note it is *not* a subclass of the other library exceptions, so catching only the auth/connection errors lets a 429 escape as an unhandled traceback. It maps to a dedicated `GarminRateLimitError` so callers (and the user) can tell "wrong password" apart from "you are throttled", which the raw Garmin response does not make clear.

A separate `login` subcommand exists so credentials can be verified with a single attempt, rather than discovering an auth problem part-way through a 25-session import.

### Credentials handling
Email/password are read from environment variables (`GARMIN_EMAIL`, `GARMIN_PASSWORD`), optionally loaded from a local `.env` file via `python-dotenv`. Neither is ever written to the training-plan file, logs, or committed anywhere. The `garth`/`garminconnect` token cache is the only thing persisted to disk, in the user's home directory, exactly as the library already does by default.

### CLI shape
A single script with subcommands, since sync/list/delete take different, non-overlapping options: `import_training_plan.py sync --file plan.yaml [--dry-run]`, `import_training_plan.py list --from DATE --to DATE`, `import_training_plan.py delete --from DATE --to DATE [--sport SPORT] [--title-match STR] [--yes]`.

The `sync` subcommand:
1. Load `.env`/environment for credentials.
2. Parse + validate the file (fail fast on any validation error, before touching Garmin).
3. Log in to Garmin Connect (skipped in a lightweight sense for `--dry-run`, which still needs a session for future extensibility but performs no write calls).
4. For each entry, in file order: build workout payload → create → schedule → record result.
5. Print a per-entry result line and a final `N succeeded, M failed` summary; exit non-zero if any entry failed.

### Listing and deleting existing workouts
Listing reuses `garminconnect`'s existing calendar/workout retrieval calls to fetch scheduled workouts within a date range. Filtering by sport and by a title substring is done client-side after fetching — Garmin's API doesn't need to support the filter itself, and this keeps the filtering logic testable without mocking multiple query shapes. Deletion uses the library's delete-workout call, invoked once per selected workout (not batched), so a single failure doesn't block the rest — mirroring the sync path's per-entry error handling.

Because the listing call can surface workouts the user created directly in the Garmin app (not just ones this tool imported), and because deletion is irreversible on Garmin's side, the CLI always prints the full selected subset (date, sport, title) and requires an explicit interactive confirmation before deleting, with a flag to bypass that for scripted/non-interactive use. Exposed as the `list` and `delete` subcommands (see CLI shape above); `--yes` on `delete` skips the interactive confirmation.

### Diffing a plan against the calendar
Plan files get edited and re-imported — a week gets added, a session moves. Making `sync` unconditionally create everything would duplicate the whole plan on every run, so it instead **diffs first by default** and creates only what's missing.

Identity is **(date, normalized title)**: title whitespace collapsed and case-folded. This is the only identity available from a calendar listing without fetching each workout individually, and it matches how a person thinks about a plan ("the 5 km tempo on the 20th"). The comparison is scoped to the plan's own min/max date range, so unrelated workouts elsewhere on the calendar are never considered.

The known limitation is deliberate: **content changes are invisible to the diff.** Editing a session's steps while keeping its date and title leaves it classified as already-present and it is skipped. Detecting that would mean fetching every scheduled workout's full definition (one API call each) and comparing step trees — expensive, and fragile given Garmin normalizes payloads on the way in. Documented in the README with the workaround (delete, then re-sync) rather than solved.

`sync` is add-only by design: entries on the calendar that the file doesn't list are reported but never removed, so an incomplete file can't silently wipe a training block. Deletion stays an explicit, separately-confirmed operation.

### Error handling / partial failure
Entries are processed independently. A failure on one entry (network error, Garmin API rejecting the payload, etc.) is caught, logged with the entry's date/title and the underlying error message, and processing continues to the next entry. This matches the spec's per-entry reporting requirement and avoids a 30-session plan being lost because of one bad row.

## Risks / Trade-offs

- **[Risk] Garmin Connect's API is unofficial/undocumented and can change without notice, breaking `garminconnect` or this script.** → Mitigation: pin a known-good `garminconnect` version in requirements, document the pin, and keep the workout-payload construction isolated in one module so it's easy to patch if Garmin changes the schema.
- **[Risk] Storing a long-lived session token on disk is a local credential-exposure surface.** → Mitigation: this is the library's existing default behavior (same as garmin.com's own "remember me"); document the token cache location in the README and note it should be treated like a password.
- **[Risk] Rate limiting / throttling from Garmin on large plans (many creates in quick succession).** → Mitigation: process entries sequentially (not concurrently) and surface any 429/throttle error as a normal per-entry failure the user can retry.
- **[Risk] Deleting workouts is irreversible on Garmin's side (no undo) and an overly broad filter (e.g. an empty title match across a wide date range) could delete more than intended.** → Mitigation: mandatory listing + explicit confirmation step showing exactly what will be deleted before any delete call; the bypass flag defaults to off (always interactive unless the user opts in).
- **[Risk] The listing call may also return workouts the user entered manually in the Garmin app, not just ones this tool created.** → Mitigation: the confirmation step surfaces full details (date/sport/title) so the user can visually verify before confirming; documented clearly in the README as a "review before you confirm" warning.
- **[Risk] The pace-target payload (target type ID 6, bounds as m/s on the step) is derived from reverse-engineered community knowledge, not Garmin documentation, and the bundled library's own enum contradicts it.** → Mitigation: the constants live in one place (`models.py`) so a correction is a one-line change; `--dry-run` plus the printed pace range lets the user sanity-check before writing, and the first real sync should be verified in Garmin Connect's UI.
- **[Trade-off] Structured-step schema is intentionally simplified** (pace targets only — no power/HR/cadence targets, no swim drills/equipment, no multi-sport bricks, no repeat blocks) to keep the file format approachable. Documented explicitly in the README as current limitations, not silently unsupported.

## Open Questions

- None blocking — the file format and library choice above are decisions, not open items. Future extension (pace-zone targets from Garmin's own zone config, updating/deleting previously-imported workouts) is left for a follow-up change if needed.
