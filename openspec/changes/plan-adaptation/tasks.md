## 1. Backend

- [x] 1.1 `plan_generator.generate(write=False)` dry run returning proposed sessions and snapshot; store `threshold_hr` in the skeleton JSON.
- [x] 1.2 `training_plan/plan_adaptation.py`: `detect_events`, soften, replan, combine, diff with reasons.
- [x] 1.3 `plan_adaptation` table: store applied/pending with events, before/after; accept, reject, undo; handled events.
- [x] 1.4 Routes and schemas: check, get, accept, reject, undo.
- [x] 1.5 Tests: every event, soften for pain and tiredness, locked conflict, replan combined with soften, mode automatic vs proposal, handled once, undo.

## 2. Web

- [x] 2.1 Hooks.
- [x] 2.2 `AdaptationCard` on Oggi (applied with undo, proposal with accept/reject, waiting while replanning); check once a day and after a check-in.
- [x] 2.3 Mode switch on the level settings screen.
- [x] 2.4 Typecheck, lint, build.

## 3. Verify

- [x] 3.1 Real account in a rolled-back transaction; `uv run pytest`. *(a skipped Sunday session plus knee pain today, proposal mode: pending, plan untouched; accepted, tomorrow's intervals became "Fondo facile 53'" and the window was rewritten by the rules fallback around it; a second check found nothing new)*
