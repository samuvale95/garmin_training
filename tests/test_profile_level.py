"""The level endpoint: computed from the history, stored only upwards, never set by hand."""

from datetime import date, timedelta

import pytest

from training_plan import history
from training_plan.api import routes_profile
from training_plan.api.cache import cache


@pytest.fixture
def fake_store(monkeypatch):
    store = {"reached_level": 1, "adaptation_mode": None, "raised": [], "days": []}
    monkeypatch.setattr(history, "daily_training", lambda *a, **kw: store["days"])
    monkeypatch.setattr(
        history,
        "load_profile",
        lambda user_id: {"reached_level": store["reached_level"], "adaptation_mode": store["adaptation_mode"]},
    )

    def raise_level(user_id, level):
        store["raised"].append(level)
        store["reached_level"] = max(store["reached_level"], level)

    monkeypatch.setattr(history, "raise_reached_level", raise_level)
    monkeypatch.setattr(history, "set_adaptation_mode", lambda user_id, mode: store.update(adaptation_mode=mode))
    monkeypatch.setattr(history, "activities_version", lambda user_id: (len(store["days"]), None))
    monkeypatch.setattr(routes_profile, "_zones", lambda user_id: None)
    cache.clear()
    yield store
    cache.clear()


def _regular_runner():
    """Two runs a week for the last eight complete weeks."""
    monday = date.today() - timedelta(days=date.today().weekday())
    return [
        {"day": monday - timedelta(weeks=k) + timedelta(days=d), "sessions": 1, "runs_with_hr": 1, "run_minutes": 40.0}
        for k in range(1, 9)
        for d in (0, 3)
    ]


@pytest.mark.anyio
async def test_a_new_user_is_level_one_with_the_next_level_explained(fake_store):
    out = await routes_profile.athlete_level(user_id="u")
    assert (out.level, out.level_name, out.state) == (1, "abitudine", "attivo")
    assert [c.key for c in out.next] == ["settimane_attive", "corse_con_cardio"]
    assert out.missing == ["settimane_attive", "corse_con_cardio"]
    assert fake_store["raised"] == []


@pytest.mark.anyio
async def test_a_higher_computed_level_is_stored(fake_store):
    fake_store["days"] = _regular_runner()
    out = await routes_profile.athlete_level(user_id="u")
    assert out.level == 2
    assert fake_store["raised"] == [2]


@pytest.mark.anyio
async def test_a_lower_computed_level_is_never_written(fake_store):
    fake_store["reached_level"] = 3
    out = await routes_profile.athlete_level(user_id="u")
    assert out.level == 3
    assert fake_store["raised"] == []


@pytest.mark.anyio
async def test_the_mode_can_be_overridden_and_reset(fake_store):
    from training_plan.api import schemas

    out = await routes_profile.adaptation_mode(schemas.AdaptationModeRequest(mode="proposta"), user_id="u")
    assert (out.adaptation_mode, out.adaptation_mode_is_default) == ("proposta", False)

    out = await routes_profile.adaptation_mode(schemas.AdaptationModeRequest(mode=None), user_id="u")
    assert (out.adaptation_mode, out.adaptation_mode_is_default) == ("automatico", True)


def test_no_route_writes_the_level():
    from training_plan.api.app import app

    writes = [
        (route.path, method)
        for route in app.routes
        for method in getattr(route, "methods", set())
        if route.path.startswith("/profile") and method in {"POST", "PUT", "PATCH", "DELETE"}
    ]
    assert writes == [("/profile/adaptation-mode", "PUT")]
