## ADDED Requirements

### Requirement: Project is installable as a package
The project SHALL be installable via standard Python packaging (`pip install .` / `pip install -e .`) using a `pyproject.toml` declaring its name, version, and runtime dependencies, so another codebase can depend on it as a library.

#### Scenario: Editable install in a clean environment
- **WHEN** `pip install -e .` is run in a fresh virtual environment against this project
- **THEN** the `training_plan` package becomes importable and all declared dependencies are installed

### Requirement: CLI is exposed as a console-script entry point
The packaging SHALL declare a console-script entry point for the CLI, so it can be invoked by its installed command name instead of only via `python import_training_plan.py`.

#### Scenario: Running the installed console script
- **WHEN** the package is installed and its console-script command is invoked
- **THEN** it behaves identically to running `python import_training_plan.py` with the same arguments
