## 1. Backend

- [x] 1.1 `training_plan/move_check.py`: sequence building (plan + history), difference check, pain rule, fingerprint, adapted session.
- [x] 1.2 `move_decision` table, record and read confirmed fingerprints.
- [x] 1.3 Routes `POST /plan/move-check` and `POST /plan/move-decisions`; schemas.
- [x] 1.4 Tests: beginner vs athlete, pre-existing violation ignored, pain rule, adapted session clears warnings, confirmed not repeated, message content.

## 2. Web

- [x] 2.1 Hooks `checkMove`, `recordMoveDecision`.
- [x] 2.2 `MoveWarningSheet` with the three choices.
- [x] 2.3 Week screen drag and drop, and editor day change, go through it.

## 3. Verify

- [x] 3.1 Check a real move on the real account (rolled back); `uv run pytest`; web build. *(level 3: intervals the day after a 100' long run, no warning; after knee pain reported today, intervals tomorrow warn with area and day and offer "Fondo facile 55'". Found and fixed: the stored level was 1 because the level screen had never run, so moves were judged at level 2; the threshold is now cached and the context stores a higher level. 626 passed, same 22 pre-existing failures; web build ok.)*
