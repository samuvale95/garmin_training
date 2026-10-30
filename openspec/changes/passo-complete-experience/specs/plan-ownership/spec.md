## MODIFIED Requirements

### Requirement: The YAML file is import and export
The system SHALL parse imported YAML into an isolated draft and export the current plan, including sessions added or edited in the app, as YAML the importer accepts. Import SHALL default to a new program; merge or replacement requires an explicit owned target and review before activation. Replacement SHALL preserve locked, completed and out-of-scope sessions and historical identity and SHALL apply the reviewed changes atomically.

#### Scenario: Round trip
- **WHEN** the user exports a plan and activates the imported file into an empty account
- **THEN** the imported sessions have the same dates, sports, titles, descriptions and steps as the exported ones

#### Scenario: Importing replaces the reviewed scope
- **WHEN** the user explicitly reviews and activates a replacement import over an existing program
- **THEN** eligible sessions in the reviewed scope are replaced with imported sessions while protected and historical records remain unchanged

#### Scenario: Parsing is not activation
- **WHEN** a YAML file is successfully parsed
- **THEN** the active program and calendar remain unchanged until explicit activation
