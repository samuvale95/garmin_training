## ADDED Requirements

### Requirement: Stable primary destinations
The application SHALL expose Oggi, Piano, Attività, Recupero and Nutrizione with visible text and active state, as a mobile bottom navigation and desktop sidebar. Profile SHALL remain discoverable. Essential navigation MUST NOT depend on gestures.

#### Scenario: Navigate across workspace
- **WHEN** a user opens any primary destination
- **THEN** the same five links are available, the current destination is identified and inactive pages do not receive keyboard focus.

### Requirement: Discoverable program and goal entry points
Piano SHALL expose Calendario, Programmi and Obiettivi. Programmi SHALL expose existing import and generation capabilities with truthful mutation labels and retain current program management.

#### Scenario: Find plan creation
- **WHEN** a user opens Piano then Programmi
- **THEN** file import and AI generation are visible without searching in the calendar or settings.

### Requirement: Stored activity browsing
Attività SHALL show stored activity history with period, sport and title filtering, loading/error/empty states and access to existing analysis and summaries.

#### Scenario: Empty filtered history
- **WHEN** no activities match the chosen filters
- **THEN** the page explains the empty result without showing invented metrics and permits changing filters.

### Requirement: Daily hierarchy and calendar focus
Oggi SHALL prioritize today's training and expose all today's sessions. Piano SHALL show the calendar before program-management or generation controls.

#### Scenario: Two sessions today
- **WHEN** two sessions are scheduled today
- **THEN** both are discoverable with separate detail links.

### Requirement: Contextual return
Session links SHALL carry a validated local return context. Calendar navigation SHALL preserve its selected week. Direct links MUST have a safe fallback.

#### Scenario: Return to a selected week
- **WHEN** the user opens a session from a non-current week and returns
- **THEN** the same week is displayed.

#### Scenario: Invalid return destination
- **WHEN** a detail URL contains an external or malformed return destination
- **THEN** back navigation uses the local fallback and never navigates externally.

### Requirement: Explicit session move
The calendar SHALL offer a labeled move action with date selection, reusing existing conflict handling and write guards.

#### Scenario: Move without dragging
- **WHEN** a user selects Sposta and a new date
- **THEN** the existing validation and confirmation flow handles the move without requiring a drag gesture.
