## Context

- `plan_generator.generate` writes a window from tomorrow inside the limits, with the model or the fallback, and refuses to write over a plan that changed meanwhile (`plan_store.snapshot`).
- `move_check.adapt` turns a hard session into its easy version with the same minutes (quality) or under the long-run line (long).
- Check-ins, the readiness verdict (`readiness.assess_day` over the cached body snapshot), history per day, the adaptation mode (`history.load_profile`, `levels.default_adaptation_mode`) all exist.

## Goals / Non-Goals

**Goals:** the plan follows the real week; every change is small, explained and reversible; the user's own edits are untouched.

**Non-Goals:** a nightly job (the app has no scheduler; Oggi triggers the check), push notifications, adapting the skeleton (the next generation re-reads the history), nutrition.

## Decisions

1. **Events are detected, not stored as they happen.** A pure `detect_events(...)` over the rows; handled events are remembered through the adaptations that answered them (`plan_adaptation.events`). No hooks on every write path.
2. **Soften is local, replan is the generator.** Pain or a bad morning concerns the next day or two: rewriting three weeks for it would be the nightly rewrite the brainstorming rules out. A skipped or very different session changes the week's arithmetic, which is exactly what the generator already handles (the week's done minutes are fixed context).
3. **Dry run in the generator.** `generate(..., write=False)` returns the proposed sessions and the snapshot it read; accepting later writes them through `replace_unlocked(expected=...)`. A plan that changed meanwhile is rechecked instead of overwritten.
4. **Undo keeps the replaced sessions** (their content, per day) in the adaptation row; undo writes them back through the same replace path, the same day only -- after that the plan has moved on.
5. **Threshold stored with the skeleton** at generation; the first check after this change records it without an event.
6. **The check runs once a day from Oggi** (and after a check-in, which is the most common trigger). A replan with the model takes tens of seconds; the card reuses the generation wait.

## Risks / Trade-offs

- [Replan on every skipped session feels busy] → one adaptation answers all pending events at once, and a skipped easy run under 30 minutes is not an event.
- [Readiness needs Garmin] → it uses the cached body snapshot; if unavailable the event is simply not detected.
