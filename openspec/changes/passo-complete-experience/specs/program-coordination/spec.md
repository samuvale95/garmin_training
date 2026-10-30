## ADDED Requirements

### Requirement: Complete active context
Generation and compatibility assessment SHALL include every active program, relevant future commitments, goals/priorities, availability and relevant observed activity evidence, independently of display filters. Archived programs and unactivated drafts SHALL not reserve calendar time. Known mirrored activities/events SHALL be counted once; unreconciled evidence SHALL be disclosed.

#### Scenario: A hidden active program exists
- **WHEN** a new strength proposal is generated while the running program is hidden by a calendar filter
- **THEN** running commitments still constrain generation and assessment

### Requirement: Enforced and qualified compatibility
A common server evaluator SHALL check supported mandatory availability, daily session count, duration, ownership and preservation constraints for generated and imported proposals. It SHALL expose conflicts, missing inputs, supported sport-specific checks and unsupported checks using compatible/conflict/insufficient_data states. Missing or estimated data SHALL NOT be represented as verified exact duration or universal training safety. Mandatory conflicts SHALL block activation; only missing non-enforceable information can be acknowledged explicitly.

#### Scenario: Daily availability is exceeded
- **WHEN** known existing and proposed session duration exceeds declared available minutes
- **THEN** validation reports the date and constraint and activation is rejected without calendar changes

#### Scenario: Cross-sport load is unavailable
- **WHEN** the system has no defensible common running and strength load measure
- **THEN** it reports that limitation and does not add invented distance or claim full load compatibility

### Requirement: Reviews reject changed contexts
Review SHALL record a canonical version of active membership, relevant session contents including ownership/lock/short variants, program metadata, goals and constraints. Activation SHALL serialize with all legacy and new relevant writers, re-read the context inside its transaction and reject stale reviews. A new relevant session or newly activated program SHALL invalidate review even if it was absent from the previous snapshot.

#### Scenario: Another program changes during generation
- **WHEN** another active program is edited after draft context capture
- **THEN** the old assessment cannot activate and the user must inspect a renewed review

#### Scenario: Concurrent session insertion
- **WHEN** a new commitment is inserted concurrently with activation
- **THEN** transaction serialization ensures either the insertion is included in activation validation or activation completes first without a check-to-write race

### Requirement: Existing programs remain protected
The system SHALL initially adapt only the new proposal. It SHALL not silently modify other programs based on goal priority or an AI suggestion. Proposed existing-program changes SHALL be visible and confirmed before any supported coordinated application; unsupported coordinated changes SHALL remain unresolved conflicts.

#### Scenario: No free day exists
- **WHEN** a new program cannot fit mandatory availability around existing programs
- **THEN** it remains a draft with actionable conflicts and existing sessions remain unchanged
