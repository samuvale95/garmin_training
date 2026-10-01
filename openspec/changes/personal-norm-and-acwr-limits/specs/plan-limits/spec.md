## ADDED Requirements

### Requirement: Acute to chronic workload ratio enforcement
The system SHALL compute the Acute:Chronic Workload Ratio (ACWR) for planned windows and session reschedules. The acute load SHALL be computed over the preceding 7 days, and the chronic load SHALL be computed over the preceding 28 days. When a planned week or a session reschedule causes the projected ACWR to exceed 1.35, the system SHALL flag an acute overload warning (`acwr_high`). When projected ACWR exceeds 1.50, the system SHALL flag a high injury risk warning (`acwr_excessive`).

#### Scenario: Normal progressive workload within safe ACWR
- **WHEN** moving a session increases weekly volume such that ACWR remains between 0.80 and 1.30
- **THEN** no ACWR warning is generated, and the move is considered safe

#### Scenario: Session move causes acute spike above 1.35
- **WHEN** rescheduling a long run or adding a session causes the projected 7-day acute workload ratio to reach 1.42 relative to the 28-day chronic baseline
- **THEN** the system generates an `acwr_high` warning in move decision checks, explaining the increase in injury risk

#### Scenario: Sudden excessive spike above 1.50
- **WHEN** rescheduling workouts aggregates multiple hard sessions into a 7-day period with ACWR >= 1.50
- **THEN** the system flags an `acwr_excessive` critical alert recommending workout adaptation or day rescheduling
