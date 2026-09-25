"""When a sync starts, which kind, and that a failure never leaves the history locked."""

import pytest

from training_plan import backfill, history
from training_plan.api import routes_history


def test_a_history_without_garmin_activities_gets_the_full_backfill(monkeypatch):
    """Including one filled from Strava before Garmin was a source."""
    monkeypatch.setattr(history, "has_activities", lambda user_id, source: source == "strava")
    assert backfill.sync_mode("u") == "full"


def test_a_history_with_garmin_activities_gets_the_incremental_pass(monkeypatch):
    monkeypatch.setattr(history, "has_activities", lambda user_id, source: True)
    assert backfill.sync_mode("u") == "incremental"


def test_the_incremental_pass_is_short_and_skips_wellness(monkeypatch):
    calls = []
    monkeypatch.setattr(backfill, "run", lambda user_id, **kw: calls.append(kw) or backfill.BackfillReport())
    monkeypatch.setattr(history, "release_sync", lambda user_id, note=None: None)
    backfill.sync_user("u", "incremental")
    assert calls == [{"days": backfill.INCREMENTAL_DAYS, "wellness": False}]


def test_a_failed_sync_still_releases_its_claim(monkeypatch):
    released = []

    def boom(user_id, **kw):
        raise RuntimeError("garmin down")

    monkeypatch.setattr(backfill, "run", boom)
    monkeypatch.setattr(history, "release_sync", lambda user_id, note=None: released.append(note))
    with pytest.raises(RuntimeError):
        backfill.sync_user("u", "full")
    assert released == ["full: failed"]


@pytest.mark.anyio
async def test_a_refused_claim_starts_nothing(monkeypatch):
    """Throttled or already running: the answer is a quiet no, and no thread."""
    monkeypatch.setattr(history, "claim_sync", lambda user_id, **kw: False)
    started = []
    monkeypatch.setattr(routes_history.threading, "Thread", lambda **kw: started.append(kw))

    response = await routes_history.history_sync(user_id="u")
    assert response.started is False
    assert started == []


@pytest.mark.anyio
async def test_a_granted_claim_starts_one_background_sync(monkeypatch):
    monkeypatch.setattr(history, "claim_sync", lambda user_id, **kw: True)
    monkeypatch.setattr(history, "has_activities", lambda user_id, source: False)
    started = []

    class FakeThread:
        def __init__(self, **kw):
            started.append(kw["args"])

        def start(self):
            pass

    monkeypatch.setattr(routes_history.threading, "Thread", FakeThread)
    response = await routes_history.history_sync(user_id="u")
    assert (response.started, response.mode) == (True, "full")
    assert started == [("u", "full")]
