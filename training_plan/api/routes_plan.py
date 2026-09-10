"""Plan parse/diff/sync endpoints -- thin adapters over `service.py` and `parser.py`.

No business logic lives here: every handler validates/shapes HTTP input, calls the
existing service-layer function on a thread (it's synchronous, blocking I/O), and
shapes the result back to JSON.
"""

from __future__ import annotations

import hashlib
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool

from .. import db, service
from .. import goal_fit, llm
from ..parser import parse_plan_document
from . import garmin_session, schemas
from .auth import current_user_id
from .cache import TTL_GOAL_FIT_NARRATIVE, TTL_PLAN_DIFF, cache
from .jobs import job_store

router = APIRouter()


@router.get("/plan", response_model=schemas.PlanResponse)
async def get_plan(user_id: str = Depends(current_user_id)) -> schemas.PlanResponse:
    plan = await run_in_threadpool(db.get_plan, user_id)
    return schemas.PlanResponse(plan=schemas.PlanOut.from_model(plan) if plan else None)


@router.put("/plan", response_model=schemas.PlanOut)
async def save_plan(payload: schemas.PlanIn, user_id: str = Depends(current_user_id)) -> schemas.PlanOut:
    plan = await run_in_threadpool(
        lambda: db.save_plan(
            user_id=user_id,
            yaml_text=payload.yaml_text,
            sessions=[s.model_dump(mode="json") for s in payload.sessions],
            filename=payload.filename,
            imported_at=payload.imported_at,
            goal=payload.goal.model_dump(mode="json") if payload.goal else None,
        )
    )
    return schemas.PlanOut.from_model(plan)


@router.delete("/plan", response_model=schemas.DeletePlanResponse)
async def delete_plan(user_id: str = Depends(current_user_id)) -> schemas.DeletePlanResponse:
    await run_in_threadpool(db.delete_plan, user_id)
    return schemas.DeletePlanResponse(ok=True)


@router.post("/plan/parse", response_model=schemas.ParsePlanResponse)
async def parse_plan(
    file: UploadFile | None = File(None), yaml_text: str | None = Form(None)
) -> schemas.ParsePlanResponse:
    if file is not None:
        content = (await file.read()).decode("utf-8")
    elif yaml_text is not None:
        content = yaml_text
    else:
        raise HTTPException(status_code=400, detail="Provide either 'file' or 'yaml_text'")

    with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    try:
        # TrainingPlanValidationError propagates to the app-level exception handler.
        parsed = await run_in_threadpool(parse_plan_document, tmp_path)
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    return schemas.ParsePlanResponse(
        sessions=[schemas.TrainingSessionOut.from_model(s) for s in parsed.sessions],
        goal=schemas.RaceGoalOut.from_model(parsed.goal) if parsed.goal else None,
    )


@router.post("/plan/goal-fit", response_model=schemas.GoalFitResponse)
async def plan_goal_fit(
    payload: schemas.GoalFitRequest, user_id: str = Depends(current_user_id)
) -> schemas.GoalFitResponse:
    """Read the sessions already in the plan against the race just named.

    Pure arithmetic over what the client sent -- no Garmin, no database, nothing cached:
    the answer depends only on the request, and the request changes every time the plan
    does.
    """
    fit = await run_in_threadpool(
        goal_fit.assess_plan_fit,
        [s.to_model() for s in payload.sessions],
        payload.goal.to_model(),
        payload.date,
    )
    return schemas.GoalFitResponse.from_model(fit)


@router.post("/plan/goal-fit/narrative", response_model=schemas.NarrativeResponse)
async def plan_goal_fit_narrative(
    payload: schemas.GoalFitRequest, refresh: bool = False, user_id: str = Depends(current_user_id)
) -> schemas.NarrativeResponse:
    """The same reading, phrased. Cached on the conclusion it describes, so the model is
    asked once per plan-and-race rather than once per screen open."""
    goal = payload.goal.to_model()
    sessions = [s.to_model() for s in payload.sessions]
    fit = await run_in_threadpool(goal_fit.assess_plan_fit, sessions, goal, payload.date)

    def compute() -> schemas.NarrativeResponse:
        text = llm.write_goal_fit_narrative(goal_fit.fit_facts(fit, goal))
        if text:
            return schemas.NarrativeResponse(text=text, source="model")
        return schemas.NarrativeResponse(text=fit.headline, source="template")

    key = (
        fit.race_date,
        fit.alignment,
        fit.sessions_ahead,
        tuple(observation.key for observation in fit.observations),
    )
    return await run_in_threadpool(
        lambda: cache.get_or_call("plan:goal-fit-narrative", user_id, key, TTL_GOAL_FIT_NARRATIVE, compute, refresh=refresh)
    )


@router.post("/plan/diff", response_model=schemas.DiffResponse)
async def diff_plan(
    payload: schemas.DiffRequest, refresh: bool = False, user_id: str = Depends(current_user_id)
) -> schemas.DiffResponse:
    sessions = [s.to_model() for s in payload.sessions]
    # Keyed by the exact plan (and by check_content, which changes the answer's depth):
    # Oggi asks for this on every mount, and with check_content it costs one Garmin
    # call per matched session on top of the calendar read.
    key = hashlib.sha1(payload.model_dump_json().encode()).hexdigest()
    diff = await run_in_threadpool(
        lambda: cache.get_or_call(
            "plan:diff",
            user_id,
            key,
            TTL_PLAN_DIFF,
            lambda: garmin_session.run(
                user_id,
                lambda sync: service.preview_plan_sync(
                    sessions, False, payload.check_content, sync=sync
                ).diff,
            ),
            refresh=refresh,
        )
    )
    return schemas.DiffResponse.from_model(diff)


@router.post("/plan/sync", response_model=schemas.StartSyncResponse)
async def start_sync(
    payload: schemas.StartSyncRequest, user_id: str = Depends(current_user_id)
) -> schemas.StartSyncResponse:
    to_create = [s.to_model() for s in payload.to_create]
    changed = [c.to_model() for c in payload.changed]
    job_id = job_store.start(user_id, to_create, changed)
    return schemas.StartSyncResponse(job_id=job_id)


@router.get("/plan/sync/{job_id}", response_model=schemas.SyncJobStatus)
async def get_sync_status(job_id: str, user_id: str = Depends(current_user_id)) -> schemas.SyncJobStatus:
    job = job_store.get(user_id, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown job id")
    return schemas.SyncJobStatus(
        job_id=job.job_id,
        total=job.total,
        completed=job.completed,
        status=job.status,
        cancel_requested=job.cancel_requested,
        items=[
            schemas.SyncItemResult(
                date=item.date,
                sport=item.sport,
                title=item.title,
                kind=item.kind,
                status=item.status,
                error=item.error,
            )
            for item in job.items
        ],
        failure=job.failure,
        failure_category=job.failure_category,
    )


@router.post("/plan/sync/{job_id}/cancel", response_model=schemas.CancelSyncResponse)
async def cancel_sync(job_id: str, user_id: str = Depends(current_user_id)) -> schemas.CancelSyncResponse:
    if not job_store.request_cancel(user_id, job_id):
        raise HTTPException(status_code=404, detail="Unknown job id")
    return schemas.CancelSyncResponse(ok=True)
