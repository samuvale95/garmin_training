"""The plan routes: user writes lock, imports replace, legacy clients cannot wipe ids."""

from uuid import uuid4

import pytest
from fastapi import HTTPException

from training_plan import db, plan_store
from training_plan.api import routes_plan, schemas

SESSION = {"date": "2026-10-01", "sport": "running", "title": "Corsa", "description": None, "steps": []}


@pytest.fixture
def store(monkeypatch):
    calls = {"create": [], "update": [], "import": [], "saved": []}
    plan = db.UserPlan(yaml_text="", sessions=[], filename=None, imported_at="now", goal=None)

    monkeypatch.setattr(db, "ensure_plan", lambda user_id: None)
    monkeypatch.setattr(db, "get_plan", lambda user_id: plan)
    monkeypatch.setattr(db, "save_plan", lambda **kw: calls["saved"].append(kw) or plan)
    monkeypatch.setattr(plan_store, "list_sessions", lambda user_id: [])

    def create(user_id, session, *, origin):
        calls["create"].append((session, origin))
        return {**session, "id": str(uuid4()), "origin": origin, "locked": origin == "manual"}

    def update(user_id, session_id, changes, *, by_user):
        calls["update"].append((session_id, changes, by_user))
        if session_id == "00000000-0000-0000-0000-000000000000":
            raise plan_store.SessionNotFound(session_id)
        return {**SESSION, **changes, "id": session_id, "origin": "import", "locked": changes.get("locked", True)}

    monkeypatch.setattr(plan_store, "create_session", create)
    monkeypatch.setattr(plan_store, "update_session", update)
    monkeypatch.setattr(plan_store, "import_sessions", lambda user_id, sessions: calls["import"].append(sessions))
    return calls


@pytest.mark.anyio
async def test_a_session_created_in_the_app_is_manual_and_locked(store):
    out = await routes_plan.create_session(schemas.TrainingSessionIn.model_validate(SESSION), user_id="u")
    assert (out.origin, out.locked) == ("manual", True)
    assert out.id


@pytest.mark.anyio
async def test_a_patch_is_a_user_write_with_only_the_fields_sent(store):
    session_id = uuid4()
    await routes_plan.update_session(session_id, schemas.SessionPatch(date="2026-10-03"), user_id="u")
    assert store["update"] == [(str(session_id), {"date": "2026-10-03"}, True)]


@pytest.mark.anyio
async def test_unlocking_is_a_patch_with_only_locked_false(store):
    out = await routes_plan.update_session(uuid4(), schemas.SessionPatch(locked=False), user_id="u")
    assert out.locked is False


@pytest.mark.anyio
async def test_an_unknown_session_is_a_404(store):
    with pytest.raises(HTTPException) as error:
        await routes_plan.update_session(
            "00000000-0000-0000-0000-000000000000", schemas.SessionPatch(title="x"), user_id="u"
        )
    assert error.value.status_code == 404


def _plan_in(**extra):
    return schemas.PlanIn.model_validate(
        {"yaml_text": "x", "sessions": [SESSION], "imported_at": "now", **extra}
    )


@pytest.mark.anyio
async def test_an_import_replaces_the_sessions(store):
    await routes_plan.save_plan(_plan_in(**{"import": True}), user_id="u")
    assert len(store["import"]) == 1 and store["import"][0][0]["title"] == "Corsa"


@pytest.mark.anyio
async def test_a_legacy_full_plan_write_does_not_touch_the_sessions(store):
    """An old tab still rewrites the whole plan on every edit; it must not reset ids and locks."""
    await routes_plan.save_plan(_plan_in(), user_id="u")
    assert store["import"] == []
    assert len(store["saved"]) == 1


@pytest.mark.anyio
async def test_the_export_is_yaml_the_importer_reads(store, monkeypatch, tmp_path):
    from training_plan.parser import parse_plan_document

    monkeypatch.setattr(plan_store, "list_sessions", lambda user_id: [{**SESSION, "id": str(uuid4()), "origin": "manual", "locked": True}])
    response = await routes_plan.export_plan(user_id="u")
    path = tmp_path / "p.yaml"
    path.write_bytes(response.body)
    assert [s.title for s in parse_plan_document(path).sessions] == ["Corsa"]
    assert "attachment" in response.headers["content-disposition"]


@pytest.mark.anyio
async def test_validate_checks_the_stored_plans_next_weeks(store, monkeypatch):
    from datetime import date, timedelta

    from training_plan import plan_rules

    today = date.today()
    hard = {
        "sport": "running",
        "title": "Ripetute",
        "description": None,
        "steps": [{"reps": 6, "steps": [{"type": "interval", "duration_type": "time", "duration_value": 3}]}],
        "origin": "ai",
        "locked": False,
    }
    stored = [
        {**hard, "id": str(uuid4()), "date": (today + timedelta(days=1)).isoformat()},
        {**hard, "id": str(uuid4()), "date": (today + timedelta(days=2)).isoformat()},
        {**hard, "id": str(uuid4()), "date": (today + timedelta(days=60)).isoformat()},  # outside the window
    ]
    monkeypatch.setattr(plan_store, "list_sessions", lambda user_id: stored)
    monkeypatch.setattr(routes_plan, "_zones", lambda user_id: None)
    monkeypatch.setattr(
        plan_rules,
        "build_context",
        lambda user_id, today, threshold_available: plan_rules.RuleContext(1, None, None, today),
    )

    out = await routes_plan.validate_plan(None, user_id="u")
    in_a_row = next(v for v in out.violations if v.key == "hard_in_a_row")
    assert in_a_row.sessions == [stored[0]["id"], stored[1]["id"]]
    assert out.context.effective_level == 1


