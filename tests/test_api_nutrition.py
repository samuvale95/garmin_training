"""The fuelling endpoints, including the states that matter most: no Garmin, no model.

Both are supported states rather than errors -- a user with no smart scale and no API
key must still get a usable screen -- so most of what is pinned here is the shape of
the degraded answer, not the happy path.
"""

from __future__ import annotations

import base64

import pytest
from fastapi.testclient import TestClient

from training_plan import llm, nutrition
from training_plan.api import app as fastapi_app
from training_plan.api import routes_body


@pytest.fixture
def client():
    return TestClient(fastapi_app)


@pytest.fixture(autouse=True)
def no_garmin(monkeypatch):
    """Nothing connected, unless a test says otherwise.

    Autouse and not optional: without it these endpoints reach a real Garmin account
    over the network, which is slow, rate-limited, and makes the assertions depend on
    whoever's `.env` is sitting in the checkout.
    """
    monkeypatch.setattr(routes_body, "body_metrics_or_empty", lambda: {})


@pytest.fixture
def weighed(monkeypatch):
    monkeypatch.setattr(
        routes_body,
        "body_metrics_or_empty",
        lambda: {"weight_kg": 64.0, "source": "scale", "measured_on": "2026-08-05"},
    )


# 35 km with no pace named, so it is estimated at the 6:00/km fallback: 3h30, comfortably
# past the three-hour line rather than sitting on it.
LONG_RUN = {
    "date": "2026-08-11",
    "sport": "running",
    "title": "Lungo 35 km",
    "steps": [{"type": "interval", "duration_type": "distance", "duration_value": 35}],
}


# ---- targets ------------------------------------------------------------------------


def test_targets_without_a_weight_use_the_reference_and_declare_it(client):
    response = client.post("/nutrition/targets", json={"date": "2026-08-10", "sessions": []})
    assert response.status_code == 200
    body = response.json()
    assert body["weight_source"] == "reference"
    assert body["weight_kg"] == nutrition.REFERENCE_WEIGHT_KG


def test_targets_use_the_garmin_weight_when_there_is_one(client, weighed):
    response = client.post("/nutrition/targets", json={"date": "2026-08-10", "sessions": []})
    body = response.json()
    assert (body["weight_kg"], body["weight_source"]) == (64.0, "scale")


def test_a_weight_sent_by_the_client_wins(client, weighed):
    """The user is standing on a scale; Garmin is remembering a number from 2023."""
    response = client.post(
        "/nutrition/targets", json={"date": "2026-08-10", "sessions": [], "weight_kg": 71.5}
    )
    body = response.json()
    assert (body["weight_kg"], body["weight_source"]) == (71.5, "manual")


def test_tomorrows_session_drives_the_target(client, weighed):
    response = client.post(
        "/nutrition/targets", json={"date": "2026-08-10", "sessions": [LONG_RUN]}
    )
    body = response.json()
    assert body["tomorrow"]["load"] == "molto_lungo"
    assert body["tomorrow"]["session_title"] == "Lungo 35 km"
    assert body["tomorrow"]["carb_g"] == [640, 768]
    assert body["advice"]


def test_targets_never_carry_a_narrative(client):
    """It is null by construction, not "not loaded yet": the sentence has its own
    endpoint so this response stays instant."""
    response = client.post("/nutrition/targets", json={"date": "2026-08-10", "sessions": []})
    assert response.json()["narrative"] is None


def test_targets_default_to_today(client):
    response = client.post("/nutrition/targets", json={"sessions": []})
    assert response.status_code == 200
    assert response.json()["date"]


# ---- narrative ----------------------------------------------------------------------


def test_the_narrative_falls_back_to_the_template_with_no_model(client):
    response = client.post("/nutrition/narrative", json={"date": "2026-08-10", "sessions": [LONG_RUN]})
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "template"
    assert "lungo 35 km" in body["text"]


def test_the_narrative_uses_the_model_when_there_is_one(client, monkeypatch):
    monkeypatch.setattr(llm, "write_fuelling_narrative", lambda facts: "Stasera riso, domani si vola.")
    response = client.post("/nutrition/narrative", json={"date": "2026-08-10", "sessions": []})
    body = response.json()
    assert (body["source"], body["text"]) == ("model", "Stasera riso, domani si vola.")


def test_the_narrative_sees_what_was_logged(client, monkeypatch):
    seen: list[dict] = []
    monkeypatch.setattr(llm, "write_fuelling_narrative", lambda facts: seen.append(facts) or "ok")
    client.post("/nutrition/entry", json={"date": "2026-08-10", "carb_g": 120})
    client.post("/nutrition/narrative", json={"date": "2026-08-10", "sessions": []})
    assert seen[0]["oggi_assunto"]["carboidrati_g"] == 120


# ---- the log ------------------------------------------------------------------------


def test_an_empty_day_is_an_empty_list_not_an_error(client):
    response = client.get("/nutrition/day", params={"date": "2026-08-10"})
    assert response.status_code == 200
    body = response.json()
    assert body["entries"] == []
    assert body["totals"]["entries"] == 0


def test_a_manual_entry_counts_as_corrected(client):
    """Typed in by a human, so it carries the same weight as a corrected estimate."""
    response = client.post(
        "/nutrition/entry",
        json={"date": "2026-08-10", "description": "riso e pollo", "carb_g": 90, "protein_g": 35},
    )
    assert response.status_code == 200
    entry = response.json()
    assert entry["corrected"] is True
    assert entry["source"] == "manual"
    assert entry["image_url"] is None


