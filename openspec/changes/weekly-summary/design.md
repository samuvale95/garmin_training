## Context

Per-day totals come from `history.daily_training` (canonical, sessions ≥ 15 minutes, running minutes). Planned sessions from `plan_store`. Check-ins from `checkin`. The skeleton from `db.get_skeleton`. `levels.ACTIVE_WEEK_SESSIONS` defines an active week.

## Goals / Non-Goals

**Goals:** one screen that answers "how did my week go" with numbers anyone can recount; a costanza streak that rewards showing up, not volume.

**Non-Goals:** heart-rate intensity per week (it needs the Garmin threshold on every read; `/coach` already shows the block), the athlete level (already its own screen, and it needs the threshold too), notifications, gamification points (next phase, which will read this summary).

## Decisions

1. **Pure builder, thin route.** `build_summary(...)` takes the rows and returns the summary; the route reads them. Testable without a database, like `plan_rules`.
2. **"Planned days trained", not "sessions matched".** A moved or swapped session still counts if the day was trained; matching titles or sports would punish exactly the flexibility §0.5 promises. Without a plan the figure is absent, not zero.
3. **Streak on the history, not the plan.** A user without a plan builds the habit too. The current week counts only once it is active, so Monday does not break a streak.
4. **Highlights ranked:** pain first (health), then consistency, then plan adherence, then effort. At most 4: a summary is read in ten seconds.
5. **Narrative cached on the facts**, like the other narrative endpoints.
6. **Default week:** Monday to Wednesday the finished week is the interesting one; from Thursday the current.

## Risks / Trade-offs

- [History sync lag] → a run not yet synced is missing; the summary says "dati fino a" the last synced day.
