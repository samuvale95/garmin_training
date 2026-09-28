## ADDED Requirements

### Requirement: A move is checked against the sequence around its new day
The system SHALL, for a planned session and a target day, evaluate the `plan-limits` rules marked `warn_on_move` at the user's effective level on the sessions from 7 days before to 7 days after the target day: planned sessions for today onwards and the stored history for past days. It SHALL return only violations that involve the moved session and that the same sequence without the move does not already have.

#### Scenario: Beginner stacks two hard days
- **WHEN** a level 1 user moves Thursday's intervals to Wednesday, the day after Tuesday's intervals
- **THEN** the check returns a `hard_in_a_row` warning naming both sessions

#### Scenario: Athlete makes the same move
- **WHEN** a level 3 user makes the same move
- **THEN** the check returns no warning

#### Scenario: A problem that was already there
- **WHEN** the week already had two hard days in a row that the moved session is not part of
- **THEN** the check does not warn about them

### Requirement: Reported pain warns before a hard session
The system SHALL warn when a hard session (`qualità` or `lungo`) is moved to a day within 2 days after a check-in reporting pain, naming the area and the day of the report.

#### Scenario: Intervals after knee pain
- **WHEN** the user reported knee pain yesterday and moves intervals to tomorrow
- **THEN** the check returns a pain warning "dolore al ginocchio segnalato" with its date

### Requirement: Every warning explains itself
Each warning SHALL carry the rule key, a sentence in Italian with the sessions and numbers involved, the evidence (`ricerca`, `consenso`, `prudenza`) and the dates of the sessions involved.

#### Scenario: Message content
- **WHEN** a `hard_after_long` warning is returned
- **THEN** its message names the long run's day and the moved session's day

### Requirement: An adapted session is offered
When there are warnings, the system SHALL offer an adapted version of the moved session on the target day: a `qualità` session with every fast step and repeat block turned into easy running of the same duration, a `lungo` shortened to below the long-run threshold; and it SHALL offer it only if the adapted session removes every warning.

#### Scenario: Intervals softened
- **WHEN** intervals moved next to another hard day produce a warning
- **THEN** the offered session has the same total minutes, no fast steps and no warning

### Requirement: A confirmed sequence does not warn again
The system SHALL record every decision (`confermo`, `adatta`, `annulla`) with the warnings it answered; after `confermo`, the same warning on the same sessions and dates SHALL not be returned again.

#### Scenario: Confirming
- **WHEN** the user confirms a `hard_in_a_row` warning and later moves another session in the same week
- **THEN** that same `hard_in_a_row` warning is not repeated

### Requirement: The move never waits for the check
The screens SHALL apply a move immediately, check it, and when there are warnings show them with the three choices: Confermo keeps the move, Adatta keeps the move with the adapted session, Annulla puts the session back on its day. A failed check SHALL leave the move as it is.

#### Scenario: Cancel
- **WHEN** the user drags a session, gets a warning and chooses Annulla
- **THEN** the session returns to its original day
