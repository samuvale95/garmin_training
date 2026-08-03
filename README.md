# Garmin training-plan importer

A CLI script that reads a training plan from a YAML file and creates/schedules the corresponding workouts on your Garmin Connect calendar. It also lets you list and delete workouts already on your calendar. It uses [`garminconnect`](https://pypi.org/project/garminconnect/), a community Python wrapper around the same private API garmin.com's own website uses (there is no public API for calendar/workout management).

## Installation

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
```

For running the tests too:

```bash
pip install -e ".[dev]"
```

This installs the project as an editable package (`pyproject.toml` is the single source of dependency versions) and adds a `garmin-training-import` console script alongside the usual `python import_training_plan.py` invocation — the two behave identically; use whichever fits your workflow.

## Credentials

Set your Garmin Connect credentials as environment variables, or put them in a local `.env` file (never commit this file):

```
GARMIN_EMAIL=you@example.com
GARMIN_PASSWORD=your-password
```

On first login, a session token is cached to `~/.garmin_training_tokens` (override the path with `GARMIN_TOKENSTORE`) so you won't need to re-enter credentials on every run. Treat that file like a password — anyone with it can access your Garmin account.

Check your credentials on their own before importing anything:

```bash
python import_training_plan.py login
```

If the account has two-factor authentication enabled, you'll be prompted for the code.

Only native Garmin email/password login is supported — accounts that only use "Sign in with Google/Facebook/Apple" aren't supported by the underlying library.

### Rate limiting — read this before retrying a failed login

Garmin rate-limits **by IP address**, not just by account, and the thresholds are undocumented. A failed login is expensive: one `login` call fans out into a chain of up to 5 strategies inside `garminconnect`, several of which make more than one HTTP request. So a handful of retries with a wrong password can get your whole network throttled (HTTP 429) for a while, and the resulting error is often reported as `401 Invalid Username or Password` even when the password is correct.

The CLI therefore protects you from yourself:

- **Missing credentials** are detected locally — no request is sent at all.
- **A 429 from Garmin** is reported as a distinct rate-limit error, and puts the CLI into a **15-minute local cooldown**.
- **Repeated auth failures** back off progressively (first failure free, then 1 → 5 → 15 minutes), so a typo can't turn into an IP block.
- **A cached session token bypasses the cooldown**, since it needs no login request.
- **Nothing is ever retried automatically.**

If you hit a cooldown, the fix is to wait it out and verify your password at [connect.garmin.com](https://connect.garmin.com) in a browser in the meantime. Retrying sooner only deepens the limit. To reset the cooldown record manually, delete `~/.garmin_training_login_state.json` (override the path with `GARMIN_LOGIN_STATE`) — but only do that once you're confident the credentials are right.

## Training plan file format

A training plan is a YAML file with a top-level `sessions` list. Each item describes one workout to create and schedule:

| Field         | Required | Description                                                                 |
|---------------|----------|-------------------------------------------------------------------------------|
| `date`        | yes      | `YYYY-MM-DD`, the calendar date to schedule the workout on                    |
| `sport`       | yes      | One of: `running`, `cycling`, `swimming`, `strength_training`, `other`        |
| `title`       | yes      | Workout name, shown in Garmin Connect                                        |
| `description` | no       | Free-text notes shown in Garmin Connect                                      |
| `steps`       | no       | A list of structured steps (see below); omit for a simple, single-block session |

### Simple session (no `steps`)

```yaml
sessions:
  - date: "2026-08-03"
    sport: running
    title: Easy run
    description: Easy aerobic run, conversational pace.
```

A simple session has no explicit target duration — it's an open-ended entry ("do this workout, end it when you're done") on Garmin's side.

### Structured session (with `steps`)

Each entry in `steps` has:

| Field            | Required | Description                                          |
|------------------|----------|-------------------------------------------------------|
| `type`           | yes      | One of: `warmup`, `interval`, `recovery`, `cooldown`  |
| `duration_type`  | yes      | `time` or `distance`                                  |
| `duration_value` | yes      | **Minutes** if `duration_type: time`, **kilometers** if `duration_type: distance` |
| `target_pace`    | no       | Target pace in **min:sec per kilometre** — a range (`"4:30-4:20"`) or a single pace (`"4:30"`) |

```yaml
sessions:
  - date: "2026-08-05"
    sport: running
    title: Interval session
    description: 5x400m hard with jog recovery
    steps:
      - type: warmup
        duration_type: time
        duration_value: 10
      - type: interval
        duration_type: distance
        duration_value: 0.4
      - type: recovery
        duration_type: time
        duration_value: 2
      - type: interval
        duration_type: distance
        duration_value: 0.4
      - type: recovery
        duration_type: time
        duration_value: 2
      - type: cooldown
        duration_type: time
        duration_value: 10
```

Steps are created on Garmin Connect in the order they appear in the file. See [`examples/sample_plan.yaml`](examples/sample_plan.yaml) for a full example.

### Target pace

Any step can carry a `target_pace`, expressed in **minutes:seconds per kilometre**:

```yaml
steps:
  - type: warmup
    duration_type: time
    duration_value: 15

  - type: interval
    duration_type: distance
    duration_value: 5
    target_pace: "4:20-4:10"   # explicit range: slower bound - faster bound

  - type: cooldown
    duration_type: time
    duration_value: 10
    target_pace: "6:00"        # single pace, widened by ±5 s/km
```

Notes:

- Garmin always stores a pace **range**, never an exact value. Give a range like `"4:20-4:10"` for full control; a single pace such as `"6:00"` is automatically widened by ±5 s/km.
- Either order works — `"4:10-4:20"` and `"4:20-4:10"` are equivalent; the slower/faster bounds are sorted out for you.
- Internally the bounds are converted to metres/second, which is how Garmin stores pace targets (`4:20/km` → `3.846 m/s`).
- Steps without a `target_pace` are sent with no target, exactly as before.

Pace targets are most meaningful for `running`. Garmin models them as a speed range, so they're accepted for other sports too, but for cycling you'd normally think in speed/power rather than min/km.

### Known limitations

- Targets are pace-only: no power, heart-rate-zone, or cadence targets on steps.
- No swim-specific drills/equipment, and no multi-sport/brick workouts.
- No repeat/loop blocks — repeated intervals must be written out step by step.
- The tool only creates and deletes; it doesn't update an existing workout in place — delete and re-import instead.

## Usage

### Verify login

```bash
python import_training_plan.py login
```

Cheapest way to confirm credentials work — do this before a large import.

### Import a plan

```bash
python import_training_plan.py sync --file examples/sample_plan.yaml
```

**`sync` always diffs against your calendar first and only adds what's missing.** It reads the workouts already scheduled over the plan's own date range, matches them against the file by **date + title**, and creates only the sessions that aren't there yet. So you can edit a plan file, re-run `sync`, and get just the new sessions — running it twice in a row is a no-op rather than a duplicate import.

The diff is printed before anything is written:

```
Plan vs calendar: 8 to add, 25 already scheduled.

Already on the calendar (skipped): 25
  = 2026-08-01 | Lungo con 3x4' veloce
  ...

To be added: 8
  + 2026-08-03 | running | Corsa 40' ritmo costante | interval 40.0min @ 5:55-6:05/km
  ...
```

Sessions on the calendar that are **not** in the file are reported under "On the calendar but NOT in this file" and are **left untouched** — `sync` only ever adds. Use `delete` if you want them gone.

Preview the diff without writing anything:

```bash
python import_training_plan.py sync --file examples/sample_plan.yaml --dry-run
```

Skip the comparison and import every session in the file (this **can create duplicates**):

```bash
python import_training_plan.py sync --file examples/sample_plan.yaml --no-diff
```

Combine `--dry-run --no-diff` for a fully offline preview of the file that never contacts Garmin.

The script processes every entry even if one fails, then prints a per-entry result and a final `N succeeded, M failed` summary. It exits non-zero if any entry failed.

**Matching caveat:** by default, the diff compares date and title only, not the contents of a session. If you change the *steps* of a session but keep its date and title, `sync` will consider it already present and skip it — unless you opt into a deeper check:

```bash
python import_training_plan.py sync --file plan.yaml --deep     # also reports content changes, doesn't act on them
python import_training_plan.py sync --file plan.yaml --update   # deletes and recreates sessions whose contents changed
```

`--deep` fetches and content-hashes each already-scheduled, matched session (one extra read per session) and reports any whose contents no longer match the file, without changing anything. `--update` implies `--deep` and additionally rewrites those sessions on Garmin (delete + recreate, since Garmin workouts can't be edited in place) — this prompts for confirmation unless `--yes` is also passed.

### List existing calendar workouts

```bash
python import_training_plan.py list --from 2026-08-01 --to 2026-08-31
```

### Delete existing calendar workouts

Select a subset by date range plus an optional sport and/or title match:

```bash
python import_training_plan.py delete --from 2026-08-01 --to 2026-08-31 --sport running --title-match interval
```

This always prints the full list of workouts that would be deleted and asks for confirmation before deleting anything, since **deletion is irreversible on Garmin's side**. The listing may include workouts you created manually in the Garmin app, not just ones this tool imported — review the printed list carefully before confirming. Pass `--yes` to skip the interactive confirmation (e.g. for scripted use):

```bash
python import_training_plan.py delete --from 2026-08-01 --to 2026-08-31 --title-match "old plan" --yes
```

## Running the tests

```bash
pip install -e ".[dev]"
pytest
```

## Architecture

The project is split into a presentation-independent core and a thin CLI on top of it, so the core can be called directly by something other than the CLI later:

- **`training_plan/models.py`, `parser.py`, `garmin_sync.py`** — pure logic: data models, YAML parsing/validation, and the Garmin Connect integration (auth, rate-limit guards, workout payload construction, diff/list/delete). No printing, no prompting.
- **`training_plan/service.py`** — the orchestration seam: one function per operation (`preview_plan_sync`/`apply_plan_sync`, `list_workouts`, `preview_deletion`/`apply_deletion`, `verify_login`), each taking plain arguments and returning plain dataclasses (or raising `GarminSyncError`/`TrainingPlanValidationError`). Nothing here prints, prompts, or calls `sys.exit` — **this is the module a future consumer should import and call directly**, whether that's a web backend, a script, or something else. Write operations are split into a `preview_*` step (computes what would happen, writes nothing) and an `apply_*` step (performs the write), so a caller can show a preview and decide whether to proceed before anything touches Garmin.
- **`training_plan/cli.py`** — argument parsing and presentation only: it calls `service.py` and turns the result into printed output, interactive confirmation prompts, and process exit codes. If you're building something that isn't a terminal UI, this is the one module you don't need.

**What this project is not, yet:** there is no web framework, no hosting target, no database, and no authentication layer here, and none of those are decided. This refactor only prepares the ground (a clean, presentation-independent service layer, proper packaging) so that whatever gets built around it later doesn't have to fight the CLI's argparse/print/input plumbing to reuse the Garmin integration.
