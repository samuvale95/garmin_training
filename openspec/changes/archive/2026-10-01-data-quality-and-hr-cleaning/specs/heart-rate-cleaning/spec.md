## ADDED Requirements

### Requirement: Physiological Spike Filtering
The system SHALL detect and filter unphysiological heart rate spikes from activity heart rate time series. A spike is defined as a rate of change exceeding 5 bpm per second sustained for less than 10 seconds without a corresponding increase in running speed, or an absolute heart rate exceeding physiological limits (> 215 bpm).

#### Scenario: Isolated synthetic spike is interpolated
- **WHEN** a runner's heart rate stream shows 142, 143, 210, 212, 144, 145 bpm at 1-second intervals at constant pace
- **THEN** the system SHALL mark the 210 and 212 bpm samples as anomalies and replace them with linearly interpolated values (~143–144 bpm)

#### Scenario: Real sprint acceleration is preserved
- **WHEN** a runner accelerates sharply into an interval with speed increasing by more than 30% and heart rate rising steadily
- **THEN** the system SHALL preserve the rising heart rate samples and not mark them as spikes

### Requirement: Cadence Lock Detection
The system SHALL detect optical cadence lock when heart rate jumps sharply and matches step cadence within ±3 spm for 20 seconds or longer while running speed remains unchanged.

#### Scenario: Optical sensor locking to cadence is detected
- **WHEN** heart rate jumps from 138 bpm to 176 bpm in 3 seconds while cadence is 175 spm and pace is constant
- **THEN** the system SHALL classify the segment as cadence lock, exclude it from time-in-zone compliance, and count the cadence lock duration

### Requirement: Stream Quality Scoring
The system SHALL compute a quality classification (`alta`, `media`, `bassa`) for each activity heart rate stream based on the ratio of valid to anomalous samples.

#### Scenario: Clean activity receives high quality score
- **WHEN** an activity has over 95% valid, anomaly-free heart rate samples
- **THEN** the system SHALL return quality `alta` and include the count of repaired spikes

#### Scenario: Highly corrupted activity receives low quality score
- **WHEN** an activity has more than 20% anomalous or missing samples
- **THEN** the system SHALL return quality `bassa` and warn that zone metrics are approximate
