"""Shared test isolation for the server's process-wide state.

Three things now outlive a single request on purpose: the authenticated Garmin session
(`api/garmin_session.py`), the read-through TTL cache (`api/cache.py`), and the food
log on disk (`db.py`). All three are exactly the kind of state that makes tests pass or
fail depending on what ran before them -- a cached `/strava/activity-match` answer would
be served to the next test, and a session adopted by a `/garmin/connect` test would still
be there afterwards. Reset all of them around every test so each one starts cold.
"""

from __future__ import annotations

import pytest

from training_plan.api import garmin_session
from training_plan.api.cache import cache


@pytest.fixture(autouse=True)
def cold_server_state():
    garmin_session.reset()
    cache.clear()
    yield
    garmin_session.reset()
    cache.clear()


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path, monkeypatch):
    """Point the food log at a per-test directory.

    Without this the suite writes meals and photographs into the developer's real
    `~/.passo` -- and, worse, reads them back, so a local database would quietly change
    what the assertions see.
    """
    monkeypatch.setenv("PASSO_DATA_DIR", str(tmp_path / "passo"))
    monkeypatch.delenv("PASSO_DB_PATH", raising=False)
    return tmp_path


@pytest.fixture(autouse=True)
def no_model_calls(monkeypatch):
    """No test may reach a hosted model by accident.

    Clearing the key is enough: every function in `llm.py` returns None without one, so
    an un-mocked call degrades exactly as it would in production instead of spending
    money on a developer's key mid-suite.
    """
    monkeypatch.delenv("OPENRUTER_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
