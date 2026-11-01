"""The Garmin workout-code probe is read-only and admin-only."""

from fastapi.testclient import TestClient

from training_plan.api.app import app
from training_plan.garmin_sync import GarminSync


def test_a_non_admin_cannot_probe(monkeypatch):
    monkeypatch.setenv("DEV_AUTH_BYPASS_USER_ID", "not-an-admin")
    monkeypatch.setattr("training_plan.admins.is_admin", lambda user_id, email=None: False)
    client = TestClient(app)
    assert client.get("/garmin/probe/workout-types").status_code == 403
    assert client.get("/garmin/probe/workout/1").status_code == 403


class _Client:
    def connectapi(self, path):
        assert path == "/workout-service/workout/types"
        return {"workoutSportTypes": [{"sportTypeId": 1, "sportTypeKey": "running"}]}

    def get_workouts(self, start, limit):
        return [
            {"workoutId": 1, "sportType": {"sportTypeId": 1, "sportTypeKey": "running"}},
            {"workoutId": 2, "sportType": {"sportTypeId": 1, "sportTypeKey": "running"}},
            {"workoutId": 3, "sportType": {"sportTypeId": 5, "sportTypeKey": "strength_training"}},
        ]

    def __getattr__(self, name):  # anything that would write must not be called
        raise AssertionError(f"probe called {name}")


def test_the_probe_only_reads_and_groups_saved_workouts_by_sport():
    sync = GarminSync.__new__(GarminSync)
    sync._client = _Client()
    out = sync.probe_workout_types()
    assert out["types"]["workoutSportTypes"][0]["sportTypeKey"] == "running"
    counts = {s["sportType"]["sportTypeKey"]: s["count"] for s in out["saved_workout_sports"]}
    assert counts == {"running": 2, "strength_training": 1}


def test_sport_codes_match_what_garmin_reports():
    """Read from /workout-service/workout/types on a real account (docs/garmin-workouts.md):
    the earlier values sent swims as "other", strength as "cardio_training" and other as
    "pilates"."""
    from training_plan.models import SPORT_TYPE_PAYLOAD

    ids = {sport: (p["sportTypeId"], p["sportTypeKey"]) for sport, p in SPORT_TYPE_PAYLOAD.items()}
    assert ids["running"] == (1, "running")
    assert ids["cycling"] == (2, "cycling")
    assert ids["swimming"] == (4, "swimming")
    assert ids["strength_training"] == (5, "strength_training")
    assert ids["calisthenics"] == (5, "strength_training")
    assert ids["other"] == (3, "other")


def test_a_step_note_travels_to_garmin_and_back():
    """The note is what the watch shows on the step ("Trazioni · 6 ripetizioni")."""
    from training_plan.garmin_sync import _build_step_payload, _parse_workout_step
    from training_plan.models import Step

    step = Step(type="interval", duration_type="time", duration_value=1, note="Trazioni · 6 ripetizioni")
    payload = _build_step_payload(step, 1)
    assert payload["description"] == "Trazioni · 6 ripetizioni"
    assert _parse_workout_step(payload).note == "Trazioni · 6 ripetizioni"
    assert "description" not in _build_step_payload(Step(type="interval", duration_type="time", duration_value=1), 1)
