## ADDED Requirements

### Requirement: Sessions and weeks are counted from the canonical history
The system SHALL count as a *session* every canonical stored activity (duplicates excluded) lasting at least 15 minutes, of any sport, and as a *run with heart rate* every such session of a running sport with a recorded average heart rate. Weeks SHALL be calendar weeks starting on Monday; only complete weeks count towards week-based criteria, and an *active week* is one with at least 2 sessions.

#### Scenario: Other sports count for consistency
- **WHEN** a week contains one run and one tennis session of 60 minutes each
- **THEN** the week is an active week

#### Scenario: Short activities do not count
- **WHEN** a week contains one run and a 10-minute walk
- **THEN** the week is not an active week

#### Scenario: A workout on both Garmin and Strava counts once
- **WHEN** a run is stored from Garmin and, as its duplicate, from Strava
- **THEN** it counts as one session

### Requirement: The level is computed from the history
The system SHALL compute the level from the history as follows, and SHALL evaluate each criterion deterministically so the same history always gives the same level:
- **Level 1 — abitudine**: every user.
- **Level 2 — struttura**: at least 6 active weeks among the last 8 complete weeks, and at least 4 runs with heart rate in those 8 weeks.
- **Level 3 — atleta**: the level 2 criteria, plus at least 20 weeks with 3 or more sessions among the last 26 complete weeks, plus an average of at least 150 minutes of running per week over the last 12 complete weeks, plus a lactate-threshold heart rate available from Garmin.

#### Scenario: New user with no history
- **WHEN** a user has no stored activities
- **THEN** the level is 1

#### Scenario: Regular multi-sport user who does not run
- **WHEN** a user has been active every week for 8 weeks with cycling and swimming only
- **THEN** the level is 1, and the missing criterion reported is the runs with heart rate

#### Scenario: Consistent runner without a threshold estimate
- **WHEN** a user meets every level 3 criterion except that Garmin returns no lactate-threshold heart rate
- **THEN** the level is 2, and the missing criterion reported is the threshold estimate

#### Scenario: Existing Garmin user
- **WHEN** a user connects Garmin with two years of regular running already recorded
- **THEN** after the backfill the level is computed from that history, without any manual step

### Requirement: The level is never lowered
The system SHALL store the highest level each user has reached and SHALL report the maximum of that stored level and the level computed now.

#### Scenario: Level reached then criteria lapse
- **WHEN** a user reached level 3 and their last 26 weeks no longer meet the level 3 criteria
- **THEN** the reported level is still 3

### Requirement: A long stop puts the user in pause, then in return
The system SHALL report the state `pausa` when the user has fewer than 2 sessions in the last 28 days and had trained before that window, and the state `ripresa` for the 21 days after the last day that was in `pausa`; otherwise the state is `attivo`. In `pausa` and `ripresa` the *effective level* SHALL be one below the level (never below 1); in `attivo` it SHALL equal the level.

#### Scenario: Injury break
- **WHEN** a level 3 user records one session in the last 28 days
- **THEN** the state is `pausa`, the level is 3 and the effective level is 2

#### Scenario: Coming back
- **WHEN** that user trains again, and 10 days have passed since the first session after the stop
- **THEN** the state is `ripresa` and the effective level is 2

#### Scenario: Back to normal
- **WHEN** more than 21 days have passed since the pause ended and the user kept training
- **THEN** the state is `attivo` and the effective level is 3

#### Scenario: A brand-new user is not in pause
- **WHEN** a user whose first ever session was 5 days ago has one session in total
- **THEN** the state is `attivo`

#### Scenario: Level 1 in pause
- **WHEN** a level 1 user is in `pausa`
- **THEN** the effective level is 1

### Requirement: The level is explained criterion by criterion
The system SHALL expose, for the current level and the next one, every criterion with its measured value, its required value and whether it is met, and SHALL name the criteria still missing for the next level. Level 3 users SHALL get no next level.

#### Scenario: Progress towards level 2
- **WHEN** a level 1 user has 4 active weeks among the last 8 and 5 runs with heart rate
- **THEN** the response reports the active-weeks criterion as 4 of 6, not met, the runs criterion as met, and the active weeks as the missing criterion

### Requirement: The level cannot be set by hand
The system SHALL NOT expose any way to set or override the level; the only input is the history.

#### Scenario: No write endpoint for the level
- **WHEN** a client tries to change the level through the API
- **THEN** no endpoint accepts it

### Requirement: The adaptation mode is a per-user preference with a level-based default
The system SHALL store an adaptation mode per user, `automatico` or `proposta`. Until the user sets one, the reported mode SHALL be the default for the effective level: `automatico` at levels 1 and 2, `proposta` at level 3. Once set by the user, the stored value SHALL be reported regardless of level.

#### Scenario: Default for a beginner
- **WHEN** a level 1 user has never set the mode
- **THEN** the reported mode is `automatico`, marked as the default

#### Scenario: User override survives a level change
- **WHEN** a level 1 user sets `proposta` and later reaches level 2
- **THEN** the reported mode is still `proposta`

### Requirement: The level is visible in settings
The system SHALL show, from the settings screen, the user's level with its name and a one-line meaning, the state when it is not `attivo`, and the progress towards the next level as the list of its criteria.

#### Scenario: Level screen for a level 2 user
- **WHEN** a level 2 user opens the level screen from settings
- **THEN** it shows "Livello 2 · struttura", what that level means, and the level 3 criteria with measured and required values
