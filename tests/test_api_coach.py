"""The /coach endpoints, over a fake Garmin.

Unlike `test_api.py` and friends, this module authenticates: `DEV_AUTH_BYPASS_USER_ID`
is the escape hatch `api/auth.py` already carries for local development, and it is
exactly what a test needs -- a fixed user id and no Supabase project. The older API
test modules predate the per-user rewrite and are still unauthenticated, which is why
they 401 (see `conftest.py`'s note); nothing here depends on them.

No Postgres either: the technique endpoints read Garmin and the in-process cache, and
touch the database not at all.
"""

import pytest
from fastapi.testclient import TestClient

from training_plan import llm
from training_plan.api import app as fastapi_app
from training_plan.api import garmin_session

TEST_USER_ID = "test-user"

RUN_ACTIVITY = {
    "activityName": "Fondo medio",
    "activityTypeDTO": {"typeKey": "running"},
    "summaryDTO": {
        "startTimeLocal": "2026-09-11T07:12:00.0",
        "distance": 12000,
        "duration": 3600,
        "averageHR": 152,
        "averageRunningCadenceInStepsPerMinute": 158,
        "avgGroundContactTime": 268,
        "avgVerticalOscillation": 10.6,
        "avgVerticalRatio": 9.4,
        "avgGroundContactBalance": 50.3,
        "avgStrideLength": 122.0,
    },
}

SPLITS = {"lapDTOs": [{"distance": 6000, "duration": 1740}, {"distance": 6000, "duration": 1860}]}


class FakeClient:
    activity = RUN_ACTIVITY
    splits: dict | None = SPLITS

    def get_activity(self, activity_id):
        return self.activity

    def get_activity_splits(self, activity_id):
        if self.splits is None:
            raise RuntimeError("splits unavailable")
        return self.splits


class FakeSync:
    def __init__(self):
        self.client = FakeClient()


@pytest.fixture(autouse=True)
def authenticated(monkeypatch):
    monkeypatch.setenv("DEV_AUTH_BYPASS_USER_ID", TEST_USER_ID)


@pytest.fixture(autouse=True)
def fake_garmin(monkeypatch):
    FakeClient.activity = RUN_ACTIVITY
    FakeClient.splits = SPLITS
    calls: list[int] = []

    def run(user_id, work):
        calls.append(1)
        return work(FakeSync())

    monkeypatch.setattr(garmin_session, "run", run)
    return calls


@pytest.fixture
def client():
    return TestClient(fastapi_app)


def test_technique_reads_the_activity(client):
    response = client.get("/coach/technique/9001")
    assert response.status_code == 200
    body = response.json()
    assert body["activity_id"] == 9001
    assert body["sport"] == "running"
    assert body["title"] == "Fondo medio"
    assert body["date"] == "2026-09-11"
    assert body["has_metrics"] is True


def test_every_metric_carries_the_band_it_was_judged_against(client):
    """The screen contract: a verdict with no reference next to it is a verdict the
    user has to take on faith."""
    metrics = client.get("/coach/technique/9001").json()["metrics"]
    assert metrics
    for metric in metrics:
        assert metric["reference"]
        assert metric["meaning"]
        assert metric["verdict"] in ("buono", "nella norma", "da lavorarci", "da leggere")


def test_the_pacing_read_comes_from_the_splits(client):
    pacing = client.get("/coach/technique/9001").json()["pacing"]
    assert pacing["kind"] == "positivo"
    assert pacing["first_half_pace_sec_per_km"] == 290.0


def test_missing_splits_cost_the_pacing_read_and_nothing_else(client):
    FakeClient.splits = None
    body = client.get("/coach/technique/9001").json()
    assert body["pacing"] is None
    assert body["metrics"]
    assert body["has_metrics"] is True


def test_an_activity_with_no_dynamics_says_so_instead_of_analysing_nothing(client):
    FakeClient.activity = {
        "activityName": "Tapis roulant",
        "activityTypeDTO": {"typeKey": "treadmill_running"},
        "summaryDTO": {"startTimeLocal": "2026-09-11T07:00:00.0", "distance": 8000, "duration": 2700},
    }
    FakeClient.splits = None
    body = client.get("/coach/technique/9001").json()
    assert body["has_metrics"] is False
    assert body["metrics"] == []
    assert body["headline"] == "L'orologio non ha registrato dati di tecnica"


def test_a_finished_activity_is_only_read_once(client, fake_garmin):
    """Its numbers never change again, so a second request must not buy a second pair
    of Garmin calls."""
    client.get("/coach/technique/9001")
    client.get("/coach/technique/9001")
    assert len(fake_garmin) == 1


def test_refresh_goes_back_to_garmin(client, fake_garmin):
    client.get("/coach/technique/9001")
    client.get("/coach/technique/9001", params={"refresh": "true"})
    assert len(fake_garmin) == 2


