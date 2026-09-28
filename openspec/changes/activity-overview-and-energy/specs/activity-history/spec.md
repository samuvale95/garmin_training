## ADDED Requirements

### Requirement: Activities carry their calories
Each stored activity SHALL carry its calories and their source: `garmin` (the watch's figure), `strava` (Strava's, including rides whose kilojoules stand in for kilocalories), or none, to be estimated when read.

#### Scenario: Garmin run
- **WHEN** Garmin lists a run with 1,632 calories
- **THEN** the stored row has calories 1,632 and source `garmin`

### Requirement: Two devices recording one workout are one activity
A Strava activity not uploaded by Garmin SHALL be a duplicate of a Garmin activity of the same sport family that starts within five minutes of it and overlaps it for at least 80% of the shorter of the two.

#### Scenario: The same swim on two devices
- **WHEN** a Strava swim starts at 11:13 for 54 minutes and a Garmin swim at 11:15:51 for 45 minutes
- **THEN** the Strava swim is a duplicate of the Garmin one
