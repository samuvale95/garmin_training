## Why

The app reads the watch, not the person. It cannot tell a hard session that felt easy from one that hurt, and for a level 1 user without a threshold it has no intensity signal at all (`BRAINSTORM-miglioramenti-e-gamification.md` §0.3: "è stata facile?" is L1's metric). A 10-second check-in after training is the missing input for the day's verdict, for the move warnings' pain rule (§0.5) and for the weekly summary. It is also the first event the plan adaptation (phase 2) will react to.

## What Changes

- A daily check-in, two taps: how the session felt (`facile`, `giusta`, `dura`, `troppo`) and how the body is (`bene`, `stanco`, `dolore`), with a body area when it hurts. One per day, editable.
- A card on Oggi that asks for it when the user trained today (or trained yesterday and did not answer yet), and stays out of the way otherwise.
- The day's readiness verdict reads the check-in: reported pain is a strong signal, a session that felt too hard or a tired body a moderate one, each saying which answer produced it.
- API: `GET /checkins?start&end`, `PUT /checkins/{date}`, `DELETE /checkins/{date}`.

## Capabilities

### New Capabilities
- `daily-check-in`: the answers, storage, API and the Oggi card.

### Modified Capabilities
<!-- None: readiness has no archived spec; the new signals are specified here as ADDED. -->

## Impact

- **Code**: new `training_plan/checkin.py` (storage + signals), `api/routes_checkin.py`, `readiness.read_signals` gains optional check-in signals, `/body/readiness` passes them; web `CheckInCard` on Oggi, hooks in `queries.ts`.
- **Database**: new table `checkin`.
- **Next changes**: move warnings read pain; the weekly summary reads the week's check-ins.
