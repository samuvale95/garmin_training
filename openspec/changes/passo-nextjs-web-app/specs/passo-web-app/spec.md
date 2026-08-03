## ADDED Requirements

### Requirement: Entry screen replaces account login with a single "Inizia" action
The system SHALL present a minimal welcome screen in place of the design's "01 Accesso" (Google sign-in) screen, containing brand mark, wordmark, the original narrative titles/copy, the illustration, and exactly one primary action button labeled "Inizia" that proceeds into the app. No account creation, no OAuth flow, and no user identity of any kind SHALL exist anywhere in the application.

#### Scenario: Inizia proceeds without any authentication
- **WHEN** a first-time visitor taps "Inizia"
- **THEN** the app proceeds directly into the onboarding flow (Garmin connect, offered/skippable, then plan import) with no account created and no credential requested for entry itself

#### Scenario: No returning-user identity is recognized
- **WHEN** the same device is used by a different person, or `localStorage` is cleared
- **THEN** the app behaves identically to a first-time visitor — there is no concept of "signed in as" anywhere in the UI

### Requirement: Garmin connection screen is preserved from the design, reached after entry
The system SHALL implement screen "02 Collega Garmin" as designed — two fields (email, password) styled as underline inputs, the three-attempts/six-digit-code advance warning, and a "Collega"/"Lo faccio dopo" choice — as the sole mechanism for linking a real Garmin Connect account, reachable after "Inizia" and skippable, and re-enterable later from Settings or when a Garmin-writing action is attempted without a connection.

#### Scenario: Skipping Garmin connection still allows plan import
- **WHEN** a user taps "Lo faccio dopo" on the Garmin connect screen
- **THEN** the app proceeds to plan import, and any later action requiring Garmin (diff, sync) prompts the Garmin connect screen at that point instead of failing silently

#### Scenario: Credentials are submitted but never stored on the device
- **WHEN** a user submits Garmin email/password on this screen
- **THEN** the values are sent to the backend connect endpoint and are not written to `localStorage`, `IndexedDB`, cookies, or any other client-side persistence, and are cleared from in-memory form state once the request completes

### Requirement: Plan import supports file upload and pasted text
The system SHALL implement screen "03 Importa il piano" with both import paths (file from device, pasted YAML text), show the last-imported plan's filename/session count when one exists, and offer a reimport action.

#### Scenario: A valid plan file is imported and held as the active plan
- **WHEN** a user selects a valid training-plan YAML file
- **THEN** the parsed plan (sessions, filename, import timestamp) becomes the active plan in the persisted client store, and the diff screen becomes reachable

