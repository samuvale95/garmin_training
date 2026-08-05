import time
from datetime import date

import pytest
from fastapi.testclient import TestClient

from training_plan import service
from training_plan.api import app as fastapi_app
from training_plan.api import jobs as jobs_module
from training_plan.api import routes_garmin
from training_plan.garmin_sync import (
    CompletedActivity,
    DeleteResult,
    GarminRateLimitError,
    GarminSyncError,
    PlanDiff,
    ScheduledWorkout,
    SyncResult,
)


class FakeGarminSync:
    instances: list["FakeGarminSync"] = []
    login_should_fail = False
    login_should_rate_limit = False
    status_response = {"connected": True, "cooldown_active": False, "retry_after_seconds": 0, "reason": None}

    def __init__(self, email=None, password=None, tokenstore=None, state_path=None, prompt_mfa=None):
        self.email = email
        self.password = password
        self.prompt_mfa = prompt_mfa
        self.logged_in = False
        self.calls: list = []
        FakeGarminSync.instances.append(self)

    def login(self) -> None:
        self.calls.append("login")
        if FakeGarminSync.login_should_rate_limit:
            raise GarminRateLimitError("rate limited")
        if FakeGarminSync.login_should_fail:
            raise GarminSyncError("bad credentials")
        self.logged_in = True

    def connection_status(self) -> dict:
        return FakeGarminSync.status_response

    def diff_plan(self, sessions, check_content=False):
        return PlanDiff(to_create=list(sessions), already_present=[], extra_on_garmin=[])

    def list_scheduled_workouts(self, start, end):
        return [ScheduledWorkout(1, 10, date(2026, 8, 1), "running", "Easy Run")]

    def list_activities(self, start, end):
        return [CompletedActivity(1, date(2026, 8, 1), "running", "Morning Run", 10.0, 50.0)]

    def select_workouts(self, workouts, sport=None, title_match=None):
        return workouts

    def delete_all(self, workouts):
        return [DeleteResult(workout=w, success=True) for w in workouts]

    def create_and_schedule(self, session):
        return SyncResult(session=session, success=True)

    def replace_session(self, change):
        return SyncResult(session=change.session, success=True)


@pytest.fixture(autouse=True)
def fake_garmin(monkeypatch):
    FakeGarminSync.instances = []
    FakeGarminSync.login_should_fail = False
    FakeGarminSync.login_should_rate_limit = False
    FakeGarminSync.status_response = {
        "connected": True, "cooldown_active": False, "retry_after_seconds": 0, "reason": None
    }
    monkeypatch.setattr(service, "GarminSync", FakeGarminSync)
    monkeypatch.setattr(routes_garmin, "GarminSync", FakeGarminSync)
    monkeypatch.setattr(jobs_module, "GarminSync", FakeGarminSync)
    return FakeGarminSync


@pytest.fixture
def client():
    return TestClient(fastapi_app)


def _session_payload(day=1, title="Easy run", sport="running"):
    return {"date": f"2026-08-{day:02d}", "sport": sport, "title": title, "steps": []}


# ---- /plan/parse -----------------------------------------------------------------------------


def test_parse_plan_valid_yaml_text(client):
    yaml_text = "sessions:\n  - date: '2026-08-01'\n    sport: running\n    title: Easy run\n"
    response = client.post("/plan/parse", data={"yaml_text": yaml_text})
    assert response.status_code == 200
    sessions = response.json()["sessions"]
    assert len(sessions) == 1
    assert sessions[0]["title"] == "Easy run"


def test_parse_plan_invalid_yaml_returns_per_line_errors(client):
    yaml_text = "sessions:\n  - sport: running\n"
    response = client.post("/plan/parse", data={"yaml_text": yaml_text})
    assert response.status_code == 422
    body = response.json()
    assert body["category"] == "validation_failed"
    assert body["details"]


def test_parse_plan_requires_file_or_text(client):
    response = client.post("/plan/parse")
    assert response.status_code == 400


# ---- /plan/diff -------------------------------------------------------------------------------


def test_diff_plan_returns_categorized_sessions(client):
    response = client.post("/plan/diff", json={"sessions": [_session_payload()], "check_content": False})
    assert response.status_code == 200
    body = response.json()
    assert len(body["to_create"]) == 1
    assert body["already_present"] == []
    assert body["changed"] == []


# ---- /plan/sync -------------------------------------------------------------------------------


def test_sync_job_runs_to_completion(client):
    response = client.post(
        "/plan/sync", json={"to_create": [_session_payload(1), _session_payload(2)], "changed": []}
    )
    assert response.status_code == 200
    job_id = response.json()["job_id"]

    status = _poll_until_finished(client, job_id)

    assert status["status"] == "done"
    assert status["completed"] == 2
    assert all(item["status"] == "ok" for item in status["items"])


