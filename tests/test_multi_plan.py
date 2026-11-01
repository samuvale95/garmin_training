"""Whole-plan writes are refused on purpose.

Multiple programs are created and changed through drafts (Piano → Programmi), where a
change can be reviewed before it lands; the old `PUT /plan`, which overwrote a plan in
one go, is kept only to answer old clients with a clear 409. The two tests this file
held exercised that old path and were replaced by this one.
"""

import json
from datetime import date
from uuid import uuid4

import pytest

from training_plan import db, plan_store
from training_plan.api import routes_plan, schemas


@pytest.mark.anyio
async def test_a_whole_plan_write_is_refused_and_changes_nothing():
    db.ensure_schema()
    plan_store.ensure_schema()
    user_id = f"test-multi-{uuid4().hex[:8]}"
    response = await routes_plan.save_plan(
        schemas.PlanIn(
            yaml_text="",
            sessions=[schemas.TrainingSessionIn(date=date(2026, 11, 2), sport="running", title="Lungo", steps=[])],
            imported_at="2026-10-28T10:00:00Z",
            is_import=True,
            plan_id="default",
            plan_name="Maratona",
            sports=["running"],
            mode="replace",
        ),
        user_id=user_id,
    )
    assert response.status_code == 409
    assert json.loads(response.body)["category"] == "validation_failed"
    assert plan_store.list_sessions(user_id) == []
