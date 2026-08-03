## Context

The project is a Python CLI: `import_training_plan.py` → `training_plan/cli.py` (argparse, `print`, `input()`) calling into `training_plan/garmin_sync.py` (`GarminSync` — auth, diff, create/schedule, list, delete; already free of CLI concerns — it returns dataclasses like `SyncResult`/`DeleteResult`/`PlanDiff`, never prints) and `training_plan/parser.py` (pure YAML parsing/validation). The orchestration that ties these together for each CLI command — "parse the file, diff it, decide what to do based on flags, call sync, format the result" — currently lives inside `cli.py`'s command handlers (`_sync`, `_list`, `_delete`), interleaved with the argparse/print/input calls.

A webapp is planned, but which BE framework and hosting it will use is an open, deliberately unmade decision. This change does the one piece of work that's useful regardless of that decision: pull the orchestration out from behind the CLI so it's callable directly.

## Goals / Non-Goals

**Goals:**
- A service layer whose functions take plain arguments and return the existing typed dataclasses (`PlanDiff`, `SyncResult`, `DeleteResult`, etc.) — no printing, no prompting, no process exit codes.
- `cli.py` becomes a thin renderer: parse args, call the service, print/prompt/exit based on the result. All existing CLI behavior (`login`, `sync` with `--dry-run`/`--no-diff`/`--deep`/`--update`, `list`, `delete`) is preserved exactly.
- Proper packaging (`pyproject.toml`) so the project can be `pip install -e .`'d by another codebase later.
- Zero new runtime dependencies, zero infrastructure decisions.

**Non-Goals:**
- Choosing a web framework, hosting target, database, or auth mechanism — not decided, not attempted here.
- Any monorepo scaffold (e.g. `apps/`/`packages/` split) — that presupposes a repo-topology decision (single repo vs. separate FE/BE repos) that hasn't been made either.
- Changing any Garmin-facing behavior — payload construction, rate-limit guards, diff/hash logic are untouched; this is purely about where the orchestration code lives.
- Async/concurrency changes — the service layer stays synchronous, matching the current code; a future BE can wrap it (e.g. run it in a thread pool) however it needs to.

## Decisions

### Extract orchestration into `training_plan/service.py`
Each CLI command's handler currently mixes three concerns: reading flags, orchestrating parser+GarminSync calls, and rendering output. The new `service.py` takes over the middle piece only. Concretely, one function per operation, mirroring the CLI commands 1:1 so the refactor is mechanical and low-risk rather than a redesign:

- `verify_login(...) -> None` (raises on failure) — wraps `GarminSync().login()`.
- `preview_or_sync_plan(file_path, no_diff, check_content) -> PlanSyncPlan` — parses the file, optionally diffs, and returns a result object describing what *would* happen (to-create, changed, already-present) without writing anything. Writing is a separate, explicit step.
- `apply_plan_sync(plan: PlanSyncPlan) -> list[SyncResult | DeleteResult]` — actually performs the create/replace calls for a previously computed plan. Splitting preview from apply is what lets the CLI keep its interactive confirmation prompt (`--update` without `--yes`) as pure presentation logic, with no Garmin-writing code behind it.
- `list_workouts(start, end) -> list[ScheduledWorkout]`.
- `preview_deletion(start, end, sport, title_match) -> list[ScheduledWorkout]`.
- `apply_deletion(workouts) -> list[DeleteResult]`.

None of these print, prompt, or call `sys.exit`. `GarminSyncError`/`GarminRateLimitError`/`TrainingPlanValidationError` propagate as exceptions — `cli.py` is the only place that catches them to print a message and set an exit code.

### `cli.py` keeps argparse and all I/O, nothing else
After the extraction, `cli.py`'s command handlers (`_sync`, `_list`, `_delete`, `_login`) parse arguments, call one or two service functions, and format the result — the interactive "Proceed with deletion? [y/N]" / "N session(s) will be DELETED..." prompts stay here, since they're presentation, not logic. This mirrors how `GarminSync` itself was already kept free of `print`/`input` in the previous change — this refactor applies the same separation one layer up.

### Packaging: `pyproject.toml`, keep the `training_plan` import name
Add a standard `pyproject.toml` (setuptools or hatchling — no build complexity needed, this isn't shipping compiled artifacts) declaring the project name, version, dependencies (mirroring `requirements.txt`), and a console-script entry point (e.g. `garmin-training-import = training_plan.cli:main`). The Python import package stays named `training_plan` — renaming it now would be churn with no benefit before a consuming BE exists to have an opinion about naming. `requirements.txt`/`requirements-dev.txt` can stay as the source of truth for dependency versions, referenced from `pyproject.toml`, to avoid maintaining the same version pins in two places.

### Why not go further (no monorepo layout, no interface/protocol abstraction)
It would be possible to also introduce an abstract "operations" protocol/interface, or restructure the repo into `packages/core` + a placeholder `apps/` directory, in anticipation of the eventual webapp. Both are premature: an interface with exactly one implementation is speculative generality, and a repo-topology decision (single repo vs. polyrepo, monorepo tool choice) depends on the BE choice this change is deliberately not making. Plain functions returning plain dataclasses are already about as easy to wrap in any framework as it gets; adding structure beyond that would be guessing at requirements a future, unmade decision will actually set.

## Risks / Trade-offs

- **[Risk] Mechanical extraction can still introduce behavior drift** (e.g. an error path that was caught differently, an edge case in flag handling). → Mitigation: the existing 64 tests must pass unmodified in *assertions* (mocks/targets may need updating since some currently patch `cli.GarminSync` directly — that's expected and fine) after the refactor; no test's expected behavior changes, only how the test reaches it.
- **[Risk] Splitting "preview" from "apply" (for the `--update`/delete confirmation flows) adds a small amount of surface area versus the current single-pass CLI functions.** → Mitigation: this split is what makes the interactive-confirmation UX possible without embedding Garmin-writing calls inside presentation code — it's required for a clean separation, not incidental complexity, and mirrors the diff-then-confirm shape the CLI already has today.
- **[Trade-off] Choosing to keep the `training_plan` package name and skip a monorepo scaffold means some renaming/restructuring may still be needed later** once a BE framework and repo topology are chosen. Accepted: guessing at that structure now, before the decision exists, is more likely to be wrong (and require undoing) than useful.

## Migration Plan

1. Add `training_plan/service.py` with the functions above, calling straight into the existing `parser`/`garmin_sync` code (no behavior change yet). Unit test it directly, independent of the CLI.
2. Refactor `cli.py`'s command handlers to call the service functions instead of inlining the logic; update any tests that mock `cli.GarminSync`/`cli.parse_training_plan` to mock the service layer instead, where that's now the correct seam.
3. Run the full test suite; manually smoke-test the CLI (`--dry-run` paths, no live Garmin calls needed) to confirm output is byte-for-byte the same as before for the same inputs.
4. Add `pyproject.toml`; verify `pip install -e .` works in a clean virtualenv and the console-script entry point runs.
5. Update the README to describe the new layering (service vs. CLI) so a future BE implementer knows where to start.

No rollback complexity: this is a pure refactor with no data/schema/infra involved.
