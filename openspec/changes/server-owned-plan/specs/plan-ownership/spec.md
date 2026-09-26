## ADDED Requirements

### Requirement: Every session has a stable id
The system SHALL store each planned session as its own record with an id that never changes for the life of the session, and SHALL return that id with every session it serves.

#### Scenario: Moving a session keeps its id
- **WHEN** the user moves a session from Tuesday to Thursday
- **THEN** the session served afterwards has the same id and the new date

#### Scenario: Two identical sessions stay distinct
- **WHEN** a plan contains two sessions with the same date, sport and title
- **THEN** they have different ids, and editing one does not change the other

### Requirement: Every session records its origin and lock
The system SHALL record for each session its origin (`import`, `manual` or `ai`) and whether it is locked. A session SHALL become locked when the user creates, edits or moves it, and SHALL stay locked until the user explicitly unlocks it.

#### Scenario: Imported session is unlocked
- **WHEN** a plan is imported from a YAML file
- **THEN** every session has origin `import` and is unlocked

#### Scenario: User edit locks the session
- **WHEN** the user changes the steps of an imported session
- **THEN** the session is locked and its origin is still `import`

#### Scenario: User-created session
- **WHEN** the user adds a session in the app, including one proposed by `/coach/plan`
- **THEN** its origin is `manual` and it is locked

### Requirement: Non-user writers never change locked sessions
The system SHALL provide a single server-side path for changes not made by the user, which replaces the unlocked sessions of a date range with a new set, SHALL leave every locked session in that range unchanged, and SHALL report which proposed sessions conflicted with a locked one (same day and sport) and were therefore not written.

#### Scenario: AI replaces a week around a locked session
- **WHEN** the non-user writer replaces the sessions from Monday to Sunday, and Wednesday holds a locked session
- **THEN** the unlocked sessions of that week are replaced, Wednesday's locked session is unchanged, and a proposed Wednesday session of the same sport is reported as a conflict and not written

#### Scenario: Sessions outside the range are untouched
- **WHEN** the non-user writer replaces one week
- **THEN** sessions before and after that week are unchanged, locked or not

### Requirement: Sessions are changed one at a time
The system SHALL expose endpoints to create a session, update a session (content or date) and delete a session by id, and SHALL NOT require the client to send the whole plan to change one session.

#### Scenario: Concurrent writers do not clobber each other
- **WHEN** the non-user writer changes next week's unlocked sessions and, afterwards, the user edits a session of this week from a device that loaded the plan earlier
- **THEN** both changes are kept

#### Scenario: Unknown session
- **WHEN** the client updates or deletes an id that does not exist for this user
- **THEN** the request fails with a not-found error and nothing changes

### Requirement: The YAML file is import and export
The system SHALL replace the plan's sessions when a YAML file is imported, and SHALL export the current plan, including sessions added or edited in the app, as YAML that the importer accepts.

#### Scenario: Round trip
- **WHEN** the user exports the plan and imports the exported file into an empty account
- **THEN** the imported sessions have the same dates, sports, titles, descriptions and steps as the exported ones

#### Scenario: Importing replaces the plan
- **WHEN** the user imports a new YAML file over an existing plan
- **THEN** the plan holds exactly the sessions of the new file, all with origin `import` and unlocked

### Requirement: Existing plans migrate without loss
The system SHALL, once, turn every session stored in the previous plan blob into a session record with origin `import`, unlocked, keeping order, content and goal.

#### Scenario: Plan saved before this change
- **WHEN** a user with a plan saved before this change opens the app after the deploy
- **THEN** they see the same sessions, now with ids, and nothing is lost or duplicated

#### Scenario: Migration runs once
- **WHEN** the migration has already run for a user
- **THEN** running the startup again creates no additional sessions
