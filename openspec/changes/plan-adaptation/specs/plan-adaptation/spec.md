## ADDED Requirements

### Requirement: Adaptation starts from precise events
The system SHALL detect, from stored data only: `dolore` (a check-in today or yesterday reporting pain), `troppo` (yesterday's session reported `troppo`), `stanco` (body reported `stanco` today or yesterday), `prontezza` (today's readiness state `scarico`), `saltata` (a planned day in the last 3 days, before today, with no training), `diversa` (a planned day in the last 3 days with running minutes under 50% or over 150% of the planned ones), `soglia` (the Garmin threshold heart rate differs by 3 bpm or more from the one the plan was generated with). An event SHALL be identified by its kind and day and handled at most once.

#### Scenario: Skipped Tuesday
- **WHEN** Tuesday had a planned session, nothing was run on Tuesday, and today is Thursday
- **THEN** a `saltata` event for Tuesday is detected

#### Scenario: Handled once
- **WHEN** the `saltata` event for Tuesday was already handled
- **THEN** it is not detected again

### Requirement: The response is to soften or to replan
The system SHALL respond to `dolore` by softening every hard session (`qualità` or `lungo`) from today to 2 days ahead; to `troppo`, `stanco` and `prontezza` by softening the first day from today with a hard session within the next 2 days; to `saltata`, `diversa` and `soglia` by regenerating the window from tomorrow with the plan generator. When both are due, the regenerated sessions SHALL be softened by the same rules. A softened session SHALL be the easy version of the same session on the same day. Sessions done today and locked sessions SHALL never be changed; a locked hard session that a rule would soften SHALL be reported as a conflict.

#### Scenario: Knee pain
- **WHEN** the user reports knee pain today and tomorrow has intervals
- **THEN** the proposal turns tomorrow's intervals into an easy run of the same minutes, with the reason naming the pain

#### Scenario: Locked session
- **WHEN** the session a rule would soften was edited by the user
- **THEN** it is left unchanged and listed as a conflict

### Requirement: The mode decides between applying and proposing
The system SHALL use the user's adaptation mode (`automatico` or `proposta`, default by level). In `automatico` it SHALL apply the change and keep what it replaced so that it can be undone the same day. In `proposta` it SHALL store the change as pending; accepting SHALL apply it if the plan did not change meanwhile (otherwise recheck), rejecting SHALL mark its events handled without changing the plan.

#### Scenario: Automatic with undo
- **WHEN** a level 1 user reports pain and the change is applied automatically
- **THEN** Oggi shows what changed and why, and "Annulla" restores the previous sessions

#### Scenario: Proposal
- **WHEN** a level 3 user skipped a session
- **THEN** Oggi shows the proposed new sessions with Accetta and Rifiuta, and the plan is unchanged until Accetta

### Requirement: Every change says why
Each adaptation SHALL list its events in Italian with the user's facts ("Dolore al ginocchio segnalato oggi", "Martedì la seduta del piano è saltata") and each changed day with the session before and after.

#### Scenario: Reasons
- **WHEN** an adaptation is shown
- **THEN** every event has its sentence and every changed day shows before and after

### Requirement: Adaptation is reachable and configurable
The system SHALL expose `POST /plan/adaptation/check` (detect, respond, apply or store; one at a time per user, shared with plan generation), `GET /plan/adaptation` (the pending one, or the one applied today), and `POST /plan/adaptation/{id}/accept`, `/reject`, `/undo`. Oggi SHALL call the check once per day and after a check-in, and show the result. The level settings screen SHALL let the user choose automatic, proposal, or the level's default.

#### Scenario: Changing the mode
- **WHEN** a level 3 user sets the mode to automatic
- **THEN** the next adaptation is applied without asking
