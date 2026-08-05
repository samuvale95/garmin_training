## ADDED Requirements

### Requirement: Strava is connected via a real OAuth authorization-code flow
The system SHALL implement a real Strava OAuth connect flow: an endpoint that returns Strava's authorization URL, and a callback/exchange endpoint that trades the returned code for an access/refresh token pair, storing the tokens server-side only (a local tokenstore file, never returned to the client), requesting read-only scopes sufficient for activity and gear data.

#### Scenario: Successful authorization stores tokens server-side
- **WHEN** the OAuth callback receives a valid authorization code
- **THEN** the backend exchanges it for an access/refresh token pair, persists them in the server-side Strava tokenstore, and the connect response contains no token material

#### Scenario: A denied or failed authorization leaves the app disconnected
- **WHEN** the user declines authorization or the code exchange fails
- **THEN** the Strava status endpoint continues reporting `connected: false`, and no partial token state is persisted

### Requirement: Strava connection status is readable without side effects
The system SHALL expose a status endpoint reporting whether Strava is currently connected (a valid or refreshable token exists), without making a data-fetching call to Strava's API.

#### Scenario: Status reflects a valid cached token
- **WHEN** the status endpoint is called and a non-expired (or refreshable) token exists in the tokenstore
- **THEN** the response reports `connected: true`

#### Scenario: Status reflects no connection
- **WHEN** the status endpoint is called and no token exists, or the refresh token is invalid
- **THEN** the response reports `connected: false`

### Requirement: Disconnecting Strava removes the locally stored token
The system SHALL expose a disconnect endpoint that deletes the server-side Strava tokenstore, without calling Strava to revoke the token remotely being a requirement (best-effort revocation is acceptable, but local token removal is mandatory).

#### Scenario: Disconnect clears local token state
- **WHEN** the disconnect endpoint is called while a token is stored
- **THEN** the tokenstore no longer contains a usable token, and a subsequent status call reports `connected: false`

### Requirement: An access token nearing or past expiry is refreshed transparently
The system SHALL refresh an expired Strava access token using the stored refresh token before making any Strava API call on behalf of a request, without requiring the user to re-authorize.

#### Scenario: An expired token is refreshed before use
- **WHEN** a Strava data endpoint is called and the stored access token has expired
- **THEN** the backend refreshes it via Strava's token endpoint, persists the new token pair, and proceeds with the original request using the refreshed token

#### Scenario: A refresh failure is reported as disconnected, not a generic error
- **WHEN** a token refresh attempt fails (e.g. the refresh token was itself revoked)
- **THEN** the backend clears the invalid local token state and the calling endpoint reports the Strava-auth-required condition rather than an unrelated server error

### Requirement: The best-matching Strava activity for a planned session is retrievable by date and sport
The system SHALL expose an endpoint that, given a session's date and sport, returns the best-matching Strava activity for that day (matched by date and, when multiple activities exist on that date, by closeness of duration to the planned session), or indicates no match exists.

#### Scenario: Exactly one activity exists on the session's date
- **WHEN** the lookup endpoint is called with a date that has exactly one Strava activity of a compatible sport
- **THEN** that activity's details (distance, average pace, heart rate, elevation gain, felt-effort/description text, associated gear) are returned

#### Scenario: Multiple activities exist on the session's date
- **WHEN** more than one Strava activity exists on the given date
- **THEN** the one whose duration is closest to the planned session's duration is returned as the single match

#### Scenario: No activity exists on the session's date
- **WHEN** no Strava activity exists for the given date
- **THEN** the endpoint reports no match, and no error is raised

### Requirement: Shoe wear is derived from Strava's own per-gear distance totals
The system SHALL expose an endpoint listing the authenticated athlete's shoes (Strava gear of type "shoe"), each with Strava's own reported cumulative distance, a computed percentage of a fixed 700 km wear threshold, and an estimated time-to-exhaustion derived from the athlete's recent weekly distance on that shoe.

#### Scenario: A shoe under the wear threshold is listed with its current usage
- **WHEN** the shoe list endpoint is called
- **THEN** each non-retired shoe is returned with its Strava-reported distance, percentage of 700 km, and an estimate of remaining time at the recent pace of use

#### Scenario: A shoe over the wear threshold is flagged
- **WHEN** a shoe's Strava-reported distance exceeds the 700 km threshold
- **THEN** it is still listed (the system does not hide over-threshold shoes), distinguishable from under-threshold shoes by its reported percentage exceeding 100

### Requirement: A shoe can be marked retired, excluding it from future wear calculations
The system SHALL support marking a shoe as retired, a local (app-side) flag layered on top of Strava's read-only gear data, which excludes it from active wear-threshold calculations while keeping it visible in the shoe list as archived.

#### Scenario: Marking a shoe retired excludes it from active accounting
- **WHEN** a shoe is marked retired
- **THEN** subsequent shoe-list responses include it with an archived indicator, and it is excluded from any "which shoe is nearing exhaustion" computation

#### Scenario: Retirement is local state, not a Strava write
- **WHEN** a shoe is marked retired
- **THEN** no write request is made to Strava's API — the retirement flag is stored and read entirely by this backend
