## ADDED Requirements

### Requirement: The day's energy comes from every source, with the source said
The system SHALL compute for a day: each activity's calories (Garmin measured, else Strava, else an estimate from sport, duration and weight), Garmin's day total, resting and active calories when available, and an estimate of the day (resting metabolism, plus activities, plus steps). The day's expenditure SHALL be Garmin's total when available, otherwise the estimate, and SHALL name which one it is.

#### Scenario: Garmin day available
- **WHEN** Garmin reports 4,306 kcal for the day
- **THEN** the expenditure is 4,306 with source `garmin`, and the estimate is shown next to it for comparison

#### Scenario: No Garmin day
- **WHEN** Garmin's day summary is unavailable
- **THEN** the expenditure is the estimate, with source `stima`

### Requirement: The balance is about refuelling
The system SHALL compare the food logged with the day's expenditure and, on a training day, when the food logged is under 70% of the expenditure after 18:00 or for a past day, SHALL say how much is missing to refuel. It SHALL never suggest eating less.

#### Scenario: Long run, little food
- **WHEN** a past long-run day spent 4,300 kcal and 2,100 were logged
- **THEN** the balance says about 2,200 kcal were missing to refuel

### Requirement: Level 1 sees words, not numbers
At level 1 the energy card SHALL show no kcal figures, only sentences (for example "oggi hai speso molto: stasera mangia con calma e abbondante").

#### Scenario: Level 1
- **WHEN** a level 1 user opens the fuel screen on a long-run day
- **THEN** the energy card has no kcal numbers

### Requirement: The targets count the whole day
The day's fuelling load SHALL count every endurance activity of the day (all sports except strength and other low-glycogen sports), not only the planned run, when that is more than planned.

#### Scenario: Run plus ride
- **WHEN** a 40-minute planned run was done and a 90-minute ride was also recorded
- **THEN** the day is fuelled as a 130-minute day
