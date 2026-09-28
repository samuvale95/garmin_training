## ADDED Requirements

### Requirement: Every activity is listed from the stored history
The system SHALL expose `GET /activities?start&end` returning the canonical activities of the range (a Strava copy of a Garmin activity once, Strava-only activities included), each with day, start time, sport, title, duration, distance, calories and calories source.

#### Scenario: A Strava-only ride
- **WHEN** a ride exists only on Strava
- **THEN** it is listed with its duration and an estimated calorie figure with source `stima`

### Requirement: The week shows what happened outside the plan
The week screen SHALL show, in each day, every activity done that day that does not correspond to a planned session of the same sport family, as a "fuori piano" card with sport, duration, distance and calories. Without a plan, every activity SHALL be shown this way.

#### Scenario: Bike on a running day
- **WHEN** Tuesday had a planned run, the run was done, and a ride was also recorded
- **THEN** Tuesday shows the planned run as done and the ride as "fuori piano"
