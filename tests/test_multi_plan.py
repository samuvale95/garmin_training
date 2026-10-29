from datetime import date
from uuid import uuid4

import pytest

from training_plan import db, plan_store
from training_plan.api import routes_plan, schemas


@pytest.fixture(autouse=True)
def clean_db():
    db.ensure_schema()
    plan_store.ensure_schema()
    yield


@pytest.mark.anyio
async def test_multi_plan_creation_and_listing():
    user_id = f"test-multi-{uuid4().hex[:8]}"

    # 1. Save default running plan
    p1 = await routes_plan.save_plan(
        schemas.PlanIn(
            yaml_text="",
            sessions=[
                schemas.TrainingSessionIn(
                    date=date(2026, 11, 2),
                    sport="running",
                    title="Lungo 15km",
                    steps=[],
                )
            ],
            imported_at="2026-10-28T10:00:00Z",
            is_import=True,
            plan_id="default",
            plan_name="Maratona Autunno",
            sports=["running"],
            mode="replace",
        ),
        user_id=user_id,
    )
    assert p1.id == "default"
    assert p1.name == "Maratona Autunno"

    # 2. Save a second distinct strength plan
    p2 = await routes_plan.save_plan(
        schemas.PlanIn(
            yaml_text="",
            sessions=[
                schemas.TrainingSessionIn(
                    date=date(2026, 11, 3),
                    sport="strength_training",
                    title="Potenziamento Gambe e Core",
                    steps=[],
                )
            ],
            imported_at="2026-10-28T10:05:00Z",
            is_import=True,
            plan_id="piano-forza",
            plan_name="Programma Forza",
            sports=["strength_training"],
            mode="new_plan",
        ),
        user_id=user_id,
    )
    assert p2.id == "piano-forza"

    # 3. List plans
    plans_res = await routes_plan.list_user_plans(user_id=user_id)
    plan_ids = [p.id for p in plans_res.plans]
    assert "default" in plan_ids
    assert "piano-forza" in plan_ids

    # Both plans are active simultaneously
    assert "default" in plans_res.active_plan_ids
    assert "piano-forza" in plans_res.active_plan_ids

    # 4. Toggle active status of strength plan
    toggle_res = await routes_plan.toggle_plan_active(
        "piano-forza",
        schemas.PlanToggleActiveRequest(is_active=False),
        user_id=user_id,
    )
    assert toggle_res.plan.is_active is False

    plans_res_after = await routes_plan.list_user_plans(user_id=user_id)
    assert "piano-forza" not in plans_res_after.active_plan_ids

    # 5. Clean up
    await routes_plan.delete_plan_by_id("piano-forza", user_id=user_id)
    await routes_plan.delete_plan_by_id("default", user_id=user_id)


@pytest.mark.anyio
async def test_merge_mode_preserves_other_sports():
    user_id = f"test-merge-{uuid4().hex[:8]}"

    # Initial plan with running on Monday
    await routes_plan.save_plan(
        schemas.PlanIn(
            yaml_text="",
            sessions=[
                schemas.TrainingSessionIn(
                    date=date(2026, 11, 2),
                    sport="running",
                    title="Corsa Lenta",
                    steps=[],
                )
            ],
            imported_at="2026-10-28T10:00:00Z",
            is_import=True,
            plan_id="default",
            mode="replace",
        ),
        user_id=user_id,
    )

    # Merge import with cycling on Wednesday
    await routes_plan.save_plan(
        schemas.PlanIn(
            yaml_text="",
            sessions=[
                schemas.TrainingSessionIn(
                    date=date(2026, 11, 4),
                    sport="cycling",
                    title="Bici Z2",
                    steps=[],
                )
            ],
            imported_at="2026-10-28T10:10:00Z",
            is_import=True,
            plan_id="default",
            mode="merge",
        ),
        user_id=user_id,
    )

    # Check that both running on Monday and cycling on Wednesday exist!
    sessions = plan_store.list_sessions(user_id, plan_id="default")
    sports = {s["sport"] for s in sessions}
    assert "running" in sports
    assert "cycling" in sports
    assert len(sessions) == 2

    # Clean up
    db.delete_plan(user_id)
