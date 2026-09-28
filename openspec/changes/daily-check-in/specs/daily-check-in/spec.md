## ADDED Requirements

### Requirement: A check-in is two answers for one day
The system SHALL store at most one check-in per user and day, with `effort` (`facile`, `giusta`, `dura`, `troppo`, or none on a day without training), `body` (`bene`, `stanco`, `dolore`) and, only when `body` is `dolore`, a `pain_area` from a fixed list (`piede`, `caviglia`, `polpaccio`, `stinco`, `ginocchio`, `coscia`, `anca`, `schiena`, `altro`). Saving a check-in for a day that already has one SHALL replace it.

#### Scenario: Pain needs an area
- **WHEN** a check-in is saved with body `dolore` and area `ginocchio`
- **THEN** it is stored with that area

#### Scenario: Area without pain is refused
- **WHEN** a check-in is saved with body `bene` and area `ginocchio`
- **THEN** the request is refused with a validation error

#### Scenario: Answering twice
- **WHEN** the user saves a second check-in for the same day
- **THEN** the day holds only the second one

### Requirement: Check-ins are available through the API
The system SHALL expose `GET /checkins?start&end` (the check-ins in the range, by date), `PUT /checkins/{date}` and `DELETE /checkins/{date}`. A date in the future SHALL be refused.

#### Scenario: Tomorrow
- **WHEN** the client saves a check-in dated tomorrow
- **THEN** the request is refused

### Requirement: Oggi asks at the right moment
The Oggi screen SHALL show the check-in card when the user trained today and has no check-in for today, or, before today's training, when they trained yesterday and have no check-in for yesterday; "trained" is a completed activity from the watch, or a planned session for that day when no watch is connected. After answering, the card SHALL show the answers with a way to change them, and SHALL disappear the next day.

#### Scenario: After a run
- **WHEN** the user has a completed run today and no check-in for today
- **THEN** Oggi shows "Com'è andata?" with the effort and body answers

#### Scenario: Rest day
- **WHEN** the user did not train today or yesterday
- **THEN** Oggi shows no check-in card

### Requirement: The day's verdict reads the check-in
The readiness verdict SHALL add a signal from the check-ins of today and yesterday: pain reported (strong, naming the area and the day), a session reported `troppo` (moderate), a body reported `stanco` (moderate). Each signal's detail SHALL say which answer produced it.

#### Scenario: Knee pain yesterday
- **WHEN** yesterday's check-in reports pain at the knee and today a hard session is planned
- **THEN** the verdict includes a strong signal "Dolore al ginocchio segnalato ieri" and its state is at least `cauto`