def test_entries_and_totals_come_back_together(client):
    client.post("/nutrition/entry", json={"date": "2026-08-10", "carb_g": 90})
    client.post("/nutrition/entry", json={"date": "2026-08-10", "carb_g": 45})
    body = client.get("/nutrition/day", params={"date": "2026-08-10"}).json()
    assert len(body["entries"]) == 2
    assert body["totals"]["carb_g"] == 135


def test_a_correction_marks_the_entry(client):
    created = client.post("/nutrition/entry", json={"date": "2026-08-10", "carb_g": 90}).json()
    response = client.patch(f"/nutrition/entry/{created['id']}", json={"carb_g": 120})
    assert response.status_code == 200
    assert response.json()["carb_g"] == 120


def test_correcting_a_missing_entry_is_a_404(client):
    assert client.patch("/nutrition/entry/999", json={"carb_g": 1}).status_code == 404


def test_deleting_works_and_is_idempotent_about_saying_so(client):
    created = client.post("/nutrition/entry", json={"date": "2026-08-10", "carb_g": 90}).json()
    assert client.delete(f"/nutrition/entry/{created['id']}").status_code == 200
    assert client.delete(f"/nutrition/entry/{created['id']}").status_code == 404


def test_history_covers_every_day_in_the_window(client):
    client.post("/nutrition/entry", json={"date": "2026-08-10", "carb_g": 90})
    days = client.get("/nutrition/history", params={"days": 3, "end": "2026-08-10"}).json()["days"]
    assert [d["date"] for d in days] == ["2026-08-08", "2026-08-09", "2026-08-10"]
    assert days[-1]["carb_g"] == 90


# ---- photos -------------------------------------------------------------------------


def _photo(monkeypatch, estimate):
    monkeypatch.setattr(llm, "estimate_macros_from_photo", lambda data, mime="image/jpeg": estimate)


def test_a_photo_is_stored_even_when_the_model_cannot_read_it(client, monkeypatch):
    """The estimate is not the record, the row is. A user who took the photo should not
    have to take it again because a third-party API was down -- the row simply arrives
    empty, like a manual entry waiting to be filled in.
    """
    _photo(monkeypatch, None)
    response = client.post(
        "/nutrition/photo",
        files={"image": ("plate.jpg", b"jpeg-bytes", "image/jpeg")},
        data={"date": "2026-08-10"},
    )
    assert response.status_code == 200
    entry = response.json()
    assert entry["carb_g"] is None
    assert entry["confidence"] is None
    # No thumbnail was uploaded alongside this photo, so there is nothing to show.
    assert entry["image_url"] is None


def test_a_read_photo_carries_its_estimate_and_confidence(client, monkeypatch):
    _photo(
        monkeypatch,
        llm.MacroEstimate(
            description="pasta al pomodoro",
            kcal=620,
            carb_g=95,
            protein_g=20,
            fat_g=15,
            confidence="low",
        ),
    )
    entry = client.post(
        "/nutrition/photo",
        files={"image": ("plate.jpg", b"jpeg-bytes", "image/jpeg")},
        data={"date": "2026-08-10"},
    ).json()
    assert entry["description"] == "pasta al pomodoro"
    assert entry["confidence"] == "low"
    assert entry["corrected"] is False


def test_a_thumbnail_travels_back_as_a_data_uri(client, monkeypatch):
    """The low-quality thumbnail the client generates client-side (never the full
    photo) rides inside the same JSON response as a `data:` URI -- there is no
    fetch-by-id endpoint to point at, since every route needs a bearer token a plain
    `<img src>` could never attach.
    """
    _photo(monkeypatch, None)
    entry = client.post(
        "/nutrition/photo",
        files={
            "image": ("plate.jpg", b"jpeg-bytes", "image/jpeg"),
            "thumbnail": ("thumb.jpg", b"tiny-thumb-bytes", "image/jpeg"),
        },
    ).json()
    assert entry["image_url"] == f"data:image/jpeg;base64,{base64.b64encode(b'tiny-thumb-bytes').decode()}"


def test_an_entry_with_no_thumbnail_has_no_image_url(client):
    entry = client.post("/nutrition/entry", json={"date": "2026-08-10", "carb_g": 90}).json()
    assert entry["image_url"] is None


def test_an_empty_upload_is_rejected(client):
    response = client.post("/nutrition/photo", files={"image": ("plate.jpg", b"", "image/jpeg")})
    assert response.status_code == 422


def test_an_oversized_upload_is_rejected(client, monkeypatch):
    monkeypatch.setattr("training_plan.api.routes_nutrition.MAX_PHOTO_BYTES", 10)
    response = client.post(
        "/nutrition/photo", files={"image": ("plate.jpg", b"more than ten bytes", "image/jpeg")}
    )
    assert response.status_code == 413


def test_an_oversized_thumbnail_is_rejected(client, monkeypatch):
    """The size cap on `thumbnail` exists for a client that lies about how it was
    generated -- a well-behaved client's downscaled JPEG never gets close to it."""
    _photo(monkeypatch, None)
    monkeypatch.setattr("training_plan.api.routes_nutrition.MAX_THUMBNAIL_BYTES", 10)
    response = client.post(
        "/nutrition/photo",
        files={
            "image": ("plate.jpg", b"jpeg-bytes", "image/jpeg"),
            "thumbnail": ("thumb.jpg", b"more than ten bytes", "image/jpeg"),
        },
    )
    assert response.status_code == 413


# ---- config -------------------------------------------------------------------------


def test_config_reports_the_degraded_state_with_no_key(client):
    body = client.get("/nutrition/config").json()
    assert body["configured"] is False
    assert body["photo_upload_enabled"] is False
    assert body["vision_model"]


def test_body_metrics_degrade_to_nulls_without_garmin(client):
    body = client.get("/body/metrics").json()
    assert body["weight_kg"] is None
    assert body["source"] is None
