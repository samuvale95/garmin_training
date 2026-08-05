import pytest
from fastapi.testclient import TestClient

from training_plan.api import app as fastapi_app
from training_plan.api import routes_strava
from training_plan.strava_sync import StravaAuthError


class FakeStravaSync:
    instances: list["FakeStravaSync"] = []
    status_response = {"connected": True}
    activity_match_response = {"matched": False}
    shoes_response: list = []
    connect_should_fail = False
    shoes_should_fail = False

    def __init__(self, *args, **kwargs):
        FakeStravaSync.instances.append(self)

    def authorize_url(self) -> str:
        return "https://www.strava.com/oauth/authorize?client_id=fake"

    def exchange_code(self, code: str) -> None:
        if FakeStravaSync.connect_should_fail:
            raise StravaAuthError("bad code")

    def connection_status(self) -> dict:
        return FakeStravaSync.status_response

    def disconnect(self) -> None:
        pass

    def find_activity_match(self, session) -> dict:
        return FakeStravaSync.activity_match_response

    def shoe_wear(self) -> list:
        if FakeStravaSync.shoes_should_fail:
            raise StravaAuthError("Strava is not connected.")
        return FakeStravaSync.shoes_response

    def retire_shoe(self, gear_id: str) -> None:
        pass


@pytest.fixture(autouse=True)
def fake_strava(monkeypatch):
    FakeStravaSync.instances = []
    FakeStravaSync.status_response = {"connected": True}
    FakeStravaSync.activity_match_response = {"matched": False}
    FakeStravaSync.shoes_response = []
    FakeStravaSync.connect_should_fail = False
    monkeypatch.setattr(routes_strava, "StravaSync", FakeStravaSync)
    return FakeStravaSync


@pytest.fixture
def client():
    return TestClient(fastapi_app)


def _session_payload(day=10, title="Ripetute 6x1000", sport="running"):
    return {"date": f"2026-08-{day:02d}", "sport": sport, "title": title, "steps": []}


def test_authorize_returns_url(client):
    response = client.get("/strava/authorize")
    assert response.status_code == 200
    assert response.json()["authorize_url"].startswith("https://www.strava.com/oauth/authorize")


def test_connect_success(client):
    response = client.post("/strava/connect", json={"code": "auth-code"})
    assert response.status_code == 200
    assert response.json() == {"connected": True}


def test_connect_failure_maps_to_auth_failed(client, fake_strava):
    fake_strava.connect_should_fail = True
    response = client.post("/strava/connect", json={"code": "bad"})
    assert response.status_code == 401
    assert response.json()["category"] == "auth_failed"


def test_status_connected(client):
    response = client.get("/strava/status")
    assert response.status_code == 200
    assert response.json() == {"connected": True}


def test_status_not_connected(client, fake_strava):
    fake_strava.status_response = {"connected": False}
    response = client.get("/strava/status")
    assert response.json() == {"connected": False}


def test_disconnect(client):
    response = client.post("/strava/disconnect")
    assert response.status_code == 200
    assert response.json() == {"connected": False}


def test_activity_match_no_match(client):
    response = client.post("/strava/activity-match", json={"session": _session_payload()})
    assert response.status_code == 200
    assert response.json()["matched"] is False


def test_activity_match_found(client, fake_strava):
    fake_strava.activity_match_response = {
        "matched": True,
        "activity_id": 555,
        "title": "Morning Run",
        "distance_km": 14.0,
        "duration_min": 60.0,
        "avg_pace_sec_per_km": 264.0,
        "average_heartrate": 138.0,
        "max_heartrate": 164.0,
        "elevation_gain_m": 62.0,
        "felt_note": "pesante nelle ultime due",
        "plan_note": "Passo un filo più lento col battito più alto: la prossima ripetuta la ammorbidisco di 5\"/km.",
        "gear_id": "g1",
        "gear_name": "Endorphin Speed 3",
    }
    response = client.post("/strava/activity-match", json={"session": _session_payload()})
    body = response.json()
    assert body["matched"] is True
    assert body["gear_name"] == "Endorphin Speed 3"
    assert body["plan_note"].startswith("Passo un filo")


def test_shoes_lists_wear(client, fake_strava):
    fake_strava.shoes_response = [
        {"id": "g1", "name": "Endorphin Speed 3", "distance_km": 512.0, "wear_percent": 73.1, "weeks_remaining": 3, "retired": False}
    ]
    response = client.get("/strava/shoes")
    assert response.status_code == 200
    shoes = response.json()["shoes"]
    assert shoes[0]["wear_percent"] == 73.1


def test_retire_shoe(client):
    response = client.post("/strava/shoes/g1/retire")
    assert response.status_code == 200
    assert response.json() == {"id": "g1", "retired": True}


def test_shoes_requires_connection(client, fake_strava):
    fake_strava.shoes_should_fail = True
    response = client.get("/strava/shoes")
    assert response.status_code == 401
    assert response.json()["category"] == "auth_failed"
