## ADDED Requirements

### Requirement: Training plan file format
The system SHALL define a YAML training-plan file format consisting of a top-level `sessions` list, where each entry describes one scheduled workout with the fields: `date` (ISO `YYYY-MM-DD`), `sport` (one of a supported enum: `running`, `cycling`, `swimming`, `strength_training`, `other`), `title`, an optional `description`, and an optional `steps` list for structured workouts.

#### Scenario: Minimal valid entry
- **WHEN** a session entry provides only `date`, `sport`, and `title`
- **THEN** the system treats it as a valid simple (single-block) workout with no structured steps

#### Scenario: Structured entry with steps
- **WHEN** a session entry includes a `steps` list, each with `type` (`warmup`, `interval`, `recovery`, `cooldown`), a `duration_type` (`time` or `distance`), a `duration_value`, and an optional `target_pace`
- **THEN** the system treats it as a structured multi-step workout preserving step order

### Requirement: Target pace on steps
The system SHALL support an optional `target_pace` field on each step, expressed in minutes:seconds per kilometre, accepting either an explicit range (`"4:30-4:20"`) or a single pace (`"4:30"`). A single pace SHALL be widened into a range, since Garmin stores pace targets as a range rather than an exact value. A range SHALL be accepted in either order, with the slower and faster bounds normalized by the system.

#### Scenario: Explicit pace range
- **WHEN** a step declares `target_pace: "4:30-4:20"`
- **THEN** the system records a pace target whose slower bound is 4:30/km and whose faster bound is 4:20/km

#### Scenario: Range given in reversed order
- **WHEN** a step declares `target_pace: "4:20-4:30"`
- **THEN** the system normalizes it to the same target as `"4:30-4:20"`

#### Scenario: Single pace value
- **WHEN** a step declares `target_pace: "4:30"`
- **THEN** the system records a pace target widened by a fixed tolerance in each direction around 4:30/km

#### Scenario: Step without a pace target
- **WHEN** a step omits `target_pace`
- **THEN** the system records no pace target for that step

#### Scenario: Malformed pace value
- **WHEN** a step's `target_pace` is not a valid `M:SS` pace or `M:SS-M:SS` range, or its two bounds are identical
- **THEN** the system reports a validation error identifying the entry, the step position, and the offending value, and does not proceed to sync any entries

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
