"""Plan parse/diff/sync endpoints -- thin adapters over `service.py` and `parser.py`.

No business logic lives here: every handler validates/shapes HTTP input, calls the
existing service-layer function on a thread (it's synchronous, blocking I/O), and
shapes the result back to JSON.
"""

from __future__ import annotations

import hashlib
import tempfile
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.concurrency import run_in_threadpool

from .. import db, plan_store, service
from .. import goal_fit, llm
from ..parser import parse_plan_document, serialize_plan
from . import garmin_session, schemas
from .auth import current_user_id
from .cache import TTL_GOAL_FIT_NARRATIVE, TTL_PLAN_DIFF, cache
from .jobs import job_store

router = APIRouter()


@router.get("/plan", response_model=schemas.PlanResponse)
async def get_plan(user_id: str = Depends(current_user_id)) -> schemas.PlanResponse:
    def read() -> schemas.PlanResponse:
        plan = db.get_plan(user_id)
        if plan is None:
            return schemas.PlanResponse(plan=None)
        return schemas.PlanResponse(plan=schemas.PlanOut.from_model(plan, plan_store.list_sessions(user_id)))

    return await run_in_threadpool(read)


@router.put("/plan", response_model=schemas.PlanOut)
async def save_plan(payload: schemas.PlanIn, user_id: str = Depends(current_user_id)) -> schemas.PlanOut:
    """Import a plan. Sessions are only taken with `import: true` (see `schemas.PlanIn`)."""

    def write() -> schemas.PlanOut:
        plan = db.save_plan(
            user_id=user_id,
            yaml_text=payload.yaml_text,
            filename=payload.filename,
            imported_at=payload.imported_at,
            goal=payload.goal.model_dump(mode="json") if payload.goal else None,
        )
        if payload.is_import:
            plan_store.import_sessions(user_id, [s.model_dump(mode="json") for s in payload.sessions])
        return schemas.PlanOut.from_model(plan, plan_store.list_sessions(user_id))

    return await run_in_threadpool(write)


@router.delete("/plan", response_model=schemas.DeletePlanResponse)
async def delete_plan(user_id: str = Depends(current_user_id)) -> schemas.DeletePlanResponse:
    await run_in_threadpool(db.delete_plan, user_id)
    return schemas.DeletePlanResponse(ok=True)


# ---- one session at a time ---------------------------------------------------------------------
#
# Every write here is the user's, so every write locks the session (see plan_store.py):
# whatever the AI does to the plan afterwards leaves it alone.


def _not_found(session_id: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"Seduta {session_id} non trovata")


@router.post("/plan/sessions", response_model=schemas.TrainingSessionOut)
async def create_session(
    payload: schemas.TrainingSessionIn, user_id: str = Depends(current_user_id)
) -> schemas.TrainingSessionOut:
    def write() -> schemas.TrainingSessionOut:
        db.ensure_plan(user_id)
        created = plan_store.create_session(user_id, payload.model_dump(mode="json"), origin="manual")
        return schemas.TrainingSessionOut.model_validate(created)

    return await run_in_threadpool(write)


@router.patch("/plan/sessions/{session_id}", response_model=schemas.TrainingSessionOut)
async def update_session(
    session_id: UUID, payload: schemas.SessionPatch, user_id: str = Depends(current_user_id)
) -> schemas.TrainingSessionOut:
    def write() -> schemas.TrainingSessionOut:
        try:
            updated = plan_store.update_session(user_id, str(session_id), payload.changes(), by_user=True)
        except plan_store.SessionNotFound:
            raise _not_found(str(session_id))
        return schemas.TrainingSessionOut.model_validate(updated)

    return await run_in_threadpool(write)


@router.delete("/plan/sessions/{session_id}", response_model=schemas.DeletePlanResponse)
async def delete_session(session_id: UUID, user_id: str = Depends(current_user_id)) -> schemas.DeletePlanResponse:
    def write() -> None:
        try:
            plan_store.delete_session(user_id, str(session_id), by_user=True)
        except plan_store.SessionNotFound:
            raise _not_found(str(session_id))

    await run_in_threadpool(write)
    return schemas.DeletePlanResponse(ok=True)


@router.get("/plan/export")
async def export_plan(user_id: str = Depends(current_user_id)) -> Response:
    """The plan as the same YAML the importer reads -- including everything added or
    edited in the app, so the file stays a real way out."""

    def build() -> str:
        plan = db.get_plan(user_id)
        sessions = [schemas.TrainingSessionIn.model_validate(s).to_model() for s in plan_store.list_sessions(user_id)]
        goal = schemas.RaceGoalIn.model_validate(plan.goal).to_model() if plan and plan.goal else None
        return serialize_plan(sessions, goal)

    text = await run_in_threadpool(build)
    return Response(
        content=text,
        media_type="text/yaml; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="piano-passo.yaml"'},
    )


@router.get("/goal", response_model=schemas.GoalResponse)
async def get_goal(user_id: str = Depends(current_user_id)) -> schemas.GoalResponse:
    """The race set before any plan exists to hold it -- a live Garmin-calendar-only
    account's only place to keep one. Once a plan is imported its own `goal` (returned
    by `/plan`, not here) takes over; `save_plan` adopts whatever is stored here into
    that first plan, so this is never the answer for a user who has one."""
    raw = await run_in_threadpool(db.get_standalone_goal, user_id)
    if not raw:
        return schemas.GoalResponse(goal=None)
    goal = schemas.RaceGoalIn.model_validate(raw).to_model()
    return schemas.GoalResponse(goal=schemas.RaceGoalOut.from_model(goal))


@router.put("/goal", response_model=schemas.GoalResponse)
async def set_goal(payload: schemas.SetGoalRequest, user_id: str = Depends(current_user_id)) -> schemas.GoalResponse:
    raw = payload.goal.model_dump(mode="json") if payload.goal else None
    saved = await run_in_threadpool(db.set_standalone_goal, user_id, raw)
    if not saved:
        return schemas.GoalResponse(goal=None)
    goal = schemas.RaceGoalIn.model_validate(saved).to_model()
    return schemas.GoalResponse(goal=schemas.RaceGoalOut.from_model(goal))


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
