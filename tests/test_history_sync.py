"""When a sync starts, which kind, and that a failure never leaves the history locked."""

import pytest

from training_plan import backfill, history
from training_plan.api import routes_history


def test_the_full_pass_repeats_until_it_has_finished_once(monkeypatch):
    monkeypatch.setattr(history, "get_progress", lambda user_id, task: None)
    assert backfill.sync_mode("u") == "full"
    monkeypatch.setattr(history, "get_progress", lambda user_id, task: {"done": False})
    assert backfill.sync_mode("u") == "full"


def test_after_one_clean_full_pass_it_is_incremental(monkeypatch):
    monkeypatch.setattr(history, "get_progress", lambda user_id, task: {"done": True})
    assert backfill.sync_mode("u") == "incremental"


def _run_returning(report):
    return lambda user_id, **kw: report


@pytest.mark.parametrize(
    ("report", "marked"),
    [
        (backfill.BackfillReport(), True),
        (backfill.BackfillReport(errors=["garmin 12: GarminSyncError"]), True),
        (backfill.BackfillReport(errors=["strava: ConnectError"]), False),
        (backfill.BackfillReport(stopped_early="rate limit"), False),
    ],
)
def test_only_a_clean_full_pass_is_recorded_as_done(monkeypatch, report, marked):
    recorded = []
    monkeypatch.setattr(backfill, "run", _run_returning(report))
    monkeypatch.setattr(history, "release_sync", lambda user_id, note=None: None)
    monkeypatch.setattr(history, "set_progress", lambda user_id, task, **kw: recorded.append(task))
    backfill.sync_user("u", "full")
    assert (backfill.FULL_SYNC_TASK in recorded) is marked


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
    monkeypatch.setattr(history, "get_progress", lambda user_id, task: None)
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


def test_a_strava_failure_does_not_undo_the_garmin_half(monkeypatch):
    """Strava is optional: its half failing is recorded, and the duplicate pass still runs."""
    import contextlib

    resolved = []
    monkeypatch.setattr(history, "ensure_schema", lambda: None)
    monkeypatch.setattr(history, "resolve_duplicates", lambda user_id, start, end: resolved.append(True))
    monkeypatch.setattr(
        backfill.user_tokenstore, "materialized_garmin_tokenstore", lambda user_id: contextlib.nullcontext("/tmp")
    )

    class FakeGarmin:
        def __init__(self, tokenstore):
            pass

        def login(self):
            pass

        def get_activity_streams(self, activity_id):
            return None

    monkeypatch.setattr(backfill, "GarminSync", FakeGarmin)
    monkeypatch.setattr(
        backfill, "backfill_garmin_activities", lambda *a, **kw: backfill.BackfillReport(activities_written=3)
    )
    monkeypatch.setattr(history, "activities_needing_stream", lambda *a: [])
    monkeypatch.setattr(backfill, "backfill_streams", lambda *a, **kw: backfill.BackfillReport())

    def strava_down(*a, **kw):
        raise ConnectionResetError("reset by peer")

    monkeypatch.setattr(backfill, "_strava_half", strava_down)

    report = backfill.run("u", days=7, wellness=False)
    assert report.activities_written == 3
    assert report.errors == ["strava: ConnectionResetError"]
    assert resolved == [True]
