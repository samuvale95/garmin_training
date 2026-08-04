## ADDED Requirements

### Requirement: Back/home control provides tap feedback matching the app's motion pattern
The `PageHeader` back/home navigation control SHALL provide press feedback on tap (a brief scale-down while pressed, returning to rest on release), using the same easing curve and duration scale already applied to other interactive controls in the app (`PrimaryButton`'s press mechanics: `EASE = [0.22, 1, 0.36, 1]`-derived transition, `DURATIONS.tap`/`DURATIONS.release` from `lib/motion.ts`).

#### Scenario: Pressing the back control shows tap feedback
- **WHEN** a user presses down on the `PageHeader` back or home control
- **THEN** the control scales down briefly, matching the visual weight and timing of `PrimaryButton`'s press feedback

#### Scenario: Releasing or leaving the control returns it to rest
- **WHEN** a user releases the pointer on the control, or drags the pointer away before releasing
- **THEN** the control returns to its resting (unscaled) state

#### Scenario: Reduced motion suppresses the tap animation
- **WHEN** the user has "Meno movimento" enabled or the system `prefers-reduced-motion` is set
- **THEN** the back/home control shows no press-scale animation, while remaining fully tappable and navigating as before

#### Scenario: Navigation behavior is unchanged
- **WHEN** a user completes a tap on the back or home control
- **THEN** navigation proceeds exactly as it does today (to `backHref` when provided, otherwise to `/today`), with no change to routing behavior
