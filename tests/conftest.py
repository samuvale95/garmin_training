"""Shared test isolation for the server's process-wide state.

Two things now outlive a single request on purpose: the authenticated Garmin session
(`api/garmin_session.py`) and the read-through TTL cache (`api/cache.py`). Both are
exactly the kind of state that makes tests pass or fail depending on what ran before
them -- a cached `/strava/activity-match` answer would be served to the next test, and
a session adopted by a `/garmin/connect` test would still be there afterwards. Reset
both around every test so each one starts from a cold server.
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
