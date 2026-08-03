## Why

Everything the project does today — parsing a plan, talking to Garmin, diffing against the calendar — is reachable only by running a CLI script. A future webapp will need to call this same logic, but the BE framework/hosting for that webapp isn't decided yet and isn't being decided now. What can be done now, independent of that decision, is separating the reusable logic from the CLI's argparse/print/input plumbing and packaging it properly, so whatever BE gets chosen later can depend on this code directly instead of shelling out to a script or re-deriving the Garmin integration.

## What Changes

- Extract the orchestration currently inlined in the CLI's command handlers (`training_plan/cli.py`) — parse a plan, diff it against the calendar, sync, list, delete — into a new service module with plain function/class calls that take and return typed data, with no printing, no `input()` prompts, and no `sys.exit()`.
- Slim `cli.py` down to argument parsing and presentation only: it calls the service module and renders the result (prints, prompts for confirmation, sets the exit code). CLI behavior does not change from a user's point of view.
- Package the project properly (`pyproject.toml`): declared metadata, dependencies, and a console-script entry point for the CLI, so it's pip-installable as a library rather than only runnable as a loose script tree.
- **Explicitly not part of this change**: any web framework, any hosting choice, any database, any authentication, any deployment target. Those are BE/FE decisions for a later change, once made. This change only prepares the ground for them.

## Capabilities

### New Capabilities
- `garmin-training-service-api`: A presentation-independent service layer wrapping the existing plan-parsing and Garmin-sync operations (diff/sync/list/delete), callable by anything — CLI today, a future web backend later — without pulling in argparse, `print`, or `input`.
- `installable-package`: Proper Python packaging (`pyproject.toml`) so the project can be installed (`pip install -e .`) and depended on as a library, with a console-script entry point replacing the current loose-script invocation.

### Modified Capabilities
- None. This is a structural refactor; the behavior specified for the existing Garmin push/list/delete/diff operations (from the not-yet-archived `import-garmin-calendar-events` change) is unchanged — only how that behavior is reached internally.

## Impact

- **Code**: new `training_plan/service.py` (or equivalent); `training_plan/cli.py` shrinks to argument parsing + presentation, delegating to the service module; `models.py`, `parser.py`, `garmin_sync.py` are unchanged in behavior (may move if it clarifies the new layering, but their logic doesn't change).
- **New file**: `pyproject.toml`. `requirements.txt`/`requirements-dev.txt` either stay as-is or become derived from it — implementation detail, not a scope decision.
- **No new runtime dependencies**: no web framework, no database client, no auth library. This change adds zero new external services.
- **Tests**: the existing 64 tests must keep passing with equivalent coverage after the refactor; new tests are added for the service layer directly (not just through the CLI).
- **No behavior change for the end user**: running the CLI before and after this change produces the same output for the same inputs. This is verified, not assumed — regression is a task, not a footnote.
