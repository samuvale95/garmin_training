"""Autonomous agents that read aggregated data and *propose* changes -- never apply them.

Layout:
- `store.py`   -- tables: runs, proposals, memory, settings.
- `runtime.py` -- the only way an agent runs: kill switch, budgets, step limit, tools.
- `ux_detector.py` -- the first agent (deterministic anomaly pass; the LLM step comes later).

Every agent gets a read-only view of the `ux_*` aggregates and one write: `propose()`.
Nothing here touches a user's plan, Garmin, or the code.
"""
