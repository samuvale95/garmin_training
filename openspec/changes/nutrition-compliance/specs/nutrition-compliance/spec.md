## ADDED Requirements

### Requirement: Targets come from the stored plan and the real load
The system SHALL compute the day's targets from the server's stored plan when the request carries no sessions. For today and past days, when the history shows running minutes above 120% of the planned ones (or training on a day with nothing planned), the day's load SHALL be computed from what was run.

#### Scenario: Rest day that became a long run
- **WHEN** today had nothing planned and the history shows a 100-minute run today
- **THEN** today's load is computed from a 100-minute session, not as rest

#### Scenario: No sessions sent
- **WHEN** the client asks for targets without sessions
- **THEN** the targets use the stored plan's sessions

### Requirement: Compliance says in or missing, never "too much" as a fault
The system SHALL compare the day's logged totals with the targets per macro: `sotto` below the lower bound with the grams missing to it, `dentro` within the range, `sopra` above the upper bound. `sopra` SHALL never be presented as an error. When tomorrow's load is `duro` or `molto_lungo` and today's carbohydrate is `sotto`, the carbohydrate line SHALL say so with tomorrow's session. For today the wording SHALL be "finora"; with no entries the compliance SHALL be absent.

#### Scenario: Missing carbohydrate before a long run
- **WHEN** today's carbohydrate target is 350–450 g, 230 g are logged and tomorrow is a long run
- **THEN** the carbohydrate line is `sotto` with 120 g missing and names tomorrow's long run

#### Scenario: Above range
- **WHEN** protein logged is above its range
- **THEN** the protein line is `sopra`, worded as information, not a warning

### Requirement: Status in one answer
The system SHALL expose `GET /nutrition/status?date=` returning today's target, the logged totals and the compliance lines.

#### Scenario: Status after a meal
- **WHEN** the user logs a meal and the screen asks for the status
- **THEN** the compliance reflects the new totals

### Requirement: The fuel screen shows values, not a meal plan
The fuel screen SHALL show the compliance lines with the day's totals, SHALL NOT show a meal plan, SHALL keep the during-session and recovery values, and SHALL hide the energy (kcal) block at level 1.

#### Scenario: Level 1
- **WHEN** a level 1 user opens the fuel screen
- **THEN** no kcal figure is shown
