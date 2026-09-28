## Why

Two gaps the user found using the app. The food targets only see the planned run and its minutes: a bike ride or a gym session recorded on Strava or Garmin the same day is ignored, and Garmin's measured calories are never read. And the week screen shows only the plan: anything done outside it -- a ride, a swim, tennis -- is invisible, so the calendar does not describe the week that actually happened.

A check of the real account shows the data is there: 370 Garmin activities across 17 sports, 535 Strava ones (371 copies of Garmin activities, 164 recorded on another device before July 2025), Garmin calories per activity (a 122' run: 1,632 kcal) and per day (4,306 kcal total, 2,202 at rest, on the same day). It also found one duplicate missed by the matcher: the same swim recorded by two devices 2'45" apart with durations 20% different.

## What Changes

- **Calories stored with each activity**: Garmin's measured calories, Strava's when it has them (rides with power), and otherwise an estimate from sport, duration and weight -- each with its source.
- **Duplicate matching by overlap**: two recordings of the same workout from different devices match when they are the same sport family, start within five minutes, and overlap for at least 80% of the shorter one.
- **Every activity in the calendar**: the week screen shows, in each day, the activities done outside the plan as "fuori piano" cards (sport, duration, distance, kcal), next to the planned sessions; for accounts without a plan, all activities.
- **The day's energy at 360°**: all activities of the day with their kcal and source, Garmin's day total (rest + active) when available -- trusted when present, as decided -- our own estimate (rest + activities + steps) otherwise and for comparison, and the food logged. Shown on the fuel screen; at level 1 in words only, no kcal.
- **Targets from the whole day's load**: the day's fuelling load counts every endurance activity of the day, not only the planned run.
- API: `GET /activities?start&end` (stored, deduplicated, all sports), `GET /energy/day?date=`.

## Capabilities

### New Capabilities
- `activity-overview`: all activities in the calendar, the activities API.
- `day-energy`: the day's energy, sources, estimate and the fuel-screen card.

### Modified Capabilities
- `activity-history`: calories per activity; duplicate matching by overlap.

## Impact

- **Code**: `history.py` (columns, matcher, reads), `garmin_sync.py` and `backfill.py` (calories), new `training_plan/energy.py`, `routes_nutrition.py` (whole-day load), new routes; web week screen, fuel screen.
- **Database**: `activity.calories`, `activity.calories_source`. Recent rows get calories on the next incremental sync (Garmin re-lists the last days); older rows on the next full pass.
