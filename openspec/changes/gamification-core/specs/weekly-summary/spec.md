## MODIFIED Requirements

### Requirement: Consistency is counted in active weeks
The system SHALL report the streak computed by the progress rules (active weeks, salva-serie tokens, weeks protected by reported pain) as of the summarised week, together with the points and badges earned in that week.

#### Scenario: Fifth week in a row
- **WHEN** the summarised week and the 4 weeks before it each had at least 2 sessions, and the week before those had none
- **THEN** the streak is 5

#### Scenario: Points of the week
- **WHEN** the summarised week earned 43 points
- **THEN** the summary reports 43 points with their lines
