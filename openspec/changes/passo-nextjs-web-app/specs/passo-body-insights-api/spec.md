## ADDED Requirements

### Requirement: Morning body snapshot endpoint
The system SHALL expose a read-only endpoint returning the current day's physiological snapshot needed by screen 11 — training readiness score, sleep phases for the most recent night, a 7-day HRV series, resting heart rate with its delta from a recent baseline, battery level, and stress — sourced from the `garminconnect` client's existing wellness endpoints.

#### Scenario: Snapshot returns all fields when Garmin has synced overnight data
- **WHEN** the frontend requests today's body snapshot and the watch has synced the prior night
- **THEN** the response includes readiness, sleep phases, the 7-day HRV series, resting HR (+ delta), battery, and stress

#### Scenario: Missing overnight sync is reported explicitly, not as an error
- **WHEN** the frontend requests today's body snapshot and no overnight sync has occurred yet
- **THEN** the response indicates which fields are unavailable (rather than returning a 5xx or fabricated values), so the frontend can render the neutral "L'orologio non ha ancora sincronizzato la notte" empty state

### Requirement: Training load and form endpoint
The system SHALL expose a read-only endpoint returning the data screen 12 needs: a 4-5 week training-load history (completed vs. planned volume per week, with a flag marking the current in-progress week), the acute:chronic workload ratio, and VO₂max.

#### Scenario: Load endpoint distinguishes completed weeks from the current week
- **WHEN** the frontend requests the training-load history
- **THEN** the response marks exactly one week as in-progress (the current week) and the rest as completed, so the frontend can render the "settling" bar treatment only on the current week's column

### Requirement: Derived body/plan conflict
The system SHALL expose a read-only endpoint that compares the current body snapshot against the next planned session (from the plan already known to the frontend) and returns whether a conflict exists plus two concrete, session-specific resolution options — this is derived on each request, never stored.

#### Scenario: A conflict includes two concrete, actionable options
- **WHEN** the morning snapshot shows a significant negative signal (e.g. sharply reduced readiness or HRV) against a demanding session planned for the next day
- **THEN** the response reports the conflict as present and includes two concrete options (e.g. "move to tomorrow, easy run shifts to today" / "keep it, but softer: N reps instead of M, pace X") plus an implicit third path of leaving the plan unchanged — never a generic "reconsider your training" message

#### Scenario: No conflict when signals and plan agree
- **WHEN** the morning snapshot shows no significant negative signal, or no session is planned for the next day
- **THEN** the response reports no conflict

### Requirement: Body insights endpoints are strictly read-only
The system SHALL NOT allow any endpoint under this capability to write to Garmin Connect, and none of these endpoints requires or accepts plan-modification input beyond the read used to compute the derived conflict.

#### Scenario: No write side effects from a body-insights request
- **WHEN** any `passo-body-insights-api` endpoint is called
- **THEN** no Garmin workout, schedule, or account data is created, modified, or deleted as a result
