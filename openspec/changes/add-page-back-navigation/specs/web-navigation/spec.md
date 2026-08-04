## ADDED Requirements

### Requirement: Every screen offers a way back or home
Every page rendered under `web/src/app` SHALL expose a visible, reachable control that either returns the user to the logical previous step in the current flow or navigates to the home tab (`/today`). No screen SHALL be a dead end reachable only by the browser's native back button.

#### Scenario: Screen with a known previous step
- **WHEN** a user is on a page that is part of a linear flow with a well-defined predecessor (e.g. `diff` after `import`, `confirm-deletions` after `diff`, `session/[id]` after a plan view)
- **THEN** the page renders a back control that navigates to that predecessor step

#### Scenario: Screen with no well-defined previous step
- **WHEN** a user lands on a page that can be reached via a deep link, redirect, or as a terminal step (e.g. `rate-limit`, `sync/result`, `settings`)
- **THEN** the page renders a control that navigates to the home tab (`/today`)

#### Scenario: Tab-bar screens are unaffected
- **WHEN** a user is on `today`, `week`, or `body` (the routes rendered inside the `(tabs)` route group)
- **THEN** navigation continues to be provided by the existing `TabBar` and no additional back/home control is required

### Requirement: Consistent navigation affordance component
The web app SHALL provide a single shared component that renders the back-or-home control, used by every non-tab route, so the choice of target (back vs. home) is made explicitly per page rather than re-implemented ad hoc.

#### Scenario: Component reused across pages
- **WHEN** any of `settings`, `diff`, `connect-garmin`, `confirm-deletions`, `sync`, `sync/result`, `import`, `rate-limit`, `session/[id]`, `body/conflict`, `body/load` is rendered
- **THEN** it uses the shared navigation component rather than a page-local, one-off back button implementation

#### Scenario: Existing ad-hoc back button is replaced
- **WHEN** `session/[id]` renders its "session not found" state
- **THEN** the previously hand-rolled "Indietro" button is replaced by the shared navigation component
