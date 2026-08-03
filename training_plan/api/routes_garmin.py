"""Garmin connection, calendar listing, and deletion endpoints."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from .. import service
from ..garmin_sync import GarminSync, ScheduledWorkout
from . import schemas

router = APIRouter()


@router.post("/garmin/connect", response_model=schemas.ConnectResponse)
async def connect(payload: schemas.ConnectRequest) -> schemas.ConnectResponse:
    # NOTE: full MFA orchestration (a two-step "code sent, submit it" flow) is not
    # wired up yet -- mfa_code is accepted and passed through for accounts where a
    # cached/known code can be supplied up front, but a fresh SMS/app challenge mid
    # -login is not yet round-tripped back to the caller. Tracked as a follow-up.
    prompt_mfa = (lambda: payload.mfa_code) if payload.mfa_code else None
    sync = GarminSync(email=payload.email, password=payload.password, prompt_mfa=prompt_mfa)
    await run_in_threadpool(sync.login)  # raises GarminSyncError/GarminRateLimitError on failure
    return schemas.ConnectResponse(connected=True)


@router.get("/garmin/status", response_model=schemas.GarminStatusResponse)
async def status() -> schemas.GarminStatusResponse:
    result = await run_in_threadpool(lambda: GarminSync().connection_status())
    return schemas.GarminStatusResponse(**result)


@router.get("/garmin/workouts", response_model=schemas.WorkoutsResponse)
async def workouts(start: date, end: date) -> schemas.WorkoutsResponse:
    result = await run_in_threadpool(service.list_workouts, start, end)
    return schemas.WorkoutsResponse(workouts=[schemas.ScheduledWorkoutOut.from_model(w) for w in result])


@router.post("/garmin/deletions/preview", response_model=schemas.DeletionPreviewResponse)
async def deletion_preview(payload: schemas.DeletionPreviewRequest) -> schemas.DeletionPreviewResponse:
    preview = await run_in_threadpool(
        service.preview_deletion, payload.start, payload.end, payload.sport, payload.title_match
    )
    return schemas.DeletionPreviewResponse(
        selected=[schemas.ScheduledWorkoutOut.from_model(w) for w in preview.selected]
    )


@router.post("/garmin/deletions/apply", response_model=schemas.DeletionApplyResponse)
async def deletion_apply(payload: schemas.DeletionApplyRequest) -> schemas.DeletionApplyResponse:
    # A DeletionPreview's authenticated GarminSync can't survive across two separate
    # HTTP requests, so this re-authenticates (cheap: reuses the cached token) and
    # deletes exactly the workouts the client echoes back from its preview response --
    # the same "delete exactly the previewed set" guarantee `service.apply_deletion`
    # provides, just re-expressed across the request boundary.
    def _run() -> list:
        sync = GarminSync()
        sync.login()
        selected = [
            ScheduledWorkout(
                scheduled_workout_id=w.scheduled_workout_id,
                workout_id=w.workout_id,
                date=w.date,
                sport=w.sport,
                title=w.title,
            )
            for w in payload.workouts
        ]
        return sync.delete_all(selected)

    results = await run_in_threadpool(_run)
    return schemas.DeletionApplyResponse(
        results=[
            schemas.DeleteResultOut(
                workout=schemas.ScheduledWorkoutOut.from_model(r.workout), success=r.success, error=r.error
            )
            for r in results
        ]
    )
