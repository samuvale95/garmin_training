## ADDED Requirements

### Requirement: The skeleton is computed by code
The system SHALL compute a skeleton of one entry per Monday-based week, from the week containing the window's first day to the week of the goal race, or of exactly 3 weeks when there is no goal. Each week SHALL carry: its phase (`base`, `costruzione`, `picco`, `scarico`, `gara` with a goal; `costanza` without), target running minutes, longest run allowed in minutes, number of quality sessions allowed, number of running days, whether it is a lighter week, and a sentence in Italian saying why, with the user's numbers. The skeleton SHALL be a pure function of the recent history figures, the effective level and the goal, with no model involved.

#### Scenario: Skeleton to a race
- **WHEN** the skeleton is computed for a user with a marathon 20 weeks away
- **THEN** it has one week per Monday up to and including the race week, the last one with phase `gara`

#### Scenario: No goal
- **WHEN** the skeleton is computed for a user with no goal
- **THEN** it has 3 weeks, all with phase `costanza`

### Requirement: Volume in the skeleton grows slowly and steps back
The skeleton SHALL start from the average weekly running minutes of the last 4 complete weeks, or from a per-level starting volume (L1 60, L2 100, L3 160 minutes) when the history is thin, and SHALL grow each building week by a per-level rate (L1 +5%, L2 +7%, L3 +10%) over the highest building week before it (over the recent average for the first week), rounded to 5 minutes; with thin history the first week SHALL be the starting volume itself. Every fourth week SHALL be lighter: L1 and L2 75%, L3 80% of the week before. Growth SHALL stop at a ceiling set by the goal distance and the level, and never below the starting volume. With a goal at least 3 weeks away, the week before the race SHALL be 75% and the race week 50% of the highest week.

#### Scenario: Athlete building towards a marathon
- **WHEN** a level 3 user averaging 181 minutes gets a skeleton to a marathon 20 weeks away
- **THEN** the first five weeks target 200, 220, 240, 190 and 265 minutes

#### Scenario: Beginner with no history
- **WHEN** a level 1 user with no recent running gets a skeleton without a goal
- **THEN** the weeks target 60, 65 and 70 minutes

### Requirement: Sessions per week follow the level and the user's habit
Each skeleton week SHALL allow running days equal to the user's median running days per week over the last 4 complete weeks plus one, within a per-level range (L1 2–4, L2 3–5, L3 3–6), and 3 days (L1, L2) or 4 days (L3) with no history. Quality sessions allowed SHALL be 0 at L1; 1 at L2; at L3 1 in `base` and 2 in `costruzione`, `picco` and `costanza`; one fewer in a lighter week or the week before the race, and 0 in the race week; and never more than the running days minus 2, so every week keeps at least the long run and one easy run.

#### Scenario: Beginner gets no quality
- **WHEN** a level 1 user's skeleton is computed
- **THEN** every week allows 0 quality sessions

#### Scenario: Three runs a week are not all hard
- **WHEN** a level 3 user's skeleton week in `costruzione` has 3 running days
- **THEN** it allows 1 quality session

#### Scenario: Habit caps the days
- **WHEN** a level 3 user ran 2 days a week in each of the last 4 complete weeks
- **THEN** the skeleton allows 3 running days a week

### Requirement: The skeleton is stored and reused
The system SHALL store the skeleton with the plan together with the inputs it was computed from, and SHALL reuse it for later generations. It SHALL recompute it when the goal changes, when the effective level changes, when the stored skeleton does not cover the whole window, or when the user asks for it.

#### Scenario: Goal changed
- **WHEN** a skeleton was stored for a half marathon and the user's goal is now a 10 km on another date
- **THEN** the next generation computes and stores a new skeleton

### Requirement: The window is the next two weeks and the rest of this one
The system SHALL generate sessions from tomorrow to the Sunday of the week two weeks after tomorrow's week (15 to 21 days). The week targets inside the window SHALL be the lower of the skeleton's target and the `plan-limits` volume limit for that week computed from the current history; in the week that contains today, the running minutes already done this week SHALL be subtracted from the target.

#### Scenario: Generating on a Sunday
- **WHEN** the user generates on Sunday 27 September 2026
- **THEN** the window is Monday 28 September to Sunday 18 October (21 days)

#### Scenario: The history is behind the skeleton
- **WHEN** the skeleton targets 265 minutes for a week but the volume limit from the current history is 220
- **THEN** that week's target in the window is 220