def test_sync_job_supports_a_single_created_session(client):
    """The workout-editor screen (10b) create mode drives `/plan/sync` with a
    one-item `to_create` list -- no dedicated single-session endpoint exists, per
    design.md decision #5, so this pins that the existing job path already covers it.
    """
    response = client.post("/plan/sync", json={"to_create": [_session_payload()], "changed": []})
    job_id = response.json()["job_id"]
    status = _poll_until_finished(client, job_id)
    assert status["status"] == "done"
    assert status["items"] == [
        {"date": "2026-08-01", "sport": "running", "title": "Easy run", "kind": "create", "status": "ok", "error": None}
    ]


def test_sync_job_supports_a_single_replaced_session():
    """10b edit mode drives `/plan/sync` with a one-item `changed` list, using
    placeholder local/remote hashes -- confirms `ChangedSessionIn.to_model()` accepts
    them without complaint (they're diff-display-only, per garmin_sync.py)."""
    from training_plan.api import schemas

    changed_in = schemas.ChangedSessionIn(
        session=schemas.TrainingSessionIn(**_session_payload(title="Edited title")),
        scheduled_workout_id=1,
        workout_id=10,
        workout_date=date(2026, 8, 1),
        workout_sport="running",
        workout_title="Easy run",
    )
    model = changed_in.to_model()
    assert model.local_hash == ""
    assert model.remote_hash == ""
    assert model.session.title == "Edited title"


def test_deletion_apply_supports_a_single_workout(client):
    """10b's edit-mode trash icon drives `/garmin/deletions/apply` with exactly the
    one scheduled workout being edited, reusing the existing deletion-apply path."""
    workout = {"scheduled_workout_id": 1, "workout_id": 10, "date": "2026-08-01", "sport": "running", "title": "Easy Run"}
    response = client.post("/garmin/deletions/apply", json={"workouts": [workout]})
    assert response.status_code == 200
    results = response.json()["results"]
    assert len(results) == 1
    assert results[0]["success"] is True


def test_sync_status_unknown_job_404(client):
    assert client.get("/plan/sync/does-not-exist").status_code == 404


def test_cancel_unknown_job_404(client):
    assert client.post("/plan/sync/does-not-exist/cancel").status_code == 404


def test_sync_job_reports_auth_failure(client, fake_garmin):
    fake_garmin.login_should_fail = True
    response = client.post("/plan/sync", json={"to_create": [_session_payload()], "changed": []})
    job_id = response.json()["job_id"]

    status = _poll_until_finished(client, job_id)

    assert status["status"] == "failed"
    assert status["failure_category"] == "auth_failed"


def _poll_until_finished(client, job_id, timeout=2.0):
    deadline = time.monotonic() + timeout
    status = client.get(f"/plan/sync/{job_id}").json()
    while status["status"] == "running" and time.monotonic() < deadline:
        time.sleep(0.02)
        status = client.get(f"/plan/sync/{job_id}").json()
    return status


# ---- /garmin/connect + /garmin/status ------------------------------------------------------


def test_garmin_connect_success(client):
    response = client.post("/garmin/connect", json={"email": "a@example.com", "password": "x"})
    assert response.status_code == 200
    assert response.json() == {"connected": True}


def test_garmin_connect_auth_failure(client, fake_garmin):
    fake_garmin.login_should_fail = True
    response = client.post("/garmin/connect", json={"email": "a@example.com", "password": "wrong"})
    assert response.status_code == 401
    assert response.json()["category"] == "auth_failed"


def test_garmin_connect_rate_limited(client, fake_garmin):
    fake_garmin.login_should_rate_limit = True
    response = client.post("/garmin/connect", json={"email": "a@example.com", "password": "x"})
    assert response.status_code == 429
    assert response.json()["category"] == "rate_limited"


def test_garmin_status_connected(client):
    response = client.get("/garmin/status")
    assert response.status_code == 200
    assert response.json()["connected"] is True


def test_garmin_status_cooldown(client, fake_garmin):
    fake_garmin.status_response = {
        "connected": False, "cooldown_active": True, "retry_after_seconds": 842, "reason": "rate_limited"
    }
    body = client.get("/garmin/status").json()
    assert body["cooldown_active"] is True
    assert body["retry_after_seconds"] == 842


# ---- /garmin/workouts, /garmin/deletions/* ---------------------------------------------------


def test_list_workouts(client):
    response = client.get("/garmin/workouts", params={"start": "2026-08-01", "end": "2026-08-31"})
    assert response.status_code == 200
    assert len(response.json()["workouts"]) == 1


def test_list_activities(client):
    response = client.get("/garmin/activities", params={"start": "2026-08-01", "end": "2026-08-31"})
    assert response.status_code == 200
    activities = response.json()["activities"]
    assert len(activities) == 1
    assert activities[0]["distance_km"] == 10.0


def test_deletion_preview_and_apply(client):
    preview = client.post("/garmin/deletions/preview", json={"start": "2026-08-01", "end": "2026-08-31"}).json()
    assert len(preview["selected"]) == 1

    applied = client.post("/garmin/deletions/apply", json={"workouts": preview["selected"]})
    assert applied.status_code == 200
    results = applied.json()["results"]
    assert results[0]["success"] is True