#### Scenario: Validation errors are shown per-line, not as a single failure
- **WHEN** an imported plan fails validation
- **THEN** the screen lists each specific error (matching the backend's per-line validation errors) rather than a single generic failure message, and the plan is not accepted as active

### Requirement: Diff screen shows categorized changes with a partial-confirm action
The system SHALL implement screen "04 Differenze": count chips for new/changed/unchanged sessions, a scrollable list of cards color-coded by category, era/ora line pairs for changed sessions with the technical consequence line ("cambiata · cancello e ricreo"), and a primary action that writes only the new sessions — changed sessions require a separate, explicit confirmation step (screen 05) before any deletion.

#### Scenario: Primary action covers only new sessions
- **WHEN** a diff contains both new and changed sessions and the user taps the primary "Scrivi le N nuove" action
- **THEN** only the new sessions are queued for creation; changed sessions are not touched until separately confirmed

#### Scenario: Diff is recomputed on every visit, never read from a cached value
- **WHEN** the diff screen is opened
- **THEN** the frontend issues a fresh diff-preview request rather than reusing a previously stored diff, consistent with the diff being derived data

### Requirement: Deletion confirmation is a distinct, explicit, irreversible-consequence step
The system SHALL implement screen "05 Conferma cancellazione" exactly where changed sessions require delete-then-recreate: listing the sessions to be deleted with their creation date and "never executed" status, an explanatory card stating that already-completed activities are never touched, and two actions (destructive confirm / cancel) plus a "one at a time" fallback.

#### Scenario: Confirming proceeds to delete-and-recreate only the confirmed sessions
- **WHEN** a user confirms deletion on screen 05
- **THEN** exactly the listed changed sessions are deleted and recreated; unconfirmed changed sessions and all unchanged sessions are left untouched

#### Scenario: Already-executed activities are never included
- **WHEN** computing which sessions require deletion
- **THEN** any Garmin activity already marked as executed is excluded from the deletion set, regardless of whether its plan entry changed

### Requirement: Sync progress screen reflects a real, resumable background job
The system SHALL implement screen "06 Scrittura in corso": a live count ("N di M sessioni"), a real (non-decorative) progress bar, three running counts (done/rejected/queued), the last-three-sessions status list, and an "interrompi dopo questa" control — all driven by polling the async job-status endpoint, so the view reflects actual server-side progress and remains accurate if the user leaves and returns.

#### Scenario: Leaving and returning to the sync screen shows current progress, not a reset
- **WHEN** a user navigates away from the sync screen while a job is running and returns before it finishes
- **THEN** the screen resumes showing the job's current progress via a fresh status poll, not a restarted or blank progress view

#### Scenario: A single rejected session does not halt the queue
- **WHEN** one session fails during the sync job
- **THEN** the job continues to the next queued session, and the failure is reflected only in that session's status entry

### Requirement: Sync result screen reports outcome with per-failure reason and action
The system SHALL implement screen "07 Esito": the completed/total count, a list of failed sessions each showing its specific reason and a concrete suggested fix (not a generic error), aggregate metrics (duration, deleted count, created count), and a "retry only the failed ones" action.

#### Scenario: Retry targets only previously failed sessions
- **WHEN** a user taps "Riprova solo queste due" after a sync with partial failures
- **THEN** a new sync job is started containing only the previously failed sessions, not the entire original set

### Requirement: Today (home) screen surfaces the current focus and this-week strip
The system SHALL implement screen "08 Oggi": the week-number title, the hero card for today's key session, the three metrics (volume/readiness/sleep), a diff-status card (or the in-pari alternative from the empty-state table when there is nothing to write), and the rest-of-week strip, under the persistent tab bar (Oggi · Settimana · Corpo).

#### Scenario: Diff card reflects zero pending differences
- **WHEN** the plan and calendar have no differences
- **THEN** the diff card is replaced by the thin "in pari col calendario" row with a static green dot and no pulsing ring, per the design's defined empty state

### Requirement: Week screen renders each day with type-driven card treatment
The system SHALL implement screen "09 Settimana": date-range header with navigation arrows, weekly completion bar and totals, and one card per day whose background color and illustration are driven by session type (rest/interval/easy/strength/long), with non-uniform card heights reflecting importance rather than being normalized.

#### Scenario: Card color is derived from session type, not chosen per-instance
- **WHEN** rendering a day's card
- **THEN** its background color and illustration are determined solely by that day's session type, consistently across the week view

### Requirement: Session detail screen shows the plan-vs-calendar step breakdown
The system SHALL implement screen "10 Sessione": the distance ring (animated once to its value, not re-drawn on every render unless the value actually changes), the step list with the key step visually distinguished, and calendar-presence confirmation with a reschedule action.

#### Scenario: Ring re-animates only when its underlying value changes
- **WHEN** the session detail screen re-renders without the distance value changing (e.g. a parent re-render, a tab revisit)
- **THEN** the progress ring does not redraw its trace animation

### Requirement: Body/recovery screen ties physiological data to tomorrow's plan
The system SHALL implement screen "11 Come stai": the readiness ring and two-part verdict, sleep and HRV cards, the small metrics row, and a closing card that explicitly connects the numbers to the plan — every body data screen SHALL end with a sentence linking the number to the plan, per the design's copy rule.

#### Scenario: Missing overnight data renders the defined empty state
- **WHEN** no Garmin morning sync has occurred yet
- **THEN** the readiness card is replaced by the neutral sand-colored card with the defined copy, not an error or a blank space

### Requirement: Load/form screen shows a 4-5 week trend with a plain-language verdict
The system SHALL implement screen "12 Carico e forma": the weekly load histogram (fixed pixel heights per the data range, not percentage-based, per the known flex layout pitfall), the acute:chronic indicator with its recommended band, and VO₂max, with a serif sentence explaining the current position.

#### Scenario: Histogram bar heights are computed in pixels, not percentages
- **WHEN** rendering the weekly load histogram inside a `flex; align-items: flex-end` row
- **THEN** each bar's height is set as an explicit pixel value derived from the data range, not a percentage of an auto-height parent

### Requirement: Body-conflict screen presents exactly two concrete resolution options
The system SHALL implement screen "13 Il corpo dice no" — the most important screen per the design — showing the contradicting signals, the affected planned session, and exactly the two concrete options returned by `passo-body-insights-api`'s conflict endpoint, plus "lascia tutto com'è" as a lightweight third path, with the closing line confirming any choice is written back into the plan.

#### Scenario: Choosing an option performs a real, reversible plan change
- **WHEN** a user selects one of the two concrete options
- **THEN** the corresponding session edit (move date, or reduce reps/adjust pace) is applied to the active plan and reflected in the plan's own record (available for later YAML re-export), and the change can be undone by choosing differently before it is written to Garmin

#### Scenario: Leaving the plan unchanged is always available
- **WHEN** a user taps "Lascia tutto com'è"
- **THEN** no plan or calendar change occurs and the screen dismisses

### Requirement: Forced-wait screen disables retry until a real countdown elapses
The system SHALL implement screen "14 Attesa forzata": the live countdown sourced from the backend's actual `retry_after_seconds`, a progress bar, the IP-not-account explanation, reassurance that already-written sessions remain, and a primary action that stays inert (no "retry anyway") until the countdown reaches zero.

#### Scenario: Retry action is disabled for the entire countdown duration
- **WHEN** the forced-wait screen is showing a nonzero countdown
- **THEN** the primary retry action remains disabled and produces no effect if interacted with, until the countdown reaches zero

#### Scenario: Countdown reflects server state, not a client-guessed timer
- **WHEN** the forced-wait screen is opened
- **THEN** its countdown starts from the connection-status endpoint's `retry_after_seconds`, so a page refresh mid-cooldown shows the correct remaining time rather than restarting from the original duration

### Requirement: Settings screen exposes preferences that are genuinely on-device
The system SHALL implement screen "15 Impostazioni": the Garmin connection card (connect/disconnect, last-sync), the three preference toggles ("Avvisami se il corpo non regge", "Chiedi prima di cancellare" — default on, "Meno movimento"), the YAML download action, and an exit action — with no profile/account card (replacing the design's Google-account profile card, consistent with there being no login).

#### Scenario: Preference toggles persist across reloads
- **WHEN** a user changes any of the three preference toggles and reloads the app
- **THEN** the changed values are still in effect, read from the persisted client store

#### Scenario: Plan download always reflects the current in-browser plan state
- **WHEN** a user taps the YAML download action
- **THEN** the downloaded file reflects the plan as currently held in the client store, including any edits made via the body-conflict screen's options

### Requirement: Motion system enforces the documented global constraints
The system SHALL implement the motion system from `MOTION.md` as a shared mechanism (not per-screen reimplementation): a single easing curve for all directional motion, a maximum of three concurrently `infinite`-animating elements per screen (brand mark included), and entrance cascades that run once per screen mount rather than on every tab switch or back-navigation.

#### Scenario: A screen with more than three continuous animations is a spec violation
- **WHEN** any implemented screen is audited against the running elements with `infinite`/looping animation
- **THEN** the count (including the brand mark) does not exceed three

#### Scenario: Returning to a previously-visited tab does not replay its entrance cascade
- **WHEN** a user switches from the Oggi tab to Settimana and back to Oggi
- **THEN** the Oggi screen's entrance cascade does not replay; only its continuous/looping animations (if any) are running

### Requirement: The three still screens run zero entrance/looping animation
The system SHALL render screens 04 (Differenze), 05 (Conferma cancellazione), and 14 (Attesa forzata) with no entrance animation and no continuous/looping animation, the brand mark frozen on its canonical frame, and a visible still-state label — with the sole exception of the countdown tick on screen 14.

#### Scenario: No animated entrance when navigating into a still screen
- **WHEN** navigating from any screen into 04, 05, or 14
- **THEN** the transition is a pure cross-fade with no directional slide, and the destination screen appears fully composed with no cascading entrance

#### Scenario: Countdown ticking is the sole animation on screen 14
- **WHEN** screen 14 is displayed
- **THEN** the only animating element is the countdown's tick indicator; the brand mark and all other elements are static

### Requirement: Reduced motion (system preference and in-app toggle) converge on one behavior
The system SHALL treat `prefers-reduced-motion: reduce` and the in-app "Meno movimento" setting as equivalent triggers for the same reduced-motion behavior: entrances and inviting/breathing loops disabled, informational indicators retained (or replaced by equivalent text when a stricter system setting demands it), the attention pulse-ring replaced by a static bordered dot, navigation transitions flattened to a 160ms cross-fade, and touch feedback unaffected.

#### Scenario: Either trigger alone is sufficient to enable reduced motion
- **WHEN** either the system `prefers-reduced-motion` setting or the app's "Meno movimento" toggle is active (independently of the other)
- **THEN** the app renders in the reduced-motion state described above

#### Scenario: Touch feedback remains active under reduced motion
- **WHEN** reduced motion is active and a user presses a button or tappable card
- **THEN** the press-in/release feedback still occurs, since it is a direct response to user action, not decorative motion

### Requirement: Application state persists on-device with no server-side user data store
The system SHALL persist plan data, preferences, and write-job history in browser storage (`localStorage`/`IndexedDB`) so they survive a page reload, while never persisting Garmin session tokens or credentials client-side, and never requiring a server-side database of user/application state.

#### Scenario: Reloading the browser preserves the imported plan and preferences
- **WHEN** a user reloads the app after importing a plan and changing preferences
- **THEN** the same plan and preference values are present after reload, with no re-import or reconfiguration needed

#### Scenario: Clearing browser storage returns the app to first-run state
- **WHEN** a user clears the browser's site storage for the app
- **THEN** the app behaves as if freshly installed — no plan, default preferences — with no server-side record to recover from, consistent with there being no account
