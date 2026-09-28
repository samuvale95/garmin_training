## ADDED Requirements

### Requirement: The summary includes food
The weekly summary SHALL report the days with at least one food entry, and the days whose logged carbohydrate stayed under the day's target lower bound the day before a planned hard or long session.

#### Scenario: Under before the long run
- **WHEN** Saturday's logged carbohydrate is under range and Sunday has a planned long run
- **THEN** the summary lists Saturday among the days under before a hard session
