## Why

Moving a session to another day must stay free: a rigid plan is abandoned (`BRAINSTORM-miglioramenti-e-gamification.md` §0.5). But some moves create a sequence that is genuinely risky for this user's level -- two hard days in a row for a beginner, intervals the day after the long run, a hard session right after reported pain. `plan-limits` already marks which rules are strong enough to warn (`warn_on_move`); nothing uses them yet.

## What Changes

- A move check: for a session and a target day, the warnings the move would create, computed on the sequence around the target day from planned sessions and, for past days, the stored history. Only rules with `warn_on_move`, plus a pain rule from the check-in, and only violations the move itself introduces.
- Each warning states the rule, the user's own sessions and numbers, and its evidence.
- An adapted version of the moved session that removes the warning (the same day, easier: quality without the fast work, a long run shortened below a long run).
- The three choices after a warning: **Confermo** (the move stays, the decision is recorded and that same sequence does not warn again), **Adatta** (the move stays with the adapted session), **Annulla** (the move is undone). Every decision is logged, to see later which rules users override.
- On the week screen (drag and drop) and in the editor (day change).

## Capabilities

### New Capabilities
- `move-warnings`: the check, the pain rule, the adapted session, the decisions and the UI.

### Modified Capabilities
<!-- None. -->

## Impact

- **Code**: new `training_plan/move_check.py`; routes `POST /plan/move-check`, `POST /plan/move-decisions` in `routes_plan.py`; web `MoveWarningSheet`, week screen and editor.
- **Database**: new table `move_decision`.