def test_two_activities_are_two_answers(client, fake_garmin):
    client.get("/coach/technique/9001")
    client.get("/coach/technique/9002")
    assert len(fake_garmin) == 2


# ---- the narrative -------------------------------------------------------------------


def test_the_narrative_falls_back_to_the_deterministic_read(client):
    """No key configured (see `conftest.no_model_calls`), so the model is unreachable
    and the screen still gets a sentence."""
    response = client.get("/coach/technique/9001/narrative")
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "template"
    assert "Parti più piano" in body["text"]


def test_the_narrative_uses_the_model_when_there_is_one(client, monkeypatch):
    seen: list[dict] = []

    def fake(facts):
        seen.append(facts)
        return "Bella seduta, ma sei partito troppo forte."

    monkeypatch.setattr(llm, "write_coach_narrative", fake)
    body = client.get("/coach/technique/9001/narrative").json()
    assert body == {"text": "Bella seduta, ma sei partito troppo forte.", "source": "model"}
    # The conclusion is reached before the model is asked -- it phrases, it does not decide.
    assert seen[0]["andatura"]["tipo"] == "positivo"
    assert "da_fare" in seen[0]


def test_the_model_never_sees_anything_it_was_not_given(client, monkeypatch):
    seen: list[dict] = []
    monkeypatch.setattr(llm, "write_coach_narrative", lambda facts: seen.append(facts) or "ok")
    client.get("/coach/technique/9001/narrative")
    assert set(seen[0]) <= {"sport", "seduta", "distanza_km", "durata_min", "misure", "andatura", "da_fare"}


def test_the_narrative_is_paid_for_once(client, monkeypatch):
    calls: list[int] = []
    monkeypatch.setattr(llm, "write_coach_narrative", lambda facts: calls.append(1) or "ok")
    client.get("/coach/technique/9001/narrative")
    client.get("/coach/technique/9001/narrative")
    assert len(calls) == 1


def test_an_anonymous_request_is_refused(client, monkeypatch):
    monkeypatch.delenv("DEV_AUTH_BYPASS_USER_ID", raising=False)
    assert client.get("/coach/technique/9001").status_code == 401


# ---- the trend -----------------------------------------------------------------------


def _run_activity(day, gct):
    return {
        "activityName": f"Corsa {day}",
        "activityTypeDTO": {"typeKey": "running"},
        "summaryDTO": {
            **RUN_ACTIVITY["summaryDTO"],
            "startTimeLocal": f"2026-09-{day:02d}T07:00:00.0",
            "avgGroundContactTime": gct,
        },
    }


@pytest.fixture
def improving(monkeypatch):
    """Four runs whose ground contact time is coming down."""
    by_id = {1: _run_activity(1, 285), 2: _run_activity(4, 280), 3: _run_activity(8, 276), 4: _run_activity(12, 255)}
    monkeypatch.setattr(FakeClient, "get_activity", lambda self, activity_id: by_id[activity_id])
    monkeypatch.setattr(FakeClient, "get_activity_splits", lambda self, activity_id: {"lapDTOs": []})
    return by_id


def test_the_trend_reads_every_activity_it_was_given(client, improving):
    response = client.post("/coach/trend", json={"activity_ids": [4, 3, 2, 1]})
    assert response.status_code == 200
    body = response.json()
    assert body["sessions_read"] == 4
    contact = next(t for t in body["trends"] if t["key"] == "contatto")
    assert contact["direction"] == "in miglioramento"
    assert [p["date"] for p in contact["points"]][0] == "2026-09-01"


def test_the_trend_is_capped(client, monkeypatch, improving):
    """Each activity is a pair of Garmin calls, and Garmin rate-limits by IP."""
    monkeypatch.setattr("training_plan.technique.MAX_TREND_ACTIVITIES", 2)
    body = client.post("/coach/trend", json={"activity_ids": [4, 3, 2, 1]}).json()
    assert body["sessions_read"] == 2


def test_one_unreadable_activity_narrows_the_trend_instead_of_losing_it(client, improving, monkeypatch):
    def flaky(self, activity_id):
        if activity_id == 2:
            raise RuntimeError("garmin said no")
        return improving[activity_id]

    monkeypatch.setattr(FakeClient, "get_activity", flaky)
    body = client.post("/coach/trend", json={"activity_ids": [4, 3, 2, 1]}).json()
    assert body["sessions_read"] == 3


def test_no_activities_is_an_empty_trend_not_an_error(client):
    body = client.post("/coach/trend", json={"activity_ids": []}).json()
    assert body == {"sessions_read": 0, "trends": []}


def test_the_trend_seeds_the_per_activity_cache(client, improving, fake_garmin):
    """Otherwise tapping a session straight after viewing the trend re-reads the very
    activity that was just fetched."""
    client.post("/coach/trend", json={"activity_ids": [4, 3, 2, 1]})
    before = len(fake_garmin)
    client.get("/coach/technique/3")
    assert len(fake_garmin) == before
