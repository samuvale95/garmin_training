## ADDED Requirements

### Requirement: Training plan file format
The system SHALL define a YAML training-plan file format consisting of a top-level `sessions` list, where each entry describes one scheduled workout with the fields: `date` (ISO `YYYY-MM-DD`), `sport` (one of a supported enum: `running`, `cycling`, `swimming`, `strength_training`, `other`), `title`, an optional `description`, and an optional `steps` list for structured workouts.

#### Scenario: Minimal valid entry
- **WHEN** a session entry provides only `date`, `sport`, and `title`
- **THEN** the system treats it as a valid simple (single-block) workout with no structured steps

#### Scenario: Structured entry with steps
- **WHEN** a session entry includes a `steps` list, each with `type` (`warmup`, `interval`, `recovery`, `cooldown`), a `duration_type` (`time` or `distance`), and a `duration_value`
- **THEN** the system treats it as a structured multi-step workout preserving step order

### Requirement: File parsing produces structured entries
The system SHALL parse a training-plan YAML file into an in-memory list of workout entry objects, each carrying the normalized date, sport, title, description, and steps (if any), preserving the order entries appear in the file.

#### Scenario: Successful parse
- **WHEN** a well-formed training-plan file is parsed
- **THEN** the system returns one entry object per `sessions` item, in file order, with all declared fields populated

### Requirement: Validation of malformed entries
The system SHALL validate every session entry before use and SHALL reject the file with a clear, entry-specific error message (including the offending entry's position/date) when a required field is missing, a `date` is not a valid ISO date, a `sport` is not in the supported enum, or a `steps` entry is missing `type` or `duration_type`/`duration_value`.

#### Scenario: Missing required field
- **WHEN** a session entry omits `date`, `sport`, or `title`
- **THEN** the system reports a validation error identifying which entry (by index and/or title) and which field is missing, and does not proceed to sync any entries

#### Scenario: Invalid sport value
- **WHEN** a session entry's `sport` is not one of the supported enum values
- **THEN** the system reports a validation error naming the invalid value and the supported values, and does not proceed to sync any entries

#### Scenario: Invalid date format
- **WHEN** a session entry's `date` cannot be parsed as `YYYY-MM-DD`
- **THEN** the system reports a validation error identifying the entry and the invalid date string, and does not proceed to sync any entries
