## 1. Backend

- [x] 1.1 `training_plan/progress.py`: weeks walk (streak, tokens, protected), day and week points with reasons, badges with dates and progress, mascot.
- [x] 1.2 `weekly_summary` uses the progress streak and carries the week's points and badges.
- [x] 1.3 `api/routes_progress.py`: `GET /progress`; schemas; router.
- [x] 1.4 Tests: every spec scenario.

## 2. Web

- [x] 2.1 Types and `useProgress`.
- [x] 2.2 Progressi screen: mascot, streak and tokens, week points with lines, badges.
- [x] 2.3 Oggi card; summary section.
- [x] 2.4 Typecheck, lint, build.

## 3. Verify

- [x] 3.1 Progress of the real account; `uv run pytest`. *(streak 43 weeks with 3 tokens spent on isolated one-session weeks in 52; 2 tokens held; level 3; badges: 4/12/26 in a row, levels. Found and fixed: "Primo passo" dated the window's first week instead of an unknown older date.)*
