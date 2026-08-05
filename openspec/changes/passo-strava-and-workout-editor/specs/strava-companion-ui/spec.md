## ADDED Requirements

### Requirement: Screen 16 lets a user authorize or decline Strava, reached from Settings
The system SHALL implement screen "16 Collega Strava", opened from screen 15 Impostazioni's Strava row "collega" button, explaining the read-only nature of the connection, with an "Autorizza Strava" action that performs the real OAuth flow and returns to Settings with the Strava row updated to "collegato" on success, and a "Non ora" action that returns to Settings unchanged.

#### Scenario: Authorizing Strava updates Settings on return
- **WHEN** a user completes "Autorizza Strava" successfully
- **THEN** the app returns to screen 15, and the Strava row shows a connected state

#### Scenario: Declining leaves Strava unconnected
- **WHEN** a user taps "Non ora"
- **THEN** the app returns to screen 15 without initiating any OAuth flow, and the Strava row remains in its prior (unconnected) state

### Requirement: Settings surfaces Strava connection status and a shoes entry point
The system SHALL add two rows to screen 15 Impostazioni: a "Strava" row showing current connection status (opening screen 16 when not connected, or a disconnect action when connected), and a "Scarpe" row that opens screen 18 Usura scarpe.

#### Scenario: The Strava row reflects live connection state
- **WHEN** screen 15 is opened
- **THEN** the Strava row's displayed status matches the backend's current Strava connection status, not a cached or assumed value

#### Scenario: The Scarpe row opens the shoe wear screen
- **WHEN** a user taps the "Scarpe" row on screen 15
- **THEN** screen 18 Usura scarpe opens, with its return arrow bringing the user back to screen 15

### Requirement: Session detail surfaces a Strava comparison card when a match exists
The system SHALL add a "Svolta ieri, da Strava" card to screen 10 Sessione, shown only when Strava is connected and the session has a matching completed Strava activity, which opens screen 17 Svolto vs pianificato when tapped.

#### Scenario: The card is hidden when Strava is not connected
- **WHEN** Strava is not connected
- **THEN** screen 10 does not show the "Svolta ieri, da Strava" card, regardless of whether an activity would otherwise match

#### Scenario: The card is hidden when no matching activity exists
- **WHEN** Strava is connected but no Strava activity matches this session's date/sport
- **THEN** screen 10 does not show the card

#### Scenario: The card is shown and navigates to the comparison screen
- **WHEN** Strava is connected and a matching activity exists for this session
- **THEN** screen 10 shows the card, and tapping it opens screen 17 for this session

### Requirement: Screen 17 compares planned and actual, and links to shoe wear
The system SHALL implement screen "17 Svolto vs pianificato": planned-vs-actual distance and pace, heart rate, elevation gain, a felt-effort note imported from Strava, a "what changes in the plan" callout, and a shoe-used row that opens screen 18; a "Torna alla sessione" action returns to screen 10.

#### Scenario: All comparison fields render from the matched activity
- **WHEN** screen 17 is opened for a session with a matched Strava activity
- **THEN** planned/actual distance and pace, heart rate, elevation gain, and the felt-effort note are all populated from that activity's data

#### Scenario: The shoe row opens shoe wear
- **WHEN** a user taps the "Scarpe" row on screen 17
- **THEN** screen 18 Usura scarpe opens

#### Scenario: Returning goes back to the session
- **WHEN** a user taps "Torna alla sessione"
- **THEN** the app returns to screen 10 Sessione for the same session

### Requirement: Screen 18 lists shoes with wear bars and lets a shoe be retired
The system SHALL implement screen "18 Usura scarpe", reached from screen 17's shoe row or screen 15's "Scarpe" row: a list of shoes with a consumption bar against the 700 km threshold and an exhaustion estimate, and a "Segna [scarpa] come ritirata" action per shoe that excludes it from future wear calculations while keeping it listed as archived; the back arrow returns to whichever screen opened it.

#### Scenario: Wear bars reflect current distance against the threshold
- **WHEN** screen 18 is opened
- **THEN** each active shoe's bar length and percentage reflect its current distance relative to 700 km

#### Scenario: Retiring a shoe archives it without deleting it
- **WHEN** a user taps "Segna [scarpa] come ritirata" for a shoe
- **THEN** that shoe is excluded from active wear/exhaustion calculations going forward, and remains visible in the list marked as archived

#### Scenario: Back navigation returns to the correct origin
- **WHEN** a user taps the back arrow on screen 18
- **THEN** the app returns to screen 17 if that is where it was opened from, or screen 15 if opened from Settings

### Requirement: Week screen offers a create-workout entry point
The system SHALL add a "+" icon to screen 09 Settimana that opens screen 10b in create mode.

#### Scenario: Tapping "+" opens the empty editor
- **WHEN** a user taps the "+" icon on screen 09
- **THEN** screen 10b opens in create mode, as specified by the workout-editor capability

### Requirement: Session detail offers an edit entry point
The system SHALL add a pencil icon to screen 10 Sessione's header that opens screen 10b in edit mode for the displayed session.

#### Scenario: Tapping the pencil opens the precomposed editor
- **WHEN** a user taps the header pencil icon on screen 10
- **THEN** screen 10b opens in edit mode, precomposed with that session's data, as specified by the workout-editor capability
