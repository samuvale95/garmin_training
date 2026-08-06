import json
import time
from datetime import date

import pytest

from training_plan import strava_sync
from training_plan.models import PaceTarget, Step, TrainingSession
from training_plan.strava_sync import StravaAuthError, StravaSync


class FakeResponse:
    def __init__(self, status_code: int, payload):
        self.status_code = status_code
        self._payload = payload
        self.text = json.dumps(payload) if not isinstance(payload, str) else payload

    def json(self):
        return self._payload


def make_sync(tmp_path, tokens: dict | None = None) -> StravaSync:
    tokenstore = tmp_path / "strava_tokens.json"
    if tokens is not None:
        tokenstore.write_text(json.dumps(tokens))
    return StravaSync(
        client_id="client-id",
        client_secret="client-secret",
        redirect_uri="http://localhost/cb",
        tokenstore=str(tokenstore),
        # Retired-shoe flags live outside the tokenstore now (so disconnecting Strava
        # can't wipe them); pin them under tmp_path too, or the tests would read and
        # write the real one in $HOME.
        shoestore=str(tmp_path / "strava_shoes.json"),
    )


def valid_tokens(**overrides) -> dict:
    tokens = {
        "access_token": "access-1",
        "refresh_token": "refresh-1",
        "expires_at": int(time.time()) + 3600,
        "athlete_id": 42,
    }
    tokens.update(overrides)
    return tokens


# ---- OAuth ----------------------------------------------------------------------------------


def test_authorize_url_includes_client_id_and_scope(tmp_path):
    sync = make_sync(tmp_path)
    url = sync.authorize_url()
    assert "client_id=client-id" in url
    assert "scope=activity" in url


def test_authorize_url_requires_credentials(monkeypatch, tmp_path):
    # Other test modules import `training_plan.api.app`, which now calls
    # `load_dotenv()` (needed so a real `uvicorn` run picks up a local .env) --
    # that's a process-wide side effect once any module does it, so a developer's
    # real STRAVA_CLIENT_ID/SECRET can otherwise leak into this "missing
    # credentials" test via os.environ. Force the unset state explicitly instead
    # of relying on the ambient environment happening to be clean.
    monkeypatch.delenv("STRAVA_CLIENT_ID", raising=False)
    monkeypatch.delenv("STRAVA_CLIENT_SECRET", raising=False)
    sync = StravaSync(client_id=None, client_secret=None, redirect_uri="http://x", tokenstore=str(tmp_path / "t.json"))
    with pytest.raises(StravaAuthError):
        sync.authorize_url()


def test_exchange_code_stores_tokens(monkeypatch, tmp_path):
    sync = make_sync(tmp_path)

    def fake_post(url, data=None, **kwargs):
        assert data["grant_type"] == "authorization_code"
        assert data["code"] == "auth-code"
        return FakeResponse(200, {"access_token": "a1", "refresh_token": "r1", "expires_at": 999, "athlete": {"id": 7}})

    monkeypatch.setattr(strava_sync.httpx, "post", fake_post)
    sync.exchange_code("auth-code")

    stored = json.loads((tmp_path / "strava_tokens.json").read_text())
    assert stored["access_token"] == "a1"
    assert stored["refresh_token"] == "r1"
    assert stored["athlete_id"] == 7


def test_connection_status_reflects_stored_refresh_token(tmp_path):
    sync = make_sync(tmp_path, tokens=valid_tokens())
    assert sync.connection_status() == {"connected": True}


def test_connection_status_disconnected_with_no_tokens(tmp_path):
    sync = make_sync(tmp_path)
    assert sync.connection_status() == {"connected": False}


def test_disconnect_clears_tokenstore(monkeypatch, tmp_path):
    sync = make_sync(tmp_path, tokens=valid_tokens())
    monkeypatch.setattr(strava_sync.httpx, "post", lambda *a, **k: FakeResponse(200, {}))
    sync.disconnect()
    assert sync.connection_status() == {"connected": False}


def test_expired_token_is_refreshed_before_use(monkeypatch, tmp_path):
    sync = make_sync(tmp_path, tokens=valid_tokens(expires_at=int(time.time()) - 10))
    calls = []

    def fake_post(url, data=None, **kwargs):
        calls.append(data)
        return FakeResponse(200, {"access_token": "a2", "refresh_token": "r2", "expires_at": int(time.time()) + 3600})

    monkeypatch.setattr(strava_sync.httpx, "post", fake_post)
    token = sync._ensure_fresh_access_token()

    assert token == "a2"
    assert calls[0]["grant_type"] == "refresh_token"


