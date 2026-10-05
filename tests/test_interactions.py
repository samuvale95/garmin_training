"""Interaction-event validation, rate limit and ingest route (storage mocked)."""

import json

import pytest
from fastapi.testclient import TestClient

from training_plan import interactions
from training_plan.api import routes_events
from training_plan.api.app import app


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("DEV_AUTH_BYPASS_USER_ID", "user-from-jwt")
    interactions._hits.clear()
    return TestClient(app)


def test_unknown_event_type_is_dropped():
    assert interactions.clean_event({"event_type": "keylog"}) is None


def test_known_event_is_trimmed():
    event = interactions.clean_event(
        {"event_type": "tap", "target": "x" * 500, "path": "/today", "occurred_at": 1_700_000_000_000, "viewport": "390x844"}
    )
    assert event["target"] == "x" * interactions.MAX_TEXT
    assert event["occurred_at"].year == 2023


def test_oversized_metadata_is_discarded():
    event = interactions.clean_event({"event_type": "tap", "metadata": {"blob": "y" * 5000}})
    assert event["metadata"] == {}
    small = interactions.clean_event({"event_type": "tap", "metadata": {"x": 1}})
    assert json.loads(json.dumps(small["metadata"])) == {"x": 1}


def test_rate_limit_is_per_user_and_slides():
    interactions._hits.clear()
    assert all(interactions.allow_batch("a", now=0.0) for _ in range(interactions.RATE_LIMIT_BATCHES))
    assert not interactions.allow_batch("a", now=1.0)
    assert interactions.allow_batch("b", now=1.0)
    assert interactions.allow_batch("a", now=interactions.RATE_LIMIT_WINDOW_SECONDS + 2)


def test_batch_uses_user_id_from_token_not_body(client, monkeypatch):
    seen = {}
    monkeypatch.setattr(interactions, "store_batch", lambda user_id, session_id, events, **kw: seen.update(user=user_id))
    response = client.post(
        "/events/batch",
        json={"session_id": "s1", "events": [{"event_type": "tap"}], "user_id": "attacker"},
    )
    assert response.status_code == 204
    assert seen["user"] == "user-from-jwt"


def test_too_many_events_rejected(client, monkeypatch):
    monkeypatch.setattr(interactions, "store_batch", lambda *a, **k: 0)
    response = client.post(
        "/events/batch", json={"session_id": "s", "events": [{"event_type": "tap"}] * (interactions.MAX_BATCH + 1)}
    )
    assert response.status_code == 422


def test_batch_rate_limited(client, monkeypatch):
    monkeypatch.setattr(interactions, "store_batch", lambda *a, **k: 0)
    codes = [
        client.post("/events/batch", json={"session_id": "s", "events": []}).status_code
        for _ in range(interactions.RATE_LIMIT_BATCHES + 1)
    ]
    assert codes[-1] == 429


def test_storage_failure_never_surfaces(client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("db down")

    monkeypatch.setattr(interactions, "store_batch", boom)
    response = client.post("/events/batch", json={"session_id": "s", "events": [{"event_type": "tap"}]})
    assert response.status_code == 204
