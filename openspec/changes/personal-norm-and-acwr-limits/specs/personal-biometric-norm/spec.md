## ADDED Requirements

### Requirement: Personal biometric baseline calculation
The system SHALL compute rolling personal biometric baseline norms for resting heart rate (RHR) and overnight HRV (rMSSD) over a 28 to 60-day historical window. Each baseline norm SHALL include the sample mean, standard deviation, and normal range bounds (mean ± 1.5 standard deviations). When fewer than 14 nights of data are available, the system SHALL report insufficient baseline history and fallback to standard conservative delta thresholds.

#### Scenario: Sufficient history produces statistical baseline norm
- **WHEN** the athlete has 30 recorded nights of RHR and HRV in the past 60 days
- **THEN** the system computes the personal mean, standard deviation, and normal range bounds for both RHR and HRV, setting `has_personal_norm` to true

#### Scenario: Insufficient history falls back to 7-day delta
- **WHEN** the athlete has only 6 nights of recorded data
- **THEN** the system sets `has_personal_norm` to false and uses the 7-day average delta fallback

### Requirement: Readiness verdicts evaluated against personal norms
The system SHALL evaluate daily resting heart rate and overnight HRV against the athlete's personal norm. An overnight HRV value below `mean - 1.5 * SD` SHALL trigger a moderate recovery warning (`cauto`). An HRV value below `mean - 2.0 * SD` SHALL trigger a severe recovery warning (`scarico`). An RHR value above `mean + 1.5 * SD` SHALL trigger a moderate elevated heart rate signal, and an RHR value above `mean + 2.0 * SD` SHALL trigger a severe elevated heart rate signal.

#### Scenario: HRV drop within personal variance
- **WHEN** the athlete's nightly HRV is 8% below the 7-day mean, but still within `mean - 1.5 * SD` of their personal 60-day norm
- **THEN** the system classifies HRV as normal without raising a false fatigue warning

#### Scenario: HRV drop exceeds personal normal range
- **WHEN** the athlete's nightly HRV drops below `mean - 1.5 * SD`
- **THEN** the system raises a `cauto` readiness signal indicating HRV is significantly below personal baseline

#### Scenario: RHR elevated above personal norm
- **WHEN** the athlete's resting heart rate rises above `mean + 2.0 * SD` of their personal baseline
- **THEN** the system raises a `scarico` signal recommending rest or active recovery
