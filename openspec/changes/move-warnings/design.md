## Context

`plan_rules.validate(..., only_move_warnings=True)` gives the rules strong enough to warn: `hard_in_a_row`, `hard_after_long`, `hard_per_week`. Moves happen in two places: drag and drop on the week screen (`useUpdateSession` with a new date) and the editor's day field. Check-ins exist (`checkin.py`).

## Goals / Non-Goals

**Goals:** warn only when a move makes things worse, with the user's own numbers; never block; learn from decisions.

**Non-Goals:** warnings for Garmin-calendar-only workouts (no structure to classify), volume rules (a move does not change a week's volume, except across weeks, which `hard_per_week` covers), readiness-based warnings for a far day (readiness exists only for today).

## Decisions

1. **Difference, not state.** The check validates the sequence with and without the move and keeps what is new and involves the moved session. A week that already broke a rule is not the move's fault, and warning about it would teach the user to ignore warnings.
2. **Past days from the history.** A planned session in the past says what was intended, the history what happened. Past days are the history's canonical activities as sessions of the right length (a 95-minute run is a long run; a done interval session reads as easy, since the history has no steps: accepted, as in the generator).
3. **The real level, cheaply.** The first cut read the stored level only (`threshold_available=False`); on the real account the stored level was 1 because the level screen had never run, and moves were judged at level 2 instead of 3. Now the Garmin threshold is cached for hours when it answers (`routes_coach._zones`), and computing the context stores a higher level when the history shows one, so the check costs a few database reads and judges at the right level.
4. **Pain rule in code, not in `plan_rules`.** It reads check-ins, not sessions. Evidence `consenso`: training hard on a reported pain is the classic way a niggle becomes an injury.
5. **Adapted session is structural.** Quality becomes the same minutes easy, long becomes 80 minutes (below the 90-minute long-run line). Offered only if it clears every warning, so "Adatta" never answers a warning with another.
6. **Optimistic UI.** The move is applied first (as today), the check runs after; Annulla moves it back. The drag stays instant and a failed check degrades to today's behaviour.
7. **Fingerprint for "already confirmed".** `key + sorted session refs + dates`: the same sequence confirmed once is not re-warned; a different sequence is.

## Risks / Trade-offs

- [Done hard sessions read as easy] → a move next to yesterday's real intervals may not warn. Mitigation later: kinds from the history's heart rate.
- [Revert after Annulla locks the session] → moving it back is a user write; it was already locked by the move itself.

## Migration Plan

New table `move_decision` created at startup.
