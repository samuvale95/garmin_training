## ADDED Requirements

### Requirement: Independent versioned goals
The system SHALL persist stable goals independently from programs, supporting race, performance, fitness, strength, consistency and maintenance, optional baseline/source/date, criterion, sports, priority and deadline or review date. A free program SHALL not require a race. Programs SHALL explicitly link to goals, with multiple programs allowed to contribute to one goal. Target changes SHALL retain immutable prior goal versions.

#### Scenario: Non-race maintenance program
- **WHEN** the user creates a maintenance goal and a linked program
- **THEN** no race distance or finishing time is required

#### Scenario: Program is archived
- **WHEN** a linked program is archived or regenerated
- **THEN** the goal identity and existing evaluations remain available

### Requirement: Evidence-qualified evaluations
Evaluations SHALL be dated, linked to the evaluated goal version and distinguish program execution, outcome progress and evidence quality. They SHALL identify evidence sources, freshness, comparability and missing measurements. Unsupported performance or strength outcomes SHALL remain insufficient data. Completion percentage SHALL not be presented as universal goal success. Predictions SHALL remain distinguishable from observations.

#### Scenario: All prescribed sessions completed
- **WHEN** every session is completed but no comparable result measurement exists
- **THEN** adherence can be reported while outcome progress remains unsupported or insufficient

#### Scenario: Goal target changes
- **WHEN** a target is edited after an evaluation
- **THEN** the previous evaluation retains its original target version and no calendar mutation is implied

### Requirement: Stable evidence and legacy migration
The system SHALL migrate existing race goals idempotently with provenance, retain race compatibility adapters and preserve history. Athlete totals SHALL count each canonical activity once even when it contributes to several goals. Non-race goals SHALL not be parsed as races.

#### Scenario: Shared activity supports two goals
- **WHEN** one activity contributes to fitness and consistency goals
- **THEN** both evaluations can cite it but athlete continuity and totals count the activity once