def test_refresh_failure_clears_local_state(monkeypatch, tmp_path):
    sync = make_sync(tmp_path, tokens=valid_tokens(expires_at=int(time.time()) - 10))
    monkeypatch.setattr(strava_sync.httpx, "post", lambda *a, **k: FakeResponse(400, {"error": "invalid_grant"}))

    with pytest.raises(StravaAuthError):
        sync._ensure_fresh_access_token()
    assert sync.connection_status() == {"connected": False}


# ---- activity matching ------------------------------------------------------------------------


def _session(sport="running", steps=None) -> TrainingSession:
    return TrainingSession(date=date(2026, 8, 10), sport=sport, title="Ripetute 6x1000", steps=steps or [])


def test_find_activity_match_no_activities(monkeypatch, tmp_path):
    sync = make_sync(tmp_path, tokens=valid_tokens())
    monkeypatch.setattr(strava_sync.httpx, "get", lambda *a, **k: FakeResponse(200, []))
    result = sync.find_activity_match(_session())
    assert result == {"matched": False}


def test_find_activity_match_single_activity(monkeypatch, tmp_path):
    sync = make_sync(tmp_path, tokens=valid_tokens())

    def fake_get(url, params=None, headers=None, timeout=None):
        if url.endswith("/athlete/activities"):
            return FakeResponse(200, [{"id": 555, "type": "Run", "sport_type": "Run", "moving_time": 3000}])
        if url.endswith("/activities/555"):
            return FakeResponse(
                200,
                {
                    "id": 555,
                    "name": "Morning Run",
                    "distance": 14000,
                    "moving_time": 3000,
                    "average_heartrate": 138,
                    "max_heartrate": 164,
                    "total_elevation_gain": 62,
                    "description": "pesante nelle ultime due",
                    "gear": {"id": "g1", "name": "Endorphin Speed 3"},
                },
            )
        raise AssertionError(f"unexpected url {url}")

    monkeypatch.setattr(strava_sync.httpx, "get", fake_get)

    steps = [Step(type="interval", duration_type="distance", duration_value=1.0, target_pace=PaceTarget(260, 250)) for _ in range(6)]
    result = sync.find_activity_match(_session(steps=steps))

    assert result["matched"] is True
    assert result["activity_id"] == 555
    assert result["gear_name"] == "Endorphin Speed 3"
    assert result["felt_note"] == "pesante nelle ultime due"
    assert result["average_heartrate"] == 138


def test_find_activity_match_picks_closest_duration(monkeypatch, tmp_path):
    sync = make_sync(tmp_path, tokens=valid_tokens())

    def fake_get_by_path(url, params=None, headers=None, timeout=None):
        if url.endswith("/athlete/activities"):
            return FakeResponse(
                200,
                [
                    {"id": 1, "type": "Run", "sport_type": "Run", "moving_time": 600},
                    {"id": 2, "type": "Run", "sport_type": "Run", "moving_time": 3000},
                ],
            )
        activity_id = int(url.rsplit("/", 1)[-1])
        return FakeResponse(200, {"id": activity_id, "distance": 14000, "moving_time": 3000})

    monkeypatch.setattr(strava_sync.httpx, "get", fake_get_by_path)

    steps = [Step(type="interval", duration_type="time", duration_value=50.0)]  # 50 min planned
    result = sync.find_activity_match(_session(steps=steps))
    assert result["activity_id"] == 2  # 3000s (50min) is closer to planned 50min than 600s


def test_find_activity_match_ignores_incompatible_sport(monkeypatch, tmp_path):
    sync = make_sync(tmp_path, tokens=valid_tokens())
    monkeypatch.setattr(
        strava_sync.httpx,
        "get",
        lambda *a, **k: FakeResponse(200, [{"id": 1, "type": "Ride", "sport_type": "Ride", "moving_time": 3000}]),
    )
    result = sync.find_activity_match(_session(sport="running"))
    assert result == {"matched": False}


