## MODIFIED Requirements

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

In a window of several weeks, each week's volume SHALL be compared against the higher of the recent 4-week average and the highest of the up to 3 planned weeks before it, so a week after a lighter one can return to the volume before it without that counting as growth.

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

#### Scenario: Back to volume after a deload
- **WHEN** a level 1 user averaging 300 minutes has planned weeks of 320, 340, 270 and 345 minutes
- **THEN** `volume_growth` is not violated in the fourth week, whose limit is 374 (+10% on 340)
