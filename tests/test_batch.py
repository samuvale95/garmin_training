"""`POST /batch`: many reads in one round trip, each answered on its own line."""

import json

import pytest
from fastapi.testclient import TestClient

from training_plan.api.app import app


@pytest.fixture(autouse=True)
def authenticated(monkeypatch):
    monkeypatch.setenv("DEV_AUTH_BYPASS_USER_ID", "batch-test")


def _lines(response):
    return {row["i"]: row for row in (json.loads(line) for line in response.text.splitlines() if line.strip())}


def test_every_path_gets_its_own_answer_with_its_own_status():
    client = TestClient(app)
    response = client.post("/batch", json={"paths": ["/health", "/does-not-exist"]})
    assert response.status_code == 200
    rows = _lines(response)
    assert rows[0]["status"] == 200 and rows[0]["body"] == {"status": "ok"}
    assert rows[1]["status"] == 404


def test_only_app_paths_and_no_nesting():
    client = TestClient(app)
    for bad in (["https://example.com/x"], ["//example.com"], ["/batch"], []):
        assert client.post("/batch", json={"paths": bad}).status_code == 422


def test_too_many_paths_are_refused():
    client = TestClient(app)
    assert client.post("/batch", json={"paths": ["/health"] * 41}).status_code == 422
