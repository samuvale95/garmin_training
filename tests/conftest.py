"""Shared test isolation for the server's process-wide state.

The read-through TTL cache (`api/cache.py`) outlives a single request on purpose --
without a reset, a cached `/strava/activity-match` answer from one test would be served
to the next. Garmin/Strava sessions and the food log no longer live in process state at
all (they're per-user, materialized from Postgres per call -- see `garmin_session.py`
and `user_tokenstore.py`), so there is nothing left to reset for those.

NOTE: `test_db.py`, `test_api.py`, `test_api_body.py`, and `test_api_caching.py` predate
the Postgres/per-user rewrite and are not updated yet -- see the TODO tracked alongside
this change. They need a real (or fake) Postgres to run against, which the old
`PASSO_DATA_DIR`/SQLite-per-test-directory fixture this file used to provide can no
longer stand in for.
"""

from __future__ import annotations

import pytest

from training_plan.api.cache import cache


@pytest.fixture(autouse=True)
def cold_server_state():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture(autouse=True)
def no_model_calls(monkeypatch):
    """No test may reach a hosted model by accident.

    Clearing the key is enough: every function in `llm.py` returns None without one, so
    an un-mocked call degrades exactly as it would in production instead of spending
    money on a developer's key mid-suite.
    """
    monkeypatch.delenv("OPENRUTER_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
