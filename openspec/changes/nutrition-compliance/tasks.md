## 1. Backend

- [x] 1.1 `nutrition.compliance(target, totals, tomorrow, in_progress)` and the real-load session for a day.
- [x] 1.2 `/nutrition/targets` and `/nutrition/narrative` use the stored plan when no sessions are sent, and the real load.
- [x] 1.3 `GET /nutrition/status`; schemas.
- [x] 1.4 Weekly summary food line.
- [x] 1.5 Tests: every spec scenario.

## 2. Web

- [x] 2.1 Hook `useFuelStatus`; compliance lines in `TodayFuelBlock`.
- [x] 2.2 Remove the meal plan; keep during and recovery; hide the energy block at level 1.
- [x] 2.3 Summary page food line; typecheck, lint, build.

## 3. Verify

- [x] 3.1 Real account status for today; `uv run pytest`. *(no food logged on the real account; with two fake meals in a rolled-back transaction: carbohydrate and protein `sotto` with the grams missing, fat `dentro`. Found and fixed: with two sessions on one day the fuel was sized on the first listed, so an easy 40' hid a long run the same day; now the longest. 658 passed, same 22 pre-existing failures.)*
