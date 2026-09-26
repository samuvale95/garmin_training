## Context

After `garmin-first-activity-history` the `activity` table holds one canonical row per real workout (`duplicate_of IS NULL`), from Garmin first and Strava second, kept current by the sync on app open. Each row has `day` (local date), `sport`, `duration_min` and `avg_hr`. The Garmin lactate-threshold heart rate is read by `routes_coach._zones` through `garmin_session.run(... sync.lactate_threshold())`.

Nothing in the app knows anything about the user beyond their data and a race goal. There is no per-user profile table.

The rules below were decided with the product owner: the level is never lowered (a pause gives a temporary *effective* level instead), consistency counts all sports but levels 2 and 3 need running with heart rate, and the level cannot be chosen by hand.

## Goals / Non-Goals

**Goals:**
- One deterministic function from history to level, testable without a database.
- Every criterion reportable as "measured / required / met", so the screen can say what is missing rather than show a badge.
- A stored high-water mark, so the level survives a pause and a history window moving on.
- An adaptation-mode preference stored with a level-based default, ready for phase 2.

**Non-Goals:**
- Changing any existing screen by level. Gating `/coach`, sizing warnings, choosing what the home screen shows: phase-1 work, reading this API.
- A UI for the adaptation mode. It does nothing until the plan adapts (phase 2); a setting that has no effect would mislead. The API accepts it now so phase 2 does not need a migration.
- Level-up celebration, notifications, gamification. They build on this, later.
- Tuning the thresholds against many users. They are a first cut from the brainstorming and one real history; see Risks.

## Decisions

### 1. A pure `levels.py` over daily aggregates

`history.daily_training(user_id, start, end)` returns one row per day with activity: `sessions`, `runs_with_hr`, `run_minutes`, from canonical rows lasting at least 15 minutes. One `GROUP BY day` query over at most 26 weeks plus the pause look-back, so it is cheap.

`levels.assess(days, *, today, threshold_available, reached_level) -> LevelAssessment` does everything else in Python: weekly buckets (Monday start, complete weeks only), each criterion, the computed level, the stored high-water mark applied, the pause/return state and the effective level. Pure, so every scenario of the spec is a unit test.

Criteria are data, not branches: a `Criterion(key, label, measured, required, met, unit)` list per level. The screen renders the list; the API returns it; the tests assert on it. Adding or retuning a criterion is one entry.

The numbers live as module constants with a comment each (the same style as `intensity.py`): `MIN_SESSION_MINUTES = 15`, `ACTIVE_WEEK_SESSIONS = 2`, level 2 = 6 of 8 weeks + 4 runs with HR, level 3 = 20 of 26 weeks with 3+ sessions + 150 running minutes per week over 12 weeks + threshold, `PAUSE_DAYS = 28`, `PAUSE_MAX_SESSIONS = 1`, `RETURN_DAYS = 21`.

### 2. Pause and return from the session dates

A day is *in pause* when the 28 days ending on it hold at most 1 session and the user had trained before them.

- `pausa`: today is in pause.
- `ripresa`: today is not, but one of the previous 21 days was.

*Changed during implementation*: the first version defined the return from "the first session after a stretch of 28 quiet days". With one session allowed inside a pause, the second session back also has a quiet stretch behind it, so the return never ended. Defining it on days in pause removes the ambiguity. The "trained before" condition keeps a brand-new user out of both states.

The effective level is `max(1, level - 1)` in either state.

### 3. The high-water mark lives in a new `athlete_profile` table

```sql
CREATE TABLE IF NOT EXISTS athlete_profile (
    user_id          TEXT PRIMARY KEY,
    reached_level    SMALLINT NOT NULL DEFAULT 1,
    reached_at       TIMESTAMPTZ,
    adaptation_mode  TEXT,          -- NULL: use the level default
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Created in `history.SCHEMA` (it is per-user state derived from the history, and `ensure_schema` already runs at startup). `reached_level` is only ever raised, with `GREATEST` in the upsert, so two concurrent reads can never lower it. `adaptation_mode` NULL means "default for the level", which is what makes the default follow the level until the user chooses.

### 4. Computed on read, persisted only when it rises

`GET /profile/level` reads the daily aggregates and the stored profile, reads the threshold, computes, writes back `reached_level` only when the computed level is higher, and returns. Cached per user under `profile:level`, keyed on `history.streams_version` like `/coach/plan`, so a new synced activity recomputes on the next read and nothing else does.

The threshold read reuses `routes_coach._zones`. When Garmin fails, the level 3 threshold criterion is simply unmet for that read; the high-water mark means a user already at level 3 is not affected by a Garmin hiccup.

*Alternative considered*: recomputing at the end of every sync. It would put Garmin's threshold call inside the background sync and couple two features that have no reason to be coupled. Reading on demand with a streams-keyed cache costs one aggregation per new activity.

### 5. API shape

- `GET /profile/level` → `{level, level_name, effective_level, state, criteria: {current: [...], next: [...]}, missing: [keys], adaptation_mode, adaptation_mode_is_default}`
- `PUT /profile/adaptation-mode` with `{mode: "automatico" | "proposta" | null}`; `null` goes back to the default.

No endpoint writes the level.

### 6. Settings

A "Livello" row in `settings/page.tsx`, same pattern as "Obiettivo" and "Corpo", showing "Livello N · nome". It opens `/settings/level`: the level, one line on what it means, the state when not `attivo` (with what it changes: "per qualche settimana ti proponiamo carichi da livello N−1"), and the next level's criteria as rows with measured / required. Level 3 shows the level 3 criteria as "what keeps you here" instead of a next level.

## Risks / Trade-offs

- **Thresholds are a first cut** → they are constants with the reasoning next to them, and the per-criterion API makes a wrong one visible on screen. Retuning is a one-line change and, thanks to the high-water mark, can only ever raise users, never demote them — which also means a threshold set too low cannot be taken back for users who already crossed it. Starting strict is the safer error.
- **Level 3 depends on Garmin's threshold estimate**, which not every watch or user has → such users stay at level 2 with the missing criterion named. The later "soglie ricalibrate" item (a field test as an anchor) is the fix, not this change.
- **All sports count for consistency** → a user who only swims stays at level 1 however regular they are. Intended: levels 2 and 3 are about running structure. The level screen names the missing criterion so it does not look like a bug.
- **Local-date weeks**: `activity.day` is the local date of the start, so a Monday 00:30 run counts in the new week. Acceptable at this granularity.
