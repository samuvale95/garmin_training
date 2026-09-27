## 1. Kinds and rules (pure)

- [x] 1.1 Create `training_plan/plan_rules.py` with `session_kind`, `RuleContext`, `Violation` and the rule table of design.md decision #2.
- [x] 1.2 Implement step-level easy/hard minutes (decision #4).
- [x] 1.3 Implement weekly grouping and the rules `volume_growth` (with the thin-history allowance), `hard_per_week`, `rest_days`, `easy_share`, `long_run_growth`.
- [x] 1.4 Implement the day-order rules `hard_in_a_row` and `hard_after_long`.
- [x] 1.5 Implement `deload` for windows of 4+ weeks.
- [x] 1.6 Implement `validate(sessions, context, *, only_move_warnings=False)`.
- [x] 1.7 Unit-test every spec scenario: kinds (intervals, steady run, misleading title), beginner vs athlete hard days, pause lowering thresholds, new user allowance, easy share 18/37, volume message numbers, `warn_on_move` false for `prudenza`, deload.

## 2. Context from the history

- [x] 2.1 Add `history.longest_run(user_id, start, end, running_sports)` over canonical rows.
- [x] 2.2 Implement `build_context(user_id, today)` from `daily_training`, `longest_run` and `levels.assess`.
- [x] 2.3 Check the context against the real account by hand (4-week average, longest run). *(real account: effective level 3, 181.4 min/week over the last 4 complete weeks -- 66, 322, 200, 137 by hand -- and a longest run of 185.6 min, a 16 km mountain run on 1 Aug; see the risk added to design.md)*

## 3. API

- [x] 3.1 Schemas for the context and violations.
- [x] 3.2 `POST /plan/validate` (body sessions, or the stored plan's next 21 days).
- [x] 3.3 Route test with context and store faked.

## 4. Verify

- [x] 4.1 Validate a real example plan (`examples/*.yaml`) against the real account's context and read the violations for plausibility. *(agosto_settembre_2026.yaml shifted to next week, real context: level 3 no violations; levels 1-2 flag the 5 weeks with three real hard sessions (VO2 Tue, tempo Thu, long-with-fast-work Sat) and an easy share of 76%. Found and fixed: strides made an easy run "qualità". Found and recorded: long runs written without steps are invisible to minute-based rules.)*
- [x] 4.2 Run `uv run pytest`. *(558 passed; the same 22 pre-existing failures outside this change)*
