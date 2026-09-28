## Why

Consistency is the product's main metric (`BRAINSTORM-miglioramenti-e-gamification.md` §0.2), and nothing in the app looks back at a week: what was planned, what was done, how it felt, whether the habit is holding. The weekly summary is the channel for D2 ("is my training right?") and C ("does this help me keep going?"), and the place the gamification will later show its progress.

## What Changes

- A deterministic weekly summary: sessions and running minutes planned and done, planned days that were trained, the streak of active weeks, what the check-ins said (effort, tiredness, pain with area), and the next week's shape from the skeleton or the plan. A headline and a short list of highlights, each with the user's own numbers.
- A sentence written by the model over those facts, falling back to the headline.
- `GET /summary/week?monday=` and `GET /summary/week/narrative?monday=`.
- A summary screen with week paging, a card on Oggi from Monday to Wednesday about the week just finished, and a link from the week screen.

## Capabilities

### New Capabilities
- `weekly-summary`: the figures, the highlights, the narrative, the API and the screens.

### Modified Capabilities
<!-- None. -->

## Impact

- **Code**: new `training_plan/weekly_summary.py`, `api/routes_summary.py`, a `SUMMARY_SYSTEM_PROMPT` in `llm.py`; web `/summary` page, Oggi card, week link.
- **Database**: none (reads history, plan, check-ins, skeleton).
