"""The two pieces of process-wide state added for latency: the shared Garmin session
and the read-through TTL cache.

These are behavioral tests, not micro-benchmarks: they count how many times the
endpoints reach the (faked) Garmin/Strava layer, because that count *is* the thing that
made the UI slow -- every request used to re-login and re-fetch.
"""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from training_plan import body_insights, service
from training_plan.api import app as fastapi_app
from training_plan.api import garmin_session
from training_plan.api import routes_garmin
from training_plan.api.cache import (
    TTL_GARMIN_ACTIVITIES,
    TTL_GARMIN_WORKOUTS,
    TTL_PAST_RANGE,
    cache,
    range_ttl,
)
from training_plan.garmin_sync import (
    CompletedActivity,
    DeleteResult,
    GarminRateLimitError,
    GarminSyncError,
    PlanDiff,
    ScheduledWorkout,
)
from training_plan.models import TrainingSession


class CountingGarminSync:
    """A GarminSync stand-in that records every login and every calendar read."""

    logins = 0
    calendar_reads = 0
    workout_reads = 0
    login_error: Exception | None = None
    fail_calendar_once = False

    def __init__(self, *args, **kwargs):
        pass

    @classmethod
    def reset_counters(cls) -> None:
        cls.logins = 0
        cls.calendar_reads = 0
        cls.workout_reads = 0
        cls.login_error = None
        cls.fail_calendar_once = False

    def login(self) -> None:
        CountingGarminSync.logins += 1
        if CountingGarminSync.login_error is not None:
            raise CountingGarminSync.login_error

    def list_scheduled_workouts(self, start, end):
        if CountingGarminSync.fail_calendar_once:
            CountingGarminSync.fail_calendar_once = False
            raise GarminSyncError("session went stale")
        CountingGarminSync.calendar_reads += 1
        return [ScheduledWorkout(1, 10, date(2026, 8, 3), "running", "Easy Run")]

    def list_activities(self, start, end):
        return [CompletedActivity(1, date(2026, 8, 3), "running", "Morning Run", 10.0, 50.0)]

    def get_workout_session(self, workout_id, date_, sport, title):
        CountingGarminSync.workout_reads += 1
        return TrainingSession(date=date_, sport=sport, title=title)

    def diff_plan(self, sessions, check_content=False):
        return PlanDiff(to_create=list(sessions), already_present=[], extra_on_garmin=[])

    def disconnect(self) -> None:
        pass

    def delete_all(self, workouts):
        return [DeleteResult(workout=w, success=True) for w in workouts]

    def select_workouts(self, workouts, sport=None, title_match=None):
        return workouts


@pytest.fixture(autouse=True)
def counting_garmin(monkeypatch):
    CountingGarminSync.reset_counters()
    monkeypatch.setattr(garmin_session, "GarminSync", CountingGarminSync)
    monkeypatch.setattr(service, "GarminSync", CountingGarminSync)
    # `raising=False`: the route module reaches Garmin through `garmin_session`/`service`
    # and no longer imports `GarminSync` itself, so insisting on the attribute made the
    # fixture -- and with it every test in this file -- error out at setup.
    monkeypatch.setattr(routes_garmin, "GarminSync", CountingGarminSync, raising=False)
    return CountingGarminSync


@pytest.fixture
def client():
    return TestClient(fastapi_app)


WEEK = {"start": "2026-08-03", "end": "2026-08-09"}


# ---- shared session ---------------------------------------------------------------------------


def test_shared_session_logs_in_once_across_requests(client):
    """The whole point: N requests, one login.

    `garminconnect`'s `login()` always costs two extra Garmin round-trips even with a
    valid cached token, so a screen firing six queries used to pay twelve of them.
    """
    client.get("/garmin/workouts", params=WEEK)
    client.get("/garmin/activities", params=WEEK)
    client.get("/garmin/workouts", params={"start": "2026-08-10", "end": "2026-08-16"})

    assert CountingGarminSync.logins == 1


def test_reset_forces_a_new_login(client):
    client.get("/garmin/workouts", params=WEEK)
    garmin_session.reset()
    client.get("/garmin/workouts", params={"start": "2026-08-10", "end": "2026-08-16"})

    assert CountingGarminSync.logins == 2


def test_disconnect_drops_the_shared_session_and_cache(client):
    client.get("/garmin/workouts", params=WEEK)
    client.post("/garmin/disconnect")
    client.get("/garmin/workouts", params=WEEK)

    assert CountingGarminSync.logins == 2
    assert CountingGarminSync.calendar_reads == 2  # the cached week went with it


def test_stale_session_is_healed_once(client):
    """A cached Garmin session can expire server-side; the first call using it fails.

    That must not surface as an error the user has to retry by hand -- the session is
    dropped and the read is replayed against a fresh login, exactly once.
    """
    client.get("/garmin/workouts", params=WEEK)  # establishes the shared session
    CountingGarminSync.fail_calendar_once = True

    response = client.get("/garmin/workouts", params={"start": "2026-08-10", "end": "2026-08-16"})

    assert response.status_code == 200
    assert CountingGarminSync.logins == 2


