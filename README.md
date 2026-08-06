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

### Strava (optional, for the web app's "done vs. planned" and shoe-wear screens)

The web app can compare a planned session against the matching Strava activity and track shoe wear, via a real Strava OAuth connection. This needs a Strava API application (free, register one at <https://www.strava.com/settings/api>), then the same `.env`/environment-variable treatment as Garmin:

```
STRAVA_CLIENT_ID=your-client-id
STRAVA_CLIENT_SECRET=your-client-secret
STRAVA_REDIRECT_URI=http://localhost:3000/connect-strava/callback
```

The connection is established from the web app's Settings screen ("Collega Strava"), not the CLI. Tokens are cached to `~/.garmin_training_strava_tokens.json` (override with `STRAVA_TOKENSTORE`) — treat that file like a password, same as the Garmin tokenstore. The requested scope is read-only (`activity:read_all,profile:read_all`); nothing is ever written back to Strava.

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
| `type`           | yes      | One of: `warmup`, `interval`, `recovery`, `rest`, `cooldown` |
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
      - repeat: 5
        steps:
          - type: interval
            duration_type: distance
            duration_value: 0.4
          - type: recovery
            duration_type: time
            duration_value: 2
            target_pace: "6:30-6:00"
      - type: cooldown
        duration_type: time
        duration_value: 10
```

Steps are created on Garmin Connect in the order they appear in the file. See [`examples/sample_plan.yaml`](examples/sample_plan.yaml) for a full example.

### What each step type does on the watch

The `type` is not just a label — it is what the watch announces and how Garmin files the step in the workout's statistics. None of them stops the timer or waits for you: **every step ends on its own time/distance condition regardless of type**.

| `type`     | On the watch    | Use it for                                                                 |
|------------|-----------------|----------------------------------------------------------------------------|
| `warmup`   | "Warm up"       | Opening block. Excluded from Garmin's interval statistics.                   |
| `interval` | "Interval"      | The work step.                                                               |
| `recovery` | "Recovery"      | **Active** recovery — you keep running. Give it a `target_pace` and the watch holds you to that slow pace. |
| `rest`     | "Rest"          | Standing rest. The clock still runs; a pace target here means nothing.       |
| `cooldown` | "Cool down"     | Closing block. Excluded from Garmin's interval statistics.                   |

The distinction that actually changes what you do is `recovery` **with** a `target_pace` versus without one: a bare `recovery` step gives the watch nothing to say beyond a countdown, which is why it reads as "stand around for two minutes". Write `target_pace: "6:30-6:00"` on it and it becomes an explicit "jog these two minutes at 6:30–6:00/km".

### Repeat blocks

Instead of writing the same interval out five times, wrap it in a `repeat` block:

```yaml
steps:
  - repeat: 6
    steps:
      - type: interval
        duration_type: distance
        duration_value: 1.0
        target_pace: "4:40"
      - type: recovery
        duration_type: time
        duration_value: 2
        target_pace: "6:30-6:00"
```

| Field    | Required | Description                                                     |
|----------|----------|------------------------------------------------------------------|
| `repeat` | yes      | How many times the block runs: a whole number from 2 to 99        |
| `steps`  | yes      | The steps inside the block, in the same format as a top-level step |

This maps onto Garmin's own repeat groups, so the watch shows "Interval 3/6" rather than six indistinguishable steps, and the block survives a round trip through Garmin Connect. Notes:

- Blocks cannot be nested inside one another. A repeat group read back *from* Garmin that does nest is flattened one level.
- Blocks and plain steps mix freely at the top level.
- A workout uploaded before repeat blocks existed is not considered "changed" just because the same session would now be written as a block — `sync --check-content` compares the steps as executed, not as grouped.

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
- Repeat blocks are one level deep — no blocks inside blocks.
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

## Web API (FastAPI)

A thin HTTP layer wraps `service.py` (plus a new read-only body/wellness capability) for the Next.js web app in `web/` — see `openspec/changes/passo-nextjs-web-app/` for the full design. Run it locally:

```bash
pip install -e ".[dev]"
uvicorn training_plan.api:app --reload
```

By default it listens on `http://127.0.0.1:8000` and allows CORS from `http://localhost:3000` (the Next.js dev server); override the allowed frontend origin with `PASSO_WEB_ORIGIN` (comma-separated for multiple origins). Interactive API docs are served at `/docs`.

Endpoints, grouped by capability:

- **Plan** — `POST /plan/parse` (file or pasted YAML), `POST /plan/diff` (preview vs. the calendar, writes nothing), `POST /plan/sync` (starts a background write job, returns a `job_id`), `GET /plan/sync/{job_id}` (poll progress), `POST /plan/sync/{job_id}/cancel`.
- **Garmin** — `POST /garmin/connect`, `GET /garmin/status` (connected / cooldown + remaining seconds), `GET /garmin/workouts`, `POST /garmin/deletions/preview`, `POST /garmin/deletions/apply`.
- **Body** (read-only) — `GET /body/today` (readiness/sleep/HRV/RHR/battery/stress), `GET /body/load` (weekly training load, acute:chronic ratio, VO₂max), `GET /body/metrics` (weight/height/age, from the scale or the Garmin profile), `POST /body/conflict` (compares today's snapshot against a submitted next-planned-session and returns concrete resolution options).
- **Nutrition** — `POST /nutrition/targets` (carbohydrate/protein targets for today and tomorrow, from the submitted plan), `POST /nutrition/narrative` (the same thing phrased by a model, falling back to a template), `GET /nutrition/day`, `GET /nutrition/history`, `POST /nutrition/photo` (multipart: a plate photo, estimated and stored), `POST /nutrition/entry` (manual), `PATCH`/`DELETE /nutrition/entry/{id}`, `GET /nutrition/entry/{id}/photo`, `GET /nutrition/config`.

The Garmin write job in `/plan/sync` runs one session at a time on a background thread and keeps going even if the client disconnects — matching the CLI's existing sequential `sync_all`/`replace_all` behavior, just with per-item progress exposed for polling. Job state is in-memory only (lost on process restart); this is a local, single-user tool, not a production job queue.

Body/wellness data (`training_plan/body_insights.py`) reads readiness/sleep/HRV/load/VO₂max via the `garminconnect` client's existing wellness endpoints. Those endpoints are undocumented and their exact response shapes haven't been verified against a live account yet (every field extraction is defensive and degrades to "unavailable" rather than raising) — treat the numbers as provisional until checked against real data, the same caveat `models.py` already carries for Garmin's workout condition-type IDs.

No accounts, and — apart from the food log below — no server-side database: the API holds only the Garmin session token (via the existing tokenstore/cooldown files below) and in-memory job state. Everything else — the imported plan, preferences, write-job history — lives in the browser.

### Fuelling and the food log

`training_plan/nutrition.py` scales published carbohydrate/protein consensus ranges by body weight and the training load of the day being fuelled for. Every figure is arithmetic the user could redo by hand; the framing is fuelling, never restriction (no calorie budgets, no weight targets, no judgement of what was eaten).

Two things break existing invariants, both deliberately and narrowly:

- **A database.** `training_plan/db.py` keeps one SQLite table (`food_entry`) plus the photos, under `~/.passo/` — override with `PASSO_DATA_DIR` or `PASSO_DB_PATH`. A food diary is a longitudinal record that nothing upstream holds and `localStorage` would lose to a cleared browser.
- **An outbound model call.** `training_plan/llm.py` is the only module in the codebase that talks to a language model, over OpenRouter's OpenAI-compatible endpoint. It has two independent roles: text (writes the Italian sentence over numbers already computed) and vision (reads a plate photo — the one genuinely perceptual task here). **Every function returns `None` instead of raising**: no screen depends on a model being reachable.

```bash
OPENRUTER_API_KEY=sk-or-...                      # note the spelling used by this project's .env
LLM_BASE_URL=https://openrouter.ai/api/v1        # point at a local Ollama/vLLM server to keep photos on the machine
LLM_TEXT_MODEL=deepseek/deepseek-v3.2
LLM_VISION_MODEL=qwen/qwen3-vl-235b-a22b-instruct  # must be vision-capable; DeepSeek has no such model
LLM_TIMEOUT_S=20
PASSO_PHOTO_UPLOAD=0                             # switch off sending plate photos to a hosted model
```

Model availability moves fast — check `https://openrouter.ai/api/v1/models` rather than trusting the defaults above. **Privacy, stated plainly:** with a hosted provider configured, plate photos leave the machine when they are estimated (and only then — they are otherwise stored locally and served back by entry id). `GET /nutrition/config` reports this so the UI can say so before the user takes a photo.

## Web app (Next.js)

The `web/` directory is a separate Next.js (App Router, TypeScript) project implementing the 15-screen "Passo" design — see `openspec/changes/passo-nextjs-web-app/` for the proposal/design/specs this was built from. It has no account system: a single "Inizia" button replaces the design's Google sign-in, and app state (imported plan, preferences, write-job history) lives entirely in the browser (`localStorage` via a persisted Zustand store) — there is no server-side user database. TanStack Query handles every call to the FastAPI backend above (diff preview, the sync-job poll, body/wellness reads); Framer Motion drives screen-to-screen transitions; the rest of the motion system (entrance cascades, the brand mark, button fills, pulse rings, progress rings) is plain CSS, with every keyframe ported verbatim from the design bundle's reference HTML.

Run it locally (two processes — the backend above must be running for anything beyond viewing already-persisted local state to work):

```bash
cd web
npm install
npm run dev
```

Serves on `http://localhost:3000` and expects the API at `http://127.0.0.1:8000` by default; override with a `web/.env.local` containing `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000` (or another host) if needed.

```bash
npm run build   # production build + type-check
npm run lint    # ESLint
```

**Known gaps, called out rather than silently left out** (see `openspec/changes/passo-nextjs-web-app/tasks.md` for the full list): no offline banner, no custom pull-to-refresh gesture (native browser overscroll only), Garmin body/wellness field shapes are not yet verified against a live account (`training_plan/body_insights.py`'s module docstring explains why and how this degrades safely), and the Settings screen's Garmin card doesn't yet support disconnecting or showing last-sync time (no backend endpoint for either exists yet). The build and lint are clean and the backend has test coverage, but the frontend has not been click-tested end-to-end in a real browser in an automated way — do that before treating this as production-ready.

## Architecture

The project is split into a presentation-independent core, a thin CLI, and a thin HTTP API, so the core can be called directly by anything:

- **`training_plan/models.py`, `parser.py`, `garmin_sync.py`** — pure logic: data models, YAML parsing/validation, and the Garmin Connect integration (auth, rate-limit guards, workout payload construction, diff/list/delete). No printing, no prompting.
- **`training_plan/body_insights.py`** — read-only Garmin wellness data (readiness, sleep, HRV, training load, VO₂max) and the derived body/plan conflict assessment. Same no-printing, no-prompting discipline as `garmin_sync.py`.
- **`training_plan/nutrition.py`** — pure fuelling arithmetic: session load classification (from step durations and the spread of the target paces), carbohydrate/protein targets, and the deterministic Italian advice sentence. No I/O, no model.
- **`training_plan/db.py`** — the food log: one SQLite table, entry CRUD, and local photo storage. The only persistent server-side state in the project.
- **`training_plan/llm.py`** — the only module that calls a language model. Two roles (text, vision), every function degrading to `None` rather than raising, so callers always have a template or a manual path to fall back to.
- **`training_plan/service.py`** — the orchestration seam: one function per operation (`preview_plan_sync`/`apply_plan_sync`, `list_workouts`, `preview_deletion`/`apply_deletion`, `verify_login`), each taking plain arguments and returning plain dataclasses (or raising `GarminSyncError`/`TrainingPlanValidationError`). Nothing here prints, prompts, or calls `sys.exit`. Write operations are split into a `preview_*` step (computes what would happen, writes nothing) and an `apply_*` step (performs the write), so a caller can show a preview and decide whether to proceed before anything touches Garmin.
- **`training_plan/cli.py`** — argument parsing and presentation only: it calls `service.py` and turns the result into printed output, interactive confirmation prompts, and process exit codes.
- **`training_plan/api/`** — the FastAPI adapter: request/response schemas (`schemas.py`), the async write-job store (`jobs.py`), and route handlers (`routes_plan.py`, `routes_garmin.py`, `routes_body.py`) that call `service.py`/`garmin_sync.py`/`body_insights.py` on a thread pool and shape the result to JSON. Like `cli.py`, it adds no business logic of its own.
