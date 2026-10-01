## ADDED Requirements

### Requirement: Continuous Fitness and Fatigue Computation
The system SHALL compute daily values for Chronic Training Load (CTL, Fitness), Acute Training Load (ATL, Fatigue), and Training Stress Balance (TSB, Form) using exponential decay models across historical activities and planned sessions.

#### Scenario: Exponential update calculation
- **WHEN** a daily training load value is processed
- **THEN** the system SHALL update CTL using a 42-day time constant, ATL using a 7-day time constant, and compute TSB as `CTL - ATL`

#### Scenario: Stable seed initialization
- **WHEN** historical activity data begins with non-zero training load
- **THEN** the system SHALL initialize initial baseline levels from early available training loads rather than starting abruptly at zero

### Requirement: Form State Categorization and Interpretation
The system SHALL classify the current Training Stress Balance (TSB) into actionable physiological categories with clear coaching advice.

#### Scenario: Optimal training build zone
- **WHEN** TSB is between -25 and -10 inclusive
- **THEN** the system SHALL classify form status as `ottimale` with guidance indicating productive fitness building

#### Scenario: Overreaching fatigue warning
- **WHEN** TSB drops below -25
- **THEN** the system SHALL classify form status as `molto_affaticato` with guidance recommending load reduction to avoid injury

#### Scenario: Race freshness and peak zone
- **WHEN** TSB is between +5 and +20 inclusive
- **THEN** the system SHALL classify form status as `freschezza` indicating prime condition for race performance

### Requirement: Race Tapering Projection
The system SHALL simulate future CTL, ATL, and TSB values through planned workouts up to a target race date.

#### Scenario: Successful taper projection
- **WHEN** an athlete has a planned goal race and future scheduled workouts
- **THEN** the system SHALL project daily CTL, ATL, and TSB to race day and evaluate whether projected race-day TSB lands in the recommended freshness range (+5 to +20)
