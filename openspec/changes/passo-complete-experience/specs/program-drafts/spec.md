## ADDED Requirements

### Requirement: Durable isolated program drafts
The system SHALL persist user-owned AI and YAML proposals independently of active programs, with source content, inputs, revision, destination, goal links, sessions and recoverable generation state. Creating, parsing, editing or generating a draft MUST NOT create an active program, change calendar sessions or store an active skeleton. User-supplied contents SHALL remain available after validation failure.

#### Scenario: Generation fails or the browser closes
- **WHEN** a generation fails or its browser disconnects
- **THEN** reopening the draft shows its persisted inputs and completed result or a recoverable failure, and the active calendar is unchanged

#### Scenario: Dry-run creates a skeleton
- **WHEN** proposal generation needs a new skeleton
- **THEN** the skeleton remains in the draft and no active program metadata is written

### Requirement: Shared editable review
AI and import SHALL use one review model showing name, origin, effective detailed dates, sessions, weekly totals with homogeneous units, explicit new/merge/replace destination, affected program names and all additions, modifications, removals, preserved sessions and conflicts. Every draft edit SHALL increase revision and invalidate prior assessment. Import SHALL default to a new program and SHALL NOT rewrite its contents with AI without an explicit adaptation request.

#### Scenario: Imported replacement
- **WHEN** the user selects replacement of an owned program
- **THEN** review names that program and shows its exact replacement scope and preserved sessions before activation

#### Scenario: User edits a reviewed session
- **WHEN** a session in a validated draft changes
- **THEN** the previous validation token cannot activate the revised proposal

### Requirement: Atomic idempotent activation
The system SHALL activate the reviewed revision in one database transaction covering program metadata, sessions, skeleton, goal associations and the activation receipt. It SHALL verify current ownership, revision, review token and compatibility before changes. Completed, locked and out-of-range sessions SHALL retain identity and content. An already activated draft SHALL return its stored result on retry. Activation SHALL NOT contact Garmin.

#### Scenario: Failure midway through activation
- **WHEN** any session or association write fails
- **THEN** no portion of activation commits and the draft remains recoverable

#### Scenario: Response is lost after commit
- **WHEN** the client repeats activation of the same draft
- **THEN** the original result is returned without creating another program or session

### Requirement: Explicit publication and lifecycle
The system SHALL distinguish draft, active and archived programs from per-session Garmin publication state, keep archiving separate from deleting history, and offer explicit Garmin review after local activation. Unsupported source formats and unsupported generation ranges SHALL be identified before a misleading success.

#### Scenario: Program added to calendar
- **WHEN** activation succeeds
- **THEN** the UI confirms local calendar addition and offers a separate Send to Garmin action and a later option
