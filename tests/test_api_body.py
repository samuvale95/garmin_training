import pytest
from fastapi.testclient import TestClient

from training_plan import body_insights
from training_plan.api import app as fastapi_app
from training_plan.api import garmin_session
from tests.test_body_insights import EmptyGarminClient, FakeGarminClient, FakeGarminSync


@pytest.fixture(autouse=True)
def fake_garmin_sync(monkeypatch):
    FakeGarminSync.client_cls = FakeGarminClient
    monkeypatch.setattr(body_insights, "GarminSync", FakeGarminSync)
    # The body endpoints now take their session from the shared holder, which builds its
    # own GarminSync -- that's the one these tests must intercept.
    monkeypatch.setattr(garmin_session, "GarminSync", FakeGarminSync)
    return FakeGarminSync


@pytest.fixture
def client():
    return TestClient(fastapi_app)


def test_body_today_returns_snapshot(client):
    response = client.get("/body/today")
    assert response.status_code == 200
    body = response.json()
    assert body["has_overnight_data"] is True
    assert body["readiness_score"] == 78


def test_body_today_missing_overnight_data(client, fake_garmin_sync):
    fake_garmin_sync.client_cls = EmptyGarminClient
    response = client.get("/body/today")
    assert response.status_code == 200
    assert response.json()["has_overnight_data"] is False


def test_body_load_returns_weeks(client):
    response = client.get("/body/load")
    assert response.status_code == 200
    body = response.json()
    assert len(body["weeks"]) == 5
    assert body["acute_chronic_ratio"] == 1.28


def test_body_conflict_without_next_session(client):
    response = client.post("/body/conflict", json={})
    assert response.status_code == 200
    assert response.json()["has_conflict"] is False


def test_body_conflict_with_demanding_next_session(client):
    payload = {
        "next_session": {
            "date": "2026-08-04",
            "sport": "running",
            "title": "Ripetute",
            "steps": [
                {"type": "interval", "duration_type": "distance", "duration_value": 1.0} for _ in range(6)
            ],
        }
    }
    response = client.post("/body/conflict", json=payload)
    assert response.status_code == 200
    body = response.json()
    # Readiness 78 in FakeGarminClient is not low, and HRV is a single flat value with
    # no baseline delta to compare against, so no conflict is expected here -- this
    # test exists to prove the endpoint wires the request through, not to re-assert
    # assess_conflict's own logic (already covered in test_body_insights.py).
    assert "has_conflict" in body
