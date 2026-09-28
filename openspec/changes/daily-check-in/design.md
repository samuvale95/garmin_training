## Context

`readiness.assess_day` counts threshold signals from the watch into `pronto` / `cauto` / `scarico` and an alternative for today's session. Oggi (`web/src/app/(tabs)/today/page.tsx`) shows it as `DayStateCard`. Completed activities reach the client from Garmin (`useActivities`); the plan's sessions are in the plan query.

## Goals / Non-Goals

**Goals:** the answer in two taps; stored per day; used by the verdict now and by move warnings and the weekly summary next.

**Non-Goals:** RPE scales, free-text diaries, notifications (the app has no push channel yet), per-activity check-ins (one per day is what a day's verdict and a weekly summary read).

## Decisions

1. **Four effort answers, three body answers.** Words, not a 1–10 scale: a beginner cannot place "6", but can say "dura". `troppo` exists separately from `dura` because "hard as intended" and "harder than I could handle" lead to different decisions.
2. **Pain area is a fixed list.** Enough to name it back ("dolore al ginocchio") and to count it in the summary; free text would need a model to read.
3. **The client decides when to ask.** It already has today's activities and plan; asking the server would add a Garmin call for a UI decision. The server only stores.
4. **Signals, not a veto.** Pain is a `forte` signal in the existing counting: alone it makes the day `cauto`, with one more signal `scarico`. Consistent with how every other signal works, and the move-warnings rule gives pain its own hard stop for hard sessions.
5. **Check-ins of today and yesterday.** Yesterday's answer is what a morning verdict can use; older answers are the summary's job.

## Risks / Trade-offs

- [Users skip it] → the card asks once a day, only after training, and costs two taps; the summary shows how many days were answered, not a streak to guilt.
- [Pain is a health signal the app is not qualified to interpret] → the signal only says what was reported and suggests the easier option; no diagnosis wording (same rule as `READINESS_SYSTEM_PROMPT`).

## Migration Plan

New table created by `ensure_schema` at startup; nothing to backfill.
