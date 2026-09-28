## Why

Consistency is the product's main metric and the whole point of the gamification (`BRAINSTORM-miglioramenti-e-gamification.md` §5bis). Phase 1 gave the app the inputs -- history, plan, check-ins, levels, the weekly summary -- but nothing rewards showing up week after week, respecting rest, or listening to the body. The first slice, as filtered: a streak with a safety token, explainable "Disciplina" points, simple badges verified by the data, and a mascot using the existing illustrations.

## What Changes

- **Streak of active weeks** with a **salva-serie token**: one earned every 4 active weeks in a row (at most 2 kept), used automatically on an inactive week; a week with pain reported is protected without spending one -- resting when hurt never breaks a streak.
- **Disciplina points**, recomputed from the data and each with its reason: a planned day trained, a planned rest day respected, a check-in, a "smart choice" (easing off a hard day after reporting pain or tiredness), an active week, a week with every planned day done. Running more than planned earns nothing, and a week far over plan loses points. Without a plan, training days count, capped per week.
- **Badges** verified by the data: first session, first complete week, 4 / 12 / 26 weeks in a row, first smart choice, 7 check-ins, level 2 and level 3; each unearned one shows its progress.
- **Mascot** state for the day from the existing illustrations (celebrating, running, resting, waiting), with one sentence.
- `GET /progress`; a **Progressi** screen; a card on Oggi; the weekly summary shows the week's points and badges and uses the streak with tokens.

## Capabilities

### New Capabilities
- `progress`: streak and tokens, points, badges, mascot, API and screens.

### Modified Capabilities
- `weekly-summary`: the streak follows the token rules, and the summary carries the week's points and badges.

## Impact

- **Code**: new `training_plan/progress.py` (pure), `api/routes_progress.py`; `weekly_summary` uses `progress.streak`; web `/progress` screen, Oggi card, summary section.
- **Database**: none. Everything is recomputed from stored rows, so a rule change applies to the past too and nothing can drift.