def test_rate_limit_is_never_retried_and_reports_retry_after(client):
    """Retrying a rate limit is the one thing that makes it worse -- and the client
    needs the wait time, which `ErrorResponse.retry_after_seconds` used to never carry.
    """
    CountingGarminSync.login_error = GarminRateLimitError("slow down", retry_after_seconds=900)

    response = client.get("/garmin/workouts", params=WEEK)

    assert response.status_code == 429
    body = response.json()
    assert body["category"] == "rate_limited"
    assert body["retry_after_seconds"] == 900
    assert CountingGarminSync.logins == 1


# ---- TTL cache --------------------------------------------------------------------------------


def test_repeated_reads_hit_the_cache(client):
    client.get("/garmin/workouts", params=WEEK)
    client.get("/garmin/workouts", params=WEEK)
    client.get("/garmin/workouts", params=WEEK)

    assert CountingGarminSync.calendar_reads == 1


def test_a_different_range_is_a_different_entry(client):
    client.get("/garmin/workouts", params=WEEK)
    client.get("/garmin/workouts", params={"start": "2026-08-10", "end": "2026-08-16"})

    assert CountingGarminSync.calendar_reads == 2


def test_a_past_range_is_cached_far_longer_than_the_current_one():
    """Paging back to a week already looked at must not re-read Garmin.

    A range that has ended cannot change on its own -- only a write from this app can
    touch it, and that drops the whole namespace (see the invalidation tests below) --
    so it is held for a day instead of the minute the current week gets.
    """
    today = date(2026, 8, 20)

    assert range_ttl(date(2026, 8, 23), TTL_GARMIN_WORKOUTS, today=today) == TTL_GARMIN_WORKOUTS
    assert range_ttl(today, TTL_GARMIN_WORKOUTS, today=today) == TTL_GARMIN_WORKOUTS
    # Yesterday still counts as live: the caller's calendar day may be ahead of ours.
    assert range_ttl(date(2026, 8, 19), TTL_GARMIN_WORKOUTS, today=today) == TTL_GARMIN_WORKOUTS
    assert range_ttl(date(2026, 8, 18), TTL_GARMIN_WORKOUTS, today=today) == TTL_PAST_RANGE
    assert range_ttl(date(2026, 7, 5), TTL_GARMIN_ACTIVITIES, today=today) == TTL_PAST_RANGE


def test_refresh_bypasses_the_cache(client):
    """The manual refresh gesture has to actually reach Garmin."""
    client.get("/garmin/workouts", params=WEEK)
    client.get("/garmin/workouts", params={**WEEK, "refresh": "true"})

    assert CountingGarminSync.calendar_reads == 2


def test_deleting_a_workout_invalidates_the_cached_calendar(client):
    client.get("/garmin/workouts", params=WEEK)
    client.post(
        "/garmin/deletions/apply",
        json={
            "workouts": [
                {
                    "scheduled_workout_id": 1,
                    "workout_id": 10,
                    "date": "2026-08-03",
                    "sport": "running",
                    "title": "Easy Run",
                }
            ]
        },
    )
    client.get("/garmin/workouts", params=WEEK)

    assert CountingGarminSync.calendar_reads == 2


def test_writing_to_the_calendar_invalidates_a_cached_workout_structure(client):
    """A workout's steps are cached for an hour, which was safe only while they could
    not change. They can now be edited, and an edit is a delete plus a create -- so the
    cached structure has to go with the calendar it belonged to."""
    params = {"date": "2026-08-03", "sport": "running", "title": "Easy Run"}
    client.get("/garmin/workouts/10/session", params=params)
    client.get("/garmin/workouts/10/session", params=params)
    assert CountingGarminSync.workout_reads == 1  # second read served from the cache

    client.post(
        "/garmin/deletions/apply",
        json={
            "workouts": [
                {
                    "scheduled_workout_id": 1,
                    "workout_id": 10,
                    "date": "2026-08-03",
                    "sport": "running",
                    "title": "Easy Run",
                }
            ]
        },
    )
    client.get("/garmin/workouts/10/session", params=params)

    assert CountingGarminSync.workout_reads == 2


def test_cached_empty_result_is_still_a_hit(monkeypatch, client):
    """A falsy cached value (an empty calendar) must not read as a miss."""
    monkeypatch.setattr(CountingGarminSync, "list_scheduled_workouts", lambda self, start, end: [])
    assert client.get("/garmin/workouts", params=WEEK).json()["workouts"] == []
    assert cache.get_or_call("garmin:workouts", (date(2026, 8, 3), date(2026, 8, 9)), 60, lambda: ["boom"]) == []


# ---- /body/conflict reuses /body/today's snapshot ---------------------------------------------


class CountingBodySync:
    snapshots = 0

    def __init__(self, *args, **kwargs):
        pass

    def login(self) -> None:
        pass


def test_body_conflict_reuses_the_cached_snapshot(client, monkeypatch):
    """`/body/conflict` used to recompute the entire body snapshot -- eleven Garmin
    calls -- for data `/body/today` had just fetched on the very same screen.
    """
    calls = {"count": 0}

    def fake_snapshot(target_date=None, prompt_mfa=None, sync=None):
        calls["count"] += 1
        return body_insights.BodySnapshot(date=date(2026, 8, 5), has_overnight_data=True, readiness_score=80)

    monkeypatch.setattr(garmin_session, "GarminSync", CountingBodySync)
    monkeypatch.setattr(body_insights, "fetch_body_snapshot", fake_snapshot)

    assert client.get("/body/today").status_code == 200
    assert client.post("/body/conflict", json={}).status_code == 200

    assert calls["count"] == 1
