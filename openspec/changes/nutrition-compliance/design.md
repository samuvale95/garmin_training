## Context

`nutrition.daily_fuelling(day, sessions, weight_kg, ...)` returns today's and tomorrow's `DayTarget` (carb, protein, fat ranges, load, energy check), plus meal plan, during-session and recovery values. `db.totals_for_date` / `totals_between` give logged totals. The plan is server-owned (`plan_store`); the history gives per-day running minutes.

## Goals / Non-Goals

**Goals:** values, not menus; say what is missing when it matters (before hard days); keep the fuelling frame (never restriction).

**Non-Goals:** calorie budgets or deficits, weight goals, micronutrients, removing `meal_plan` from the backend (the UI stops showing it; the code can go later).

## Decisions

1. **Server plan by default.** A request with sessions still wins (the Garmin-calendar-only account sends its calendar), so nothing breaks for that path.
2. **Real load only upward.** A day run longer than planned needs more fuel; a day run shorter keeps the planned target (the food was probably already eaten, and under-fuelling is the risk this module exists to avoid).
3. **`sopra` is information.** Above range for carbohydrate on a normal day is not a problem worth a red line; the brainstorming frame is fuelling.
4. **One flagged line.** Only carbohydrate before a hard or long day is emphasised: it is the only case with a real performance cost.
5. **Level 1 without kcal.** Counting calories is the opposite of the habit level 1 is building.

## Risks / Trade-offs

- [Photo estimates are rough] → the lines say "stima" like the rings already do; `sotto` by 10 g is not flagged (tolerance of 5% of the lower bound).

*Changed during implementation*: `_session_on` took the first session of a day; with two on the same day (an easy run and a long run) the fuel was sized for the easy one. It now takes the longest. The meal-plan block and its portion lines were removed from the web client; `nutrition.meal_plan` stays in the backend, unused by the screen.
