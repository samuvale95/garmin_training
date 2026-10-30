## ADDED Requirements

### Requirement: Complete training detail and editor journey
The UI SHALL show sport-appropriate units, source, local status and distinct Garmin status, visible supported edit/move/short-version actions, validated contextual return and unsaved-change protection. Move SHALL check conflicts before committing. Short-version review SHALL explain duration and phase changes and offer restoration when supported. Save SHALL not automatically mean publication.

#### Scenario: Move conflicts with availability
- **WHEN** a user chooses a conflicting destination day
- **THEN** conflict information appears before commitment and the original session remains unchanged until a permitted choice

#### Scenario: Save a workout
- **WHEN** a workout is saved locally
- **THEN** pending Garmin changes remain discoverable and no success text claims an unverified device update

### Requirement: Truthful publication outcomes
The publication flow SHALL retain scope preview and confirmations for replacements/deletions, distinguish saved/running/sent/failed/partial/unknown states and reconcile uncertain external outcomes before retry. Data acquisition SHALL remain a separate action from publication. No unsupported external undo SHALL be promised.

#### Scenario: Publication job disappears
- **WHEN** a previously running in-memory job cannot be recovered
- **THEN** the UI reports uncertainty and offers refresh/reconciliation instead of claiming success or blindly repeating writes

### Requirement: Coherent activity and recovery destinations
Activities SHALL provide history, trends and reports using existing canonical identities, including off-plan activity, without duplicating Garmin/Strava records. Comparisons SHALL use homogeneous units and distinguish measurements from estimates. Recovery SHALL expose today and trends with source, date, missing/stale states and explanations for advanced metrics.

#### Scenario: Recovery data is absent
- **WHEN** no current biometric data exists
- **THEN** the page explains what is missing and retains usable content and connection access without substituting zero

### Requirement: One nutrition day and meal flow
Nutrition SHALL distinguish the daily plan from recorded meals, preserve selected date across its views and use one photo/text/manual estimate-review-save flow from every entry point. Suggested meals SHALL not count as consumed. Meal review SHALL allow quantity correction and return to the originating day. A planned workout time SHALL not imply a workout is in progress.

#### Scenario: Meal registered from a past day
- **WHEN** the user opens meal registration from a selected past nutrition date
- **THEN** review and save use that date and return to the same day without a duplicate record

### Requirement: Configuration and first-use continuity
Profile SHALL group account, connections, athlete parameters, equipment and preferences, show only observed connection state/freshness and provide recoverable actions. First-use routes SHALL offer existing calendar, import or program creation according to supported capabilities and SHALL not require optional Strava access. Existing accounts SHALL retain useful context.

#### Scenario: Strava is unavailable
- **WHEN** a user has no Strava connection
- **THEN** supported calendar, program and recovery journeys remain reachable

### Requirement: Accessible and verifiable rollout
New pages SHALL follow existing screen-ready, disabled-action, error, skeleton and tracking conventions; preserve legacy deep links; support keyboard, visible focus, reduced motion and contextual returns. Verification SHALL include 360/390/430/768/1440 widths, enlarged text, populated/empty/error states and isolated mutation tests. Rollout SHALL have a reversible entry-point switch without deleting data. Actual usability measurements SHALL not be fabricated from automated screenshots.

#### Scenario: Rollout switch is disabled
- **WHEN** the new program experience is disabled
- **THEN** existing data and drafts remain intact and legacy destinations still resolve
