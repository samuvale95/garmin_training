## ADDED Requirements

### Requirement: The streak counts active weeks and is protected by tokens
The system SHALL walk the Monday-based weeks of the last 52, oldest first. An active week (at least `levels.ACTIVE_WEEK_SESSIONS` sessions) SHALL extend the streak; every 4 consecutive active weeks SHALL earn a token, keeping at most 2. An inactive week with pain reported in a check-in SHALL be protected without spending a token; any other inactive week SHALL spend a token if one is held and otherwise reset the streak to 0. A protected week SHALL keep the streak without extending it. The week in progress SHALL count only once it is active.

#### Scenario: Token saves a week
- **WHEN** a user has 4 active weeks, then an inactive week, then an active one
- **THEN** the streak is 5, the token earned at week 4 is spent, and 0 tokens remain

#### Scenario: Injured week
- **WHEN** an inactive week has a check-in reporting pain
- **THEN** the streak is kept and no token is spent

#### Scenario: No token
- **WHEN** 2 active weeks are followed by an inactive week without pain
- **THEN** the streak is 0

### Requirement: Points reward discipline, never volume
The system SHALL compute points per completed day and week, each with a reason in Italian:
- planned day with a training: +10;
- planned rest day without training, in a week with at least one training: +5;
- check-in saved: +3;
- smart choice -- a planned hard day (`qualità` or `lungo`) with pain or tiredness reported that day or the day before, on which the user rested or ran at most 70% of the planned minutes: +10;
- active week: +20; every planned day of the week trained: +20;
- week with running minutes over 130% of the planned minutes: -10.
Without any plan in a week, each training day SHALL give +10, at most 5 days a week. No rule SHALL give points for minutes or distance.

#### Scenario: Running more than planned
- **WHEN** a week planned 150 minutes and the user ran 210
- **THEN** the week has a -10 line "oltre il piano del 40%"

#### Scenario: Listening to the body
- **WHEN** Thursday had planned intervals, Wednesday's check-in reported knee pain, and Thursday had no training
- **THEN** Thursday gives +10 with a reason naming the pain

### Requirement: Badges are verified by the data
The system SHALL award, with the date first earned: first session; first week with every planned day trained; 4, 12 and 26 active weeks in a row; first smart choice; 7 check-ins; level 2; level 3. An unearned badge SHALL show its progress (for example 3/4).

#### Scenario: Four in a row
- **WHEN** the streak reaches 4 for the first time on the week of 14 September
- **THEN** the badge "4 settimane di fila" is earned with that week's Sunday

### Requirement: The mascot reflects the day
The system SHALL choose one state for today: `esultanza` when a badge was earned in the last 3 days or the current week just became active; `corsa` when the user trained today; `riposo` on a planned rest day or with pain reported today or yesterday; `attesa` otherwise; each with one sentence.

#### Scenario: Pain
- **WHEN** the user reported pain yesterday and did not train today
- **THEN** the mascot is `riposo`

### Requirement: Progress is available and shown
The system SHALL expose `GET /progress` with the streak, tokens, this week's points and lines, the total over the last 52 weeks, badges and mascot. The web SHALL show a Progressi screen, a card on Oggi with mascot, streak and this week's points, and the week's points and badges in the weekly summary.

#### Scenario: Oggi card
- **WHEN** the user opens Oggi
- **THEN** a card shows the mascot, the streak with tokens, this week's points, and opens Progressi
