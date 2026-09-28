## 1. Backend

- [x] 1.1 `training_plan/weekly_summary.py`: figures, streak, check-ins, next week, headline and highlights.
- [x] 1.2 `SUMMARY_SYSTEM_PROMPT` and `llm.write_summary_narrative`.
- [x] 1.3 `api/routes_summary.py`: `GET /summary/week`, `GET /summary/week/narrative`; schemas; router.
- [x] 1.4 Tests: three of four, streak of 5 and in-progress week, pain listed, next week from skeleton, highlights order and cap, default week.

## 2. Web

- [x] 2.1 Types and hooks.
- [x] 2.2 `/summary` page with week paging.
- [x] 2.3 Oggi card Monday to Wednesday; link from the week screen.

## 3. Verify

- [x] 3.1 Summary of the real account's last week; `uv run pytest`; web build. *(week of 21 Sep: 2 sessions, 81 running minutes, 6th active week in a row; no plan stored, so the plan figure is absent)*