@pytest.mark.anyio
async def test_generate_returns_the_window_and_what_was_written(monkeypatch):
    from datetime import date

    from training_plan import plan_generator
    from training_plan.plan_rules import RuleContext
    from training_plan.plan_skeleton import SkeletonInputs, build_skeleton

    today = date(2026, 9, 27)
    window = plan_generator.build_window(
        today=today,
        skeleton=build_skeleton(SkeletonInputs(date(2026, 9, 28), 2, 150.0, 3)),
        context=RuleContext(2, 150.0, 90.0, today),
        stored=[],
        days=[],
        bands=None,
        goal=None,
    )
    sessions = plan_generator.compose_fallback(window)
    written = [{**plan_generator.session_to_dict(s), "id": str(uuid4()), "origin": "ai", "locked": False} for s in sessions]
    seen = {}

    def fake_generate(user_id, today, *, profile, threshold_available, regenerate_skeleton, threshold_hr=None):
        seen.update(profile=profile, threshold=threshold_available, regenerate=regenerate_skeleton)
        return plan_generator.GenerationResult(
            source="regole",
            attempts=0,
            window=window,
            written=written,
            conflicts=[{"date": "2026-10-01", "sport": "running", "title": "Soglia"}],
            fallback_reason="modello non configurato",
            skeleton_regenerated=True,
        )

    monkeypatch.setattr(routes_plan, "coach_state", lambda user_id: None)
    monkeypatch.setattr(plan_generator, "generate", fake_generate)
    out = await routes_plan.generate_plan(None, user_id="u")
    assert out.source == "regole" and out.fallback_reason == "modello non configurato"
    assert (out.start, out.end) == (date(2026, 9, 28), date(2026, 10, 18))
    assert len(out.weeks) == 3 and out.weeks[0].reason
    assert len(out.written) == len(sessions)
    assert out.conflicts[0].title == "Soglia"
    assert seen == {"profile": None, "threshold": False, "regenerate": False}

    def busy(*args, **kwargs):
        raise plan_generator.GenerationInProgress("u")

    monkeypatch.setattr(plan_generator, "generate", busy)
    refused = await routes_plan.generate_plan(None, user_id="u")
    assert refused.status_code == 409
    assert b"aspetta" in refused.body


@pytest.mark.anyio
async def test_skeleton_is_none_until_one_is_stored(monkeypatch):
    from datetime import date

    from training_plan import db
    from training_plan.plan_skeleton import SkeletonInputs, build_skeleton

    monkeypatch.setattr(db, "get_skeleton", lambda user_id: None)
    assert (await routes_plan.get_skeleton(user_id="u")).weeks is None

    weeks = build_skeleton(SkeletonInputs(date(2026, 9, 28), 3, 181.0, 4))
    monkeypatch.setattr(db, "get_skeleton", lambda user_id: {"inputs": {}, "weeks": [w.to_dict() for w in weeks]})
    out = await routes_plan.get_skeleton(user_id="u")
    assert [w.target_minutes for w in out.weeks] == [200, 220, 240]


@pytest.mark.anyio
async def test_move_check_returns_warnings_and_the_adapted_session(monkeypatch):
    from datetime import date, timedelta

    from training_plan import checkin, move_check, plan_rules
    from tests.test_move_check import intervals

    today = date.today()
    a, b = str(uuid4()), str(uuid4())
    stored = [intervals(a, today + timedelta(days=1)), intervals(b, today + timedelta(days=3))]
    monkeypatch.setattr(plan_store, "list_sessions", lambda user_id: stored)
    monkeypatch.setattr(
        plan_rules, "gather_context", lambda user_id, today, threshold_available: (plan_rules.RuleContext(1, 150.0, 90.0, today), [])
    )
    monkeypatch.setattr(checkin, "get_range", lambda user_id, start, end: [])
    monkeypatch.setattr(move_check, "confirmed_fingerprints", lambda user_id: set())
    monkeypatch.setattr(routes_plan, "_zones", lambda user_id: None)

    out = await routes_plan.check_move(
        schemas.MoveCheckRequest(session_id=b, date=today + timedelta(days=2)), user_id="u"
    )
    assert [w.key for w in out.warnings] == ["hard_in_a_row"]
    assert out.warnings[0].fingerprint
    assert out.adapted is not None and out.adapted.date == today + timedelta(days=2)
