import pytest
from fastapi.testclient import TestClient

from training_plan.api import routes_diagnostics
from training_plan.api.app import app

TOKEN = "x" * 40


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv(routes_diagnostics.TOKEN_ENV, TOKEN)
    return TestClient(app)


def test_without_or_with_a_wrong_token_the_endpoints_look_absent(client, monkeypatch):
    assert client.get("/diagnostics/users").status_code == 404
    assert client.get("/diagnostics/users", headers={"x-diagnostics-token": "nope"}).status_code == 404
    monkeypatch.setenv(routes_diagnostics.TOKEN_ENV, "short")
    assert client.get("/diagnostics/users", headers={"x-diagnostics-token": "short"}).status_code == 404


def test_writes_are_not_routed(client):
    response = client.post("/diagnostics/users/u/services", headers={"x-diagnostics-token": TOKEN})
    assert response.status_code == 405


def test_services_tell_ok_empty_and_error_apart(client, monkeypatch):
    def boom():
        raise KeyError("athlete_profile")

    monkeypatch.setattr(
        routes_diagnostics,
        "_checks",
        lambda user_id: [("pieno", lambda: [1]), ("vuoto", list), ("rotto", boom)],
    )
    body = client.get("/diagnostics/users/u1/services", headers={"x-diagnostics-token": TOKEN}).json()
    assert body["summary"] == {"ok": 1, "vuoto": 1, "errore": 1}
    broken = next(c for c in body["checks"] if c["check"] == "rotto")
    assert broken["error"] == "KeyError" and "athlete_profile" in broken["message"]
    assert broken["where"].startswith("test_diagnostics.py:")