### Requirement: The model composes the window from a brief and returns a fixed shape
The system SHALL send the model a brief containing: the effective level and its meaning, the goal if any, the window dates, each window week's skeleton entry and target, the athlete's pace bands, the locked sessions in the window, the rules that apply at this level in words, and the output contract. The model SHALL return a JSON object `{"sessions": [...]}` whose sessions have the plan API's shape (date, sport, title, description, steps with paces as `m:ss`), and a description per session saying what the session is for.

#### Scenario: Locked sessions are in the brief
- **WHEN** the window contains a session the user edited by hand
- **THEN** the brief lists it by date and title as a fixed session the model must plan around

### Requirement: Paces come only from the athlete's bands
When the athlete has a pace profile, the system SHALL give the model named pace bands computed by code (easy, threshold, fast) and SHALL require a pace on every running warm-up, interval and cool-down step, within the fastest and slowest band. When the athlete has no pace profile, the system SHALL require that running steps carry no pace, and the session's effort SHALL be described in words.

#### Scenario: Invented pace rejected
- **WHEN** the model writes an interval at 3:30/km for an athlete whose fastest band ends at 4:25/km
- **THEN** the proposal fails the checks with a message naming the step and the allowed range

#### Scenario: No threshold, no paces
- **WHEN** a user with no pace profile gets a proposal with a pace on an easy step
- **THEN** the proposal fails the checks

### Requirement: Every proposal is checked before it can be written
The system SHALL reject a proposal unless all of the following hold: it parses into the output shape; every session is in the window, is `running`, and has steps with positive durations; no day has more than one session; no session falls on a day and sport held by a locked session; the paces satisfy the pace requirement; each week's running minutes are between 85% and 105% of its target (the lower bound only for targets of 30 minutes or more); each week has no more running days and no more `qualità` sessions than its skeleton entry and no run longer than its longest run; and `plan-limits` validation of the window, with its locked sessions, returns no violation.

#### Scenario: A rule violation blocks the write
- **WHEN** the model's proposal puts intervals the day after the long run for a level 2 user
- **THEN** nothing is written and the `hard_after_long` message is part of the feedback

### Requirement: Failed proposals are sent back, three attempts at most
When a proposal fails the checks, the system SHALL send the model the failure messages in Italian together with its previous answer and ask for a corrected proposal, for at most 3 attempts in total and within an overall time budget.

#### Scenario: Fixed on the second attempt
- **WHEN** the first proposal exceeds a week's target and the second passes every check
- **THEN** the second proposal is written and the response reports 2 attempts and source `ai`

### Requirement: A deterministic composer is the fallback
When no model is configured, the model is unreachable, or no attempt passes the checks, the system SHALL compose the window with a deterministic composer that places the long run and quality sessions on non-consecutive days, fills the remaining target with easy runs, uses the athlete's pace bands when available, and passes the same checks. The response SHALL state source `regole` and why the model was not used. When even the fallback fails the checks, nothing SHALL be written and the response SHALL say why.

#### Scenario: No model configured
- **WHEN** a user generates with no model key configured
- **THEN** the window is written by the composer, and the response says source `regole` with reason "modello non configurato"

### Requirement: Generation writes through the locks
The system SHALL write the accepted window with `plan_store.replace_unlocked` over the window's dates with origin `ai`: every unlocked session in the window is replaced, every locked session stays unchanged, and sessions outside the window are untouched.

#### Scenario: Hand-edited session survives
- **WHEN** the user edited Thursday's session by hand and then generates
- **THEN** Thursday's session is unchanged and the other days of the window hold the generated sessions

### Requirement: Generation is available through the API
The system SHALL expose `POST /plan/generate` (optional `regenerate_skeleton`), which returns the source, the number of attempts, the window, the window's skeleton weeks, the sessions written, the conflicts and the fallback reason if any; and `GET /plan/skeleton`, which returns the stored skeleton or none. The system SHALL refuse a second generation for the same user while one is running.

#### Scenario: Two clicks
- **WHEN** a generation is running and the same user calls `POST /plan/generate` again
- **THEN** the second call is refused with status 409

### Requirement: The week screen offers generation
The week screen SHALL offer "Genera le prossime settimane". Before starting, it SHALL say which dates will be replaced and that sessions edited by hand stay; while running, it SHALL say it can take up to a minute; afterwards it SHALL show whether the plan came from the AI or from the rules, each week's reason, and any conflict, and SHALL show the new sessions without a reload.

#### Scenario: After generating
- **WHEN** generation finishes
- **THEN** the week screen shows the new sessions and a summary with the source and each week's reason
