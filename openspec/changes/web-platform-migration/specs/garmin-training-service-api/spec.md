## ADDED Requirements

### Requirement: Service functions are free of presentation concerns
The service layer SHALL expose the plan-parsing and Garmin-sync operations (verify login, preview/apply a plan sync, list scheduled workouts, preview/apply a deletion) as plain functions or methods that take typed arguments and return typed results, and SHALL NOT print to stdout/stderr, prompt for input, or terminate the process.

#### Scenario: Calling a service function directly
- **WHEN** a service function is called directly (not through the CLI)
- **THEN** it performs its operation and returns a result object or raises an exception, producing no console output and no process exit

#### Scenario: Errors propagate as exceptions
- **WHEN** an underlying operation fails (invalid plan file, Garmin authentication failure, rate limit, API error)
- **THEN** the service function raises the corresponding exception rather than printing an error and returning a sentinel value

### Requirement: Preview and apply are separate steps for write operations
For operations that can write to Garmin (syncing new/changed sessions, deleting workouts), the service layer SHALL provide a preview step that computes what would happen without writing anything, and a separate apply step that performs the writes, so a caller can act on the preview (e.g. show it to a user for confirmation) before any write occurs.

#### Scenario: Preview performs no writes
- **WHEN** a preview function is called
- **THEN** no workout is created, scheduled, or deleted on Garmin as a result of that call

#### Scenario: Apply acts on a previously computed preview
- **WHEN** an apply function is called with a preview's result
- **THEN** it performs exactly the writes that preview described, and returns a per-item success/failure result

### Requirement: CLI behavior is unchanged after delegating to the service layer
The existing CLI commands (`login`, `sync` with its flags, `list`, `delete`) SHALL produce the same output and exit codes as before this change, for the same inputs and the same underlying Garmin/file state, after being refactored to call the service layer instead of inlining the same logic.

#### Scenario: Regression check
- **WHEN** the CLI test suite that existed before this refactor is run against the refactored CLI
- **THEN** it passes without needing its expected outputs or exit codes changed (test setup/mocking may change to target the new seam)
