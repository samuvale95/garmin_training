## ADDED Requirements

### Requirement: Overnight Data Completeness Assessment
The system SHALL evaluate overnight biometric recording completeness based on total sleep duration, coverage gaps, and presence of valid HRV readings.

#### Scenario: Full night receives reliable status
- **WHEN** an athlete logs at least 300 minutes (5 hours) of sleep with continuous HRV data
- **THEN** the system SHALL mark the overnight data reliability as `affidabile`

#### Scenario: Short or interrupted night receives partial status
- **WHEN** an athlete logs less than 240 minutes (4 hours) of sleep or has missing HRV records
- **THEN** the system SHALL mark the overnight data reliability as `parziale`

### Requirement: Controlled Readiness Alarm Downgrading
The system SHALL not trigger severe or critical stop-training verdicts when overnight data reliability is `parziale`.

#### Scenario: Critical alarm prevented on partial data
- **WHEN** resting heart rate appears elevated on a night classified with `parziale` reliability
- **THEN** the system SHALL cap the alert severity to moderate and explicitly append a cautionary note that overnight data was incomplete
