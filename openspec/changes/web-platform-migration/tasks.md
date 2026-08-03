## 1. Service layer extraction

- [x] 1.1 Create `training_plan/service.py`
- [x] 1.2 Implement `verify_login()` wrapping `GarminSync().login()`, raising on failure, no printing
- [x] 1.3 Implement `preview_plan_sync(sessions, no_diff, check_content)` — parses + optionally diffs, returns a result describing to-create/changed/already-present without writing to Garmin (takes already-parsed `sessions` rather than `file_path`, since the CLI needs the parsed sessions before deciding whether Garmin is even touched — parsing itself is already a pure, directly-importable function in `parser.py` and didn't need wrapping; also takes an optional `on_authenticated` hook, used to preserve the CLI's exact "print progress after login, before the diff call" ordering with a single login rather than two)
- [x] 1.4 Implement `apply_plan_sync(...)` — performs the create/replace calls for a previously computed preview, returns per-item results
- [x] 1.5 Implement `list_workouts(start, end)` wrapping `GarminSync.list_scheduled_workouts`
- [x] 1.6 Implement `preview_deletion(start, end, sport, title_match)` — lists + filters, no deletion
- [x] 1.7 Implement `apply_deletion(preview)` wrapping `GarminSync.delete_all` (takes the `DeletionPreview` rather than a raw workout list, so it reuses the preview's already-authenticated session instead of requiring a second login)
- [x] 1.8 Ensure no function in `service.py` calls `print`, `input`, or `sys.exit`; exceptions propagate uncaught
- [x] 1.9 Write unit tests for each service function directly (not through the CLI), covering success and error/exception paths — 16 tests in `tests/test_service.py`, including the login/diff call-ordering guarantee

## 2. CLI refactor to consume the service layer

- [x] 2.1 Refactor `_login` in `cli.py` to call `service.verify_login()`
- [x] 2.2 Refactor `_sync` to call `service.preview_plan_sync()` then `service.apply_plan_sync()`, keeping all printing/prompting/exit-code logic in `cli.py`
- [x] 2.3 Refactor `_list` to call `service.list_workouts()`
- [x] 2.4 Refactor `_delete` to call `service.preview_deletion()` then `service.apply_deletion()`, keeping the confirmation prompt in `cli.py`
- [x] 2.5 Update existing CLI tests' mocking targets to the new seam (`service.GarminSync`) where they previously patched `cli.GarminSync` directly; assertions on printed output and exit codes stayed unchanged
- [x] 2.6 Run the full test suite; confirm all tests pass with no changes to expected behavior — 80/80 pass

## 3. Manual regression check

- [x] 3.1 Run `sync --dry-run --no-diff` against a sample plan file, compare output to pre-refactor behavior — identical
- [x] 3.2 Run `sync --dry-run` (diff mode) against the real 33-session calendar, compare output to pre-refactor behavior — identical, including the `--deep` message-ordering path (verified separately against real Garmin data)
- [x] 3.3 Run `list`/`delete` (with `--dry-run`-equivalent care, or against non-destructive date ranges) and confirm output format is unchanged — `list` against real data, `delete` with a filter matching nothing (exercises the preview path with zero risk)

## 4. Packaging

- [x] 4.1 Add `pyproject.toml` (setuptools build backend) with project name, version, and dependencies mirroring the former `requirements.txt`
- [x] 4.2 Add a console-script entry point (`garmin-training-import`) pointing at `training_plan.cli:main`
- [x] 4.3 Verify `pip install -e .` succeeds in a clean virtual environment
- [x] 4.4 Verify the installed console-script command behaves identically to `python import_training_plan.py`
- [x] 4.5 Decide whether `requirements.txt`/`requirements-dev.txt` stay as the dependency source of truth or are superseded by `pyproject.toml` — decided: superseded, both files removed (avoids the two-places-to-update risk design.md flagged); `pip install -e ".[dev]"` replaces `pip install -r requirements-dev.txt`

## 5. Documentation

- [x] 5.1 Update `README.md` to describe the new layering (`service.py` vs. `cli.py`) and how a future consumer would import and call the service layer directly — new "Architecture" section
- [x] 5.2 Document the packaging/install steps (`pip install -e .`, console-script usage) in `README.md`
- [x] 5.3 Note explicitly in the README that web framework, hosting, database, and auth are not yet decided and out of scope for this refactor
