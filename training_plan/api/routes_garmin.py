"""Garmin connection, calendar listing, and deletion endpoints."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from .. import service
from ..garmin_sync import GarminSync, ScheduledWorkout
from . import garmin_session, schemas
from .cache import (
    TTL_GARMIN_ACTIVITIES,
    TTL_GARMIN_DEVICE,
    TTL_GARMIN_PROFILE,
    TTL_GARMIN_WORKOUT_SESSION,
    TTL_GARMIN_WORKOUTS,
    cache,
    invalidate_calendar,
)

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
    # This session is authenticated *now*; handing it to the shared holder means the
    # next request reuses it instead of paying for another login.
    garmin_session.adopt(sync)
    cache.clear()  # a different account may be behind this token
    return schemas.ConnectResponse(connected=True)


@router.get("/garmin/status", response_model=schemas.GarminStatusResponse)
async def status() -> schemas.GarminStatusResponse:
    result = await run_in_threadpool(lambda: GarminSync().connection_status())
    return schemas.GarminStatusResponse(**result)


@router.get("/garmin/device", response_model=schemas.DeviceInfoResponse)
async def device(refresh: bool = False) -> schemas.DeviceInfoResponse:
    result = await run_in_threadpool(
        lambda: cache.get_or_call(
            "garmin:device",
            None,
            TTL_GARMIN_DEVICE,
            lambda: garmin_session.run(lambda sync: sync.device_info()),
            refresh=refresh,
        )
    )
    return schemas.DeviceInfoResponse(**result)


@router.get("/garmin/profile", response_model=schemas.AthleteProfileResponse)
async def profile(refresh: bool = False) -> schemas.AthleteProfileResponse:
    result = await run_in_threadpool(
        lambda: cache.get_or_call(
            "garmin:profile",
            None,
            TTL_GARMIN_PROFILE,
            lambda: garmin_session.run(lambda sync: sync.user_profile()),
            refresh=refresh,
        )
    )
    return schemas.AthleteProfileResponse(**result)


@router.post("/garmin/disconnect", response_model=schemas.DisconnectResponse)
async def disconnect() -> schemas.DisconnectResponse:
    await run_in_threadpool(lambda: GarminSync().disconnect())
    # The shared session's token store is gone, and every cached answer belonged to it.
    garmin_session.reset()
    cache.clear()
    return schemas.DisconnectResponse(connected=False)


@router.get("/garmin/workouts", response_model=schemas.WorkoutsResponse)
async def workouts(start: date, end: date, refresh: bool = False) -> schemas.WorkoutsResponse:
    result = await run_in_threadpool(
        lambda: cache.get_or_call(
            "garmin:workouts",
            (start, end),
            TTL_GARMIN_WORKOUTS,
            lambda: garmin_session.run(lambda sync: service.list_workouts(start, end, sync=sync)),
            refresh=refresh,
        )
    )
    return schemas.WorkoutsResponse(workouts=[schemas.ScheduledWorkoutOut.from_model(w) for w in result])


@router.get("/garmin/workouts/{workout_id}/session", response_model=schemas.TrainingSessionOut)
async def workout_session(
    workout_id: int, date: date, sport: str, title: str, refresh: bool = False
) -> schemas.TrainingSessionOut:
    result = await run_in_threadpool(
        lambda: cache.get_or_call(
            "garmin:workout-session",
            (workout_id, date, sport, title),
            TTL_GARMIN_WORKOUT_SESSION,
            lambda: garmin_session.run(
                lambda sync: service.get_workout_session(workout_id, date, sport, title, sync=sync)
            ),
            refresh=refresh,
        )
    )
    return schemas.TrainingSessionOut.from_model(result)


@router.get("/garmin/activities", response_model=schemas.ActivitiesResponse)
async def activities(start: date, end: date, refresh: bool = False) -> schemas.ActivitiesResponse:
    result = await run_in_threadpool(
        lambda: cache.get_or_call(
            "garmin:activities",
            (start, end),
            TTL_GARMIN_ACTIVITIES,
            lambda: garmin_session.run(lambda sync: service.list_activities(start, end, sync=sync)),
            refresh=refresh,
        )
    )
    return schemas.ActivitiesResponse(activities=[schemas.CompletedActivityOut.from_model(a) for a in result])


@router.post("/garmin/deletions/preview", response_model=schemas.DeletionPreviewResponse)
async def deletion_preview(payload: schemas.DeletionPreviewRequest) -> schemas.DeletionPreviewResponse:
    preview = await run_in_threadpool(
        lambda: garmin_session.run(
            lambda sync: service.preview_deletion(
                payload.start, payload.end, payload.sport, payload.title_match, sync=sync
            )
        )
    )
    return schemas.DeletionPreviewResponse(
        selected=[schemas.ScheduledWorkoutOut.from_model(w) for w in preview.selected]
    )


@router.post("/garmin/deletions/apply", response_model=schemas.DeletionApplyResponse)
async def deletion_apply(payload: schemas.DeletionApplyRequest) -> schemas.DeletionApplyResponse:
    # A DeletionPreview's authenticated GarminSync can't survive across two separate
    # HTTP requests, so this uses the shared session and deletes exactly the workouts
    # the client echoes back from its preview response -- the same "delete exactly the
    # previewed set" guarantee `service.apply_deletion` provides, just re-expressed
    # across the request boundary. Not wrapped in `garmin_session.run`: a partially
    # applied deletion must never be replayed automatically.
    def _run() -> list:
        sync = garmin_session.get_sync()
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
    invalidate_calendar()
    return schemas.DeletionApplyResponse(
        results=[
            schemas.DeleteResultOut(
                workout=schemas.ScheduledWorkoutOut.from_model(r.workout), success=r.success, error=r.error
            )
            for r in results
        ]
    )
