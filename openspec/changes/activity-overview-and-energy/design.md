## Context

The history stores canonical activities from Garmin and Strava (`duplicate_of`), without calories. Garmin's activity list carries `calories`; its day summary (`get_stats`) carries total, active and resting kilocalories and steps. Strava's list has `kilojoules` for rides with power and no calories otherwise (only the per-activity detail has them, one call each). History syncs on app open, re-listing the last days incrementally.

## Decisions

1. **Calories on the row, estimate at read time.** The measured figures are stored; the estimate (MET × weight × hours by sport family) is computed when read, so a better weight or table fixes the past too. No extra Strava calls.
2. **Garmin day total trusted when present** (user's choice), read live and cached (10 minutes for today, a day for the past), not stored: the incremental sync does not refresh wellness.
3. **Overlap rule for duplicates.** Durations differ between devices (moving time, pool pauses), starts drift by minutes; heavy overlap in time is what "the same workout" means. The Garmin-upload rule is unchanged.
4. **"Fuori piano" by sport family**: an activity is the planned session when a planned session of the same family is on the same day; a second activity of the same family the same day is also fuori piano only if the plan had one.
5. **Level 1 words only** (user's choice): the card maps the balance to sentences.
6. **Refuel threshold 70%, after 18:00 or for a past day**: earlier in the day the food is simply not eaten yet.

## Risks / Trade-offs

- [Garmin calories for strength or tennis are rough] → shown with their source; the load uses minutes, not calories.
- [Estimates for Strava-only activities] → labelled `stima`.
