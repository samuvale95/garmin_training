## Why

The AI plan (phase 2) is allowed to choose sessions only inside limits the code computes (`BRAINSTORM-miglioramenti-e-gamification.md` §0.4): the AI proposes, the code sets and checks the boundaries, so every plan the user sees is safe for their level whatever the model wrote. The same rules, filtered to the ones with solid evidence, are what the rescheduling warnings of §0.5 need. Neither exists yet: today nothing in the app can say whether a week of sessions is too much for this user.

## What Changes

- A deterministic rule engine that reads a window of planned sessions together with the user's recent history and effective level, and returns every rule the window breaks, each with the rule, the user's own numbers, the sessions involved and how strong the evidence is.
- One classification of a session's kind (`facile`, `lungo`, `qualità`, `forza`, `altro`) derived from its structure — duration, repeat blocks, paces — never from a label the AI could get wrong.
- A first set of rules, with thresholds per effective level: weekly volume growth, hard days in a row, a hard day after the long run, hard sessions per week, rest days per week, share of easy running time, long-run growth, and a lighter week after three building ones.
- Each rule states its evidence (`ricerca`, `consenso`, `prudenza`) and whether it is strong enough to warn a user who moves a session (§0.5 "the warning must be truthful").
- A context builder that reads what the rules need from the stored history: recent weekly running minutes, recent longest run, effective level.
- `POST /plan/validate`: validates a window (the current plan's by default, or sessions sent in the body) and returns the violations. For the generator to call and for inspecting the rules on a real plan; no screen shows it yet.

## Capabilities

### New Capabilities
- `plan-limits`: session kinds, the rules and their per-level thresholds, the evidence and move-warning flags, the context they read, and the validation API.

### Modified Capabilities
<!-- None: openspec/specs/ has no archived capabilities yet. -->

## Impact

- **Code**: a new pure module `training_plan/plan_rules.py`; a context builder reading `history` and `levels`; a route in `training_plan/api/`.
- **Database**: none. One more aggregate read from `activity` (longest recent run).
- **Existing behaviour**: unchanged. `nutrition.classify_load` and `readiness.session_demand` keep their own jobs; the rules use their own kind classification, built from the same helpers (`session_duration_minutes`, `has_quality_work`).
- **Next changes**: the AI generator calls the validator and must return a plan with no violations; phase 1's move warnings call it with `warn_on_move` rules only.
