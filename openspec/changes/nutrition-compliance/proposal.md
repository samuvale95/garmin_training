## Why

Food is the last piece of phase 2 (`BRAINSTORM-miglioramenti-e-gamification.md` §0.4): no meal plan; the code computes the day's targets from the training load, the user logs what they ate (photo or text) and the app says whether they are in and what is missing. Most of it exists (`nutrition.py` targets, photo and text logging, diary), but the targets still come from sessions the client sends rather than the plan the server now owns, they ignore what was actually run, nothing says "in" or "missing", and the fuel screen still shows a meal plan the user decided against ("meglio che mi dica solo i valori nutrizionali").

## What Changes

- **Targets from the stored plan and the real load**: `/nutrition/targets` reads the server's plan when the client sends no sessions; today's load uses the history when the user trained more than planned (or trained on a rest day).
- **Compliance**: for each macro, `sotto` (with the grams missing), `dentro` or `sopra`, with one sentence; carbohydrate below range before a hard or long day is the one flagged; being above is never an error. While the day is in progress the wording is "finora".
- `GET /nutrition/status?date=`: targets, totals and compliance in one answer.
- **Fuel screen**: the compliance lines under the rings; the meal-plan block is removed, the during-session and recovery values stay; the energy block is hidden at level 1 (no calorie counting while building the habit).
- **Weekly summary**: days with food logged, and the times carbohydrate stayed under range the day before a hard session.

## Capabilities

### New Capabilities
- `nutrition-compliance`: server-plan targets, real load, compliance, status API, fuel screen changes.

### Modified Capabilities
- `weekly-summary`: adds the week's food line.

## Impact

- **Code**: `nutrition.py` (compliance, real-load session), `routes_nutrition.py` (stored plan, status), `weekly_summary.py`; web fuel screen and `FuelBlocks`, summary page.
- **Database**: none.
