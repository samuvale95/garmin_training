## 1. Backend

- [x] 1.1 `training_plan/checkin.py`: table, `CheckIn` model with validation, `get_range`, `save`, `delete`, `signals(checkins, today)`.
- [x] 1.2 `readiness.read_signals` / `assess_day` accept check-in signals; `/body/readiness` and its narrative load today's and yesterday's check-ins.
- [x] 1.3 `api/routes_checkin.py`: GET range, PUT, DELETE; schemas; router and schema setup in `app.py`.
- [x] 1.4 Tests: validation (area only with pain, future date), replace on second save, signals (pain strong with area, troppo and stanco moderate), verdict with knee pain yesterday.

## 2. Web

- [x] 2.1 Types and hooks (`useCheckIns`, `useSaveCheckIn`).
- [x] 2.2 `CheckInCard` on Oggi: when to ask, two answers, pain area, answered state with change.
- [x] 2.3 Typecheck, lint, build. *(build run once at the end of phase 1)*

## 3. Verify

- [x] 3.1 Round-trip on the real database in a rolled-back transaction; `uv run pytest`.
