## ADDED Requirements

### Requirement: A session's kind comes from its structure
The system SHALL classify each planned session as `facile`, `lungo`, `qualità`, `forza` or `altro` from its sport, duration, repeat blocks and paces only. A running session with a repeat block, or with at least 5 minutes of work meaningfully faster than its own easy pace, SHALL be `qualità`; a running session of at least 90 minutes that is not `qualità` SHALL be `lungo`; `strength_training` SHALL be `forza`; other non-running sports SHALL be `altro`. `qualità` and `lungo` SHALL count as hard.

#### Scenario: Intervals are quality
- **WHEN** a running session contains a repeat block of 6 × 3 minutes
- **THEN** its kind is `qualità` and it counts as hard

#### Scenario: A steady 40-minute run is easy
- **WHEN** a running session is one 40-minute interval step at easy pace
- **THEN** its kind is `facile`

#### Scenario: Strides are not a workout
- **WHEN** a running session is 38 minutes easy followed by 4 × 30 seconds fast
- **THEN** its kind is `facile`

#### Scenario: The label does not matter
- **WHEN** a session titled "Corsa facile" contains 5 × 6 minutes at threshold pace
- **THEN** its kind is `qualità`

### Requirement: The rules and their thresholds depend on the effective level
The system SHALL evaluate the following rules on a window of planned sessions, with thresholds taken from the user's effective level (1, 2, 3):

| Rule | L1 | L2 | L3 |
|---|---|---|---|
| Planned weekly running minutes against the average of the last 4 weeks | +10% | +15% | +20% |
| Hard days in a row, at most | 1 | 2 | 2 |
| Hard session the day after the long run | not allowed | not allowed | allowed |
| Hard sessions per week, at most | 1 | 2 | 3 |
| Days without any session per week, at least | 2 | 1 | 1 |
| Share of planned running time at easy intensity, at least | 90% | 80% | 75% |
| Longest planned run against the longest run of the last 8 weeks | +15% | +15% | +15% |
| After 3 weeks of growing volume, the 4th at most | 80% of the 3rd | 80% of the 3rd | 85% of the 3rd |

When the user has little or no recent history, the volume and long-run rules SHALL use a per-level starting allowance instead of the recent figures, so a beginner can be given a first week at all.

#### Scenario: Two hard days in a row for a beginner
- **WHEN** a level 1 user's window has intervals on Tuesday and a long run on Wednesday
- **THEN** the `hard_in_a_row` rule is violated, naming both sessions

#### Scenario: The same days for an athlete
- **WHEN** a level 3 user's window has the same two sessions
- **THEN** `hard_in_a_row` is not violated

#### Scenario: Pause lowers the thresholds
- **WHEN** a level 3 user in `ripresa` (effective level 2) has a window with 3 hard sessions in one week
- **THEN** `hard_per_week` is violated with the level 2 limit of 2

#### Scenario: New user
- **WHEN** a user with no history gets a first week of 3 easy 30-minute runs
- **THEN** no volume or long-run rule is violated

### Requirement: Easy share counts time, step by step
The system SHALL compute the easy share from the planned time of each step: in a `qualità` session, steps meaningfully faster than the session's easy pace, and interval steps with no pace, SHALL count as hard time; warm-up, recovery, cool-down and easy steps SHALL count as easy time; every step of a `facile` or `lungo` session SHALL count as easy time.

#### Scenario: Warm-up of an interval session
- **WHEN** a session is 15 minutes warm-up, 6 × 3 minutes fast with 2-minute jog recoveries, 10 minutes cool-down
- **THEN** 18 minutes count as hard and 37 as easy

### Requirement: Every violation explains itself
The system SHALL return, for each violated rule, its key, a sentence in Italian with the user's own numbers, the limit applied and the level it came from, the dates and ids of the sessions involved, the rule's evidence (`ricerca`, `consenso` or `prudenza`) and whether it may be used to warn a user who moves a session.

#### Scenario: Volume violation message
- **WHEN** a level 1 user averaging 120 running minutes a week gets a planned week of 160
- **THEN** the violation says the week is 160 minutes against a limit of 132 (+10% on 120) for level 1

### Requirement: Only well-supported rules can warn on a move
The system SHALL mark each rule `warn_on_move` true or false, and SHALL mark it false for every rule whose evidence is `prudenza`.

#### Scenario: Volume growth does not warn on a move
- **WHEN** the rules are listed
- **THEN** `volume_growth`, whose evidence is `prudenza`, has `warn_on_move` false

### Requirement: The context comes from the stored history
The system SHALL build the rules' context from the stored canonical history and the level: average weekly running minutes over the last 4 complete weeks, the longest run of the last 8 weeks, and the effective level.

#### Scenario: Context of the real account
- **WHEN** the context is built for a user whose last 4 complete weeks had 66, 322, 200 and 137 running minutes
- **THEN** the recent weekly average is 181 minutes

### Requirement: Windows can be validated through the API
The system SHALL expose `POST /plan/validate`, which validates the sessions sent in the body or, when none are sent, the stored plan's sessions from today to 21 days ahead, and returns the context used and the violations.

#### Scenario: Validating the stored plan
- **WHEN** the client calls `POST /plan/validate` with an empty body
- **THEN** the response lists the violations of the next three weeks of the stored plan, with the context they were computed against
