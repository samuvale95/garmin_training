## ADDED Requirements

### Requirement: A single session can be created from the week screen
The system SHALL implement screen "10b Crea o modifica allenamento" in create mode, opened from screen 09 Settimana's "+" icon, presenting an empty form (activity type chip, title, empty structure list, empty notes) rather than any prefilled session.

#### Scenario: Create mode starts empty
- **WHEN** screen 10b is opened from screen 09's "+" icon
- **THEN** no activity type is pre-selected beyond the form's default, the title field is empty, the structure list has no steps, and the notes field is empty

### Requirement: An existing session can be edited from the session detail screen
The system SHALL implement screen 10b in edit mode, opened from screen 10 Sessione's header pencil icon, precomposed with that session's current activity type, title, structure (steps in order), and notes.

#### Scenario: Edit mode is precomposed with the session's current data
- **WHEN** screen 10b is opened from screen 10's pencil icon for a given session
- **THEN** every field (activity type, title, steps, notes) reflects that session's current values, not a blank form

### Requirement: Exactly one activity type is selectable via chips
The system SHALL present activity type as a single-select chip group (Corsa/Bici/Forza/Nuoto/Riposo), where selecting one chip deselects any other, and the selection drives the icon/color association used elsewhere in the app for that session.

#### Scenario: Selecting a chip changes the session's type
- **WHEN** a user taps a different activity type chip than the currently selected one
- **THEN** the previously selected chip is deselected, the new one becomes selected, and exactly one chip is selected at all times

### Requirement: The structure list supports reordering, per-step editing, and adding steps
The system SHALL render the session's steps as a reorderable list (drag handle per row), where each row shows the step's name and duration/distance, a pencil icon opens a per-step editor (duration, target pace/power, recovery), and a "+ step" control appends a new row.

#### Scenario: Dragging a step changes its position in the structure
- **WHEN** a user drags a step's handle to a new position in the list
- **THEN** the session's step order is updated to match the new visual order

#### Scenario: Editing a step updates only that step
- **WHEN** a user opens a step's editor via its pencil icon and changes its duration, target pace/power, or recovery, then confirms
- **THEN** only that step's values change; other steps and the step's position are unaffected

#### Scenario: Adding a step appends to the end
- **WHEN** a user taps "+ step"
- **THEN** a new step row is appended after the last existing step, ready for editing

### Requirement: Saving writes the session to the plan and to the Garmin calendar
The system SHALL, on "Salva sul calendario", write the session into the local plan state and perform a real write to the Garmin calendar (create for a new session, delete-then-recreate for an edited session) via the existing async write-job mechanism, then return to the screen the editor was opened from with the update reflected.

#### Scenario: Saving a new session creates it on Garmin
- **WHEN** a user completes create mode and taps "Salva sul calendario"
- **THEN** the session is added to the local plan, a Garmin write job is started to create and schedule it, and the screen waits for that job to finish before navigating back to screen 09 with the new session visible

#### Scenario: Saving an edited session replaces it on Garmin
- **WHEN** a user completes edit mode and taps "Salva sul calendario"
- **THEN** the session's local plan entry is updated, a Garmin write job is started to delete the previously scheduled workout and recreate it with the new content, and the screen waits for that job to finish before navigating back to screen 10 with the update reflected

#### Scenario: A failed Garmin write is surfaced, not silently swallowed
- **WHEN** the write job started by "Salva sul calendario" fails
- **THEN** the screen reports the failure to the user instead of navigating away as if it succeeded

### Requirement: Closing or cancelling discards edits
The system SHALL, on the header "×" or the "Annulla" action, discard any in-progress edits and return to the screen the editor was opened from with no plan or calendar changes.

#### Scenario: Closing without saving makes no changes
- **WHEN** a user taps "×" or "Annulla" after making changes in screen 10b
- **THEN** neither the local plan nor the Garmin calendar reflects those changes, and the app returns to the originating screen (09 or 10)

### Requirement: Deleting a session is available only in edit mode and requires confirmation
The system SHALL show a header trash icon only in edit mode, which, after an explicit confirmation step, deletes the session from the local plan and from the Garmin calendar, then returns to screen 09 Settimana.

#### Scenario: The delete icon is absent in create mode
- **WHEN** screen 10b is opened in create mode
- **THEN** no delete/trash icon is shown in the header

#### Scenario: Confirmed deletion removes the session from both plan and calendar
- **WHEN** a user taps the trash icon in edit mode and confirms the deletion
- **THEN** the session is removed from the local plan, the corresponding Garmin calendar entry is deleted, and the app navigates to screen 09 Settimana reflecting the removal

#### Scenario: An unconfirmed delete tap makes no change
- **WHEN** a user taps the trash icon but does not confirm
- **THEN** the session remains unchanged in both the local plan and on the Garmin calendar
