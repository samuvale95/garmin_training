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