def test_find_activity_matches_for_range_buckets_by_date_with_one_list_call(monkeypatch, tmp_path):
    sync = make_sync(tmp_path, tokens=valid_tokens())
    monday = TrainingSession(date=date(2026, 8, 10), sport="running", title="Fondo", steps=[])
    wednesday = TrainingSession(date=date(2026, 8, 12), sport="running", title="Riposo", steps=[])
    friday = TrainingSession(date=date(2026, 8, 14), sport="running", title="Ripetute", steps=[])

    calls = {"list_activities": 0}

    def fake_get(url, params=None, headers=None, timeout=None):
        if url.endswith("/athlete/activities"):
            calls["list_activities"] += 1
            return FakeResponse(
                200,
                [
                    {
                        "id": 10,
                        "type": "Run",
                        "sport_type": "Run",
                        "moving_time": 1800,
                        "start_date_local": "2026-08-10T07:00:00Z",
                    },
                    {
                        "id": 20,
                        "type": "Run",
                        "sport_type": "Run",
                        "moving_time": 2400,
                        "start_date_local": "2026-08-14T07:00:00Z",
                    },
                ],
            )
        activity_id = int(url.rsplit("/", 1)[-1])
        return FakeResponse(200, {"id": activity_id, "distance": 10000, "moving_time": 1800})

    monkeypatch.setattr(strava_sync.httpx, "get", fake_get)

    matches = sync.find_activity_matches_for_range([monday, wednesday, friday])

    assert calls["list_activities"] == 1  # one call for the whole range, not one per session
    assert matches["2026-08-10"]["matched"] is True
    assert matches["2026-08-10"]["activity_id"] == 10
    assert matches["2026-08-12"] == {"matched": False}  # no activity that day
    assert matches["2026-08-14"]["matched"] is True
    assert matches["2026-08-14"]["activity_id"] == 20


# ---- shoe wear ----------------------------------------------------------------------------------


def test_shoe_wear_computes_percent_and_estimate(monkeypatch, tmp_path):
    sync = make_sync(tmp_path, tokens=valid_tokens())

    def fake_get(url, params=None, headers=None, timeout=None):
        if url.endswith("/athlete"):
            return FakeResponse(200, {"shoes": [{"id": "g1", "name": "Endorphin Speed 3"}]})
        if url.endswith("/athlete/activities"):
            return FakeResponse(200, [{"id": 1, "distance": 14000, "gear_id": "g1"}])
        if url.endswith("/gear/g1"):
            return FakeResponse(200, {"id": "g1", "name": "Endorphin Speed 3", "distance": 512000, "retired": False})
        raise AssertionError(url)

    monkeypatch.setattr(strava_sync.httpx, "get", fake_get)
    shoes = sync.shoe_wear()

    assert len(shoes) == 1
    shoe = shoes[0]
    assert shoe["distance_km"] == 512.0
    assert shoe["wear_percent"] == pytest.approx(73.1, abs=0.1)
    assert shoe["retired"] is False
    assert shoe["weeks_remaining"] is not None


def test_retire_shoe_persists_and_excludes_from_active(monkeypatch, tmp_path):
    sync = make_sync(tmp_path, tokens=valid_tokens())
    sync.retire_shoe("g1")

    def fake_get(url, params=None, headers=None, timeout=None):
        if url.endswith("/athlete"):
            return FakeResponse(200, {"shoes": [{"id": "g1", "name": "Old shoe"}]})
        if url.endswith("/athlete/activities"):
            return FakeResponse(200, [])
        if url.endswith("/gear/g1"):
            return FakeResponse(200, {"id": "g1", "name": "Old shoe", "distance": 100000, "retired": False})
        raise AssertionError(url)

    monkeypatch.setattr(strava_sync.httpx, "get", fake_get)
    shoes = sync.shoe_wear()
    assert shoes[0]["retired"] is True

    # Retirement persists across a fresh StravaSync instance against the same store.
    sync2 = make_sync(tmp_path)
    assert "g1" in sync2._retired_gear_ids()


def test_retire_shoe_survives_a_disconnect(monkeypatch, tmp_path):
    """Retiring a shoe is a local flag, so disconnecting Strava must not undo it.

    It used to be stored inside the tokenstore, which `disconnect()` deletes (as does a
    failed refresh, and any 401) -- so reconnecting silently un-retired every shoe.
    """
    sync = make_sync(tmp_path, tokens=valid_tokens())
    sync.retire_shoe("g1")

    monkeypatch.setattr(strava_sync.httpx, "post", lambda *a, **k: FakeResponse(200, {}))
    sync.disconnect()

    assert sync.connection_status() == {"connected": False}
    assert "g1" in make_sync(tmp_path)._retired_gear_ids()
