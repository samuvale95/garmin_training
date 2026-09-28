## Context

Per-day history (`history.daily_training`), plan rows (`plan_store`), check-ins, the stored reached level and `plan_rules.session_kind` are all there. The weekly summary computes a plain streak.

## Goals / Non-Goals

**Goals:** reward consistency and good choices with points anyone can recount; never reward volume; never punish resting when hurt.

**Non-Goals:** leaderboards or leagues (no multiplayer), territories, weekly challenges, sharing cards, heart-rate-based "easy really easy" points (needs per-activity zone reads; later), shoes badge (Strava-only data).

## Decisions

1. **Recomputed, not stored.** Points and badges are a pure function of rows the app already keeps. No ledger table: a rule fixed later applies to the whole history, and nothing can drift out of sync. 52 weeks bound the work.
2. **Soft "as planned".** A planned day counts if any training happened that day: until the plan adapts itself (phase 2), matching the exact session would punish the flexibility the app promises.
3. **Only completed days score**, so today's points do not jump around while the user is still deciding; the week's bonus arrives when it becomes active (for the active bonus) or ends (for the rest).
4. **Tokens earned, not bought.** One per 4 active weeks, max 2: enough to cover a flu week, not enough to make the streak meaningless. Pain protects without a token: resting when hurt is the behaviour the app wants.
5. **Over-plan penalty only with a plan**, at 130%: the same spirit as the volume limits, without pretending precision.
6. **Mascot uses the existing illustrations** (`esultanza`, `corsa`, `riposo`, `attesa`); `crollo` is not used: the app never shows the user collapsing for missing a day.

## Risks / Trade-offs

- [Self-reported pain as a free pass] → a protected week keeps the streak but does not extend it and earns no weekly bonus; gaming it gains nothing.
- [History sync lag] → a run not yet synced scores later; points are recomputed, so nothing is lost.
