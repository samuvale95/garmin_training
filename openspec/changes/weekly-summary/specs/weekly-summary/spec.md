## ADDED Requirements

### Requirement: The summary counts the week from stored data
The system SHALL compute, for a Monday-based week: planned sessions and planned running minutes (plan), sessions done and running minutes done (canonical history), the planned days on which something was done, the days trained, and whether the week is complete.

#### Scenario: Three of four
- **WHEN** a week had 4 planned sessions and the history has activities on 3 of those days
- **THEN** the summary reports 4 planned, 3 planned days trained

### Requirement: Consistency is counted in active weeks
The system SHALL report the streak of consecutive active weeks (at least `levels.ACTIVE_WEEK_SESSIONS` sessions) ending with the summarised week, or with the week before it while the summarised week is still in progress and not yet active.

#### Scenario: Fifth week in a row
- **WHEN** the summarised week and the 4 weeks before it each had at least 2 sessions, and the week before those had none
- **THEN** the streak is 5

### Requirement: The check-ins are summarised
The system SHALL report how many days of the week have a check-in, how many sessions felt `facile`, `giusta`, `dura`, `troppo`, the days reported `stanco`, and each day with pain and its area.

#### Scenario: Pain in the week
- **WHEN** Thursday's check-in reports pain at the ankle
- **THEN** the summary lists Thursday with `caviglia`

### Requirement: Headline and highlights carry the user's numbers
The system SHALL produce a headline and at most 4 highlights in Italian, each built from the figures above (for example "3 sedute su 4 pianificate", "5ª settimana di fila con almeno 2 allenamenti", "Dolore alla caviglia giovedì"), and the next week's plan: the skeleton's reason when it covers that week, otherwise the planned sessions and minutes.

#### Scenario: Next week from the skeleton
- **WHEN** the stored skeleton covers the week after the summarised one
- **THEN** the summary's next week carries that skeleton week's reason

### Requirement: The model phrases, the numbers decide
The system SHALL expose a narrative of at most two sentences written by the text model from the summary's facts, without numbers it was not given, and SHALL fall back to the headline when the model is unavailable.

#### Scenario: No model
- **WHEN** no model is configured
- **THEN** the narrative is the headline, with source `template`

### Requirement: The summary is reachable from the screens
The system SHALL expose `GET /summary/week?monday=` (default: the week just finished from Monday to Wednesday, the current week otherwise). The web SHALL have a summary screen with week paging, a card on Oggi from Monday to Wednesday about the week just finished, and a link from the week screen.

#### Scenario: Monday morning
- **WHEN** the user opens Oggi on a Monday
- **THEN** a card shows last week's headline and opens the summary
