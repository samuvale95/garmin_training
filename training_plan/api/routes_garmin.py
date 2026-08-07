"""Garmin connection, calendar listing, and deletion endpoints."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool

from .. import service
from ..garmin_sync import ScheduledWorkout
from .auth import current_user_id
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
async def connect(
    payload: schemas.ConnectRequest, user_id: str = Depends(current_user_id)
) -> schemas.ConnectResponse:
    # NOTE: full MFA orchestration (a two-step "code sent, submit it" flow) is not
    # wired up yet -- mfa_code is accepted and passed through for accounts where a
    # cached/known code can be supplied up front, but a fresh SMS/app challenge mid
    # -login is not yet round-tripped back to the caller. Tracked as a follow-up.
    prompt_mfa = (lambda: payload.mfa_code) if payload.mfa_code else None
    await run_in_threadpool(garmin_session.connect, user_id, payload.email, payload.password, prompt_mfa)
    cache.invalidate_user(user_id)  # a different account may be behind this token
    return schemas.ConnectResponse(connected=True)


@router.get("/garmin/status", response_model=schemas.GarminStatusResponse)
async def status(user_id: str = Depends(current_user_id)) -> schemas.GarminStatusResponse:
    result = await run_in_threadpool(garmin_session.status, user_id)
    return schemas.GarminStatusResponse(**result)


@router.get("/garmin/device", response_model=schemas.DeviceInfoResponse)
async def device(refresh: bool = False, user_id: str = Depends(current_user_id)) -> schemas.DeviceInfoResponse:
    result = await run_in_threadpool(
        lambda: cache.get_or_call(
            "garmin:device",
            user_id,
            None,
            TTL_GARMIN_DEVICE,
            lambda: garmin_session.run(user_id, lambda sync: sync.device_info()),
            refresh=refresh,
        )
    )
    return schemas.DeviceInfoResponse(**result)


@router.get("/garmin/profile", response_model=schemas.AthleteProfileResponse)
async def profile(
    refresh: bool = False, user_id: str = Depends(current_user_id)
) -> schemas.AthleteProfileResponse:
    result = await run_in_threadpool(
        lambda: cache.get_or_call(
            "garmin:profile",
            user_id,
            None,
            TTL_GARMIN_PROFILE,
            lambda: garmin_session.run(user_id, lambda sync: sync.user_profile()),
            refresh=refresh,
        )
    )
    return schemas.AthleteProfileResponse(**result)


@router.post("/garmin/disconnect", response_model=schemas.DisconnectResponse)
async def disconnect(user_id: str = Depends(current_user_id)) -> schemas.DisconnectResponse:
    await run_in_threadpool(garmin_session.disconnect, user_id)
    cache.invalidate_user(user_id)
    return schemas.DisconnectResponse(connected=False)


@router.get("/garmin/workouts", response_model=schemas.WorkoutsResponse)
async def workouts(
    start: date, end: date, refresh: bool = False, user_id: str = Depends(current_user_id)
) -> schemas.WorkoutsResponse:
    result = await run_in_threadpool(
        lambda: cache.get_or_call(
            "garmin:workouts",
            user_id,
            (start, end),
            TTL_GARMIN_WORKOUTS,
            lambda: garmin_session.run(user_id, lambda sync: service.list_workouts(start, end, sync=sync)),
            refresh=refresh,
        )
    )
    return schemas.WorkoutsResponse(workouts=[schemas.ScheduledWorkoutOut.from_model(w) for w in result])


@router.get("/garmin/workouts/{workout_id}/session", response_model=schemas.TrainingSessionOut)
async def workout_session(
    workout_id: int,
    date: date,
    sport: str,
    title: str,
    refresh: bool = False,
    user_id: str = Depends(current_user_id),
) -> schemas.TrainingSessionOut:
    result = await run_in_threadpool(
        lambda: cache.get_or_call(
            "garmin:workout-session",
            user_id,
            (workout_id, date, sport, title),
            TTL_GARMIN_WORKOUT_SESSION,
            lambda: garmin_session.run(
                user_id, lambda sync: service.get_workout_session(workout_id, date, sport, title, sync=sync)
            ),
            refresh=refresh,
        )
    )
    return schemas.TrainingSessionOut.from_model(result)


@router.get("/garmin/activities", response_model=schemas.ActivitiesResponse)
async def activities(
    start: date, end: date, refresh: bool = False, user_id: str = Depends(current_user_id)
) -> schemas.ActivitiesResponse:
    result = await run_in_threadpool(
        lambda: cache.get_or_call(
            "garmin:activities",
            user_id,
            (start, end),
            TTL_GARMIN_ACTIVITIES,
            lambda: garmin_session.run(user_id, lambda sync: service.list_activities(start, end, sync=sync)),
            refresh=refresh,
        )
    )
    return schemas.ActivitiesResponse(activities=[schemas.CompletedActivityOut.from_model(a) for a in result])


@router.post("/garmin/deletions/preview", response_model=schemas.DeletionPreviewResponse)
async def deletion_preview(
    payload: schemas.DeletionPreviewRequest, user_id: str = Depends(current_user_id)
) -> schemas.DeletionPreviewResponse:
    preview = await run_in_threadpool(
        lambda: garmin_session.run(
            user_id,
            lambda sync: service.preview_deletion(
                payload.start, payload.end, payload.sport, payload.title_match, sync=sync
            ),
        )
    )
    return schemas.DeletionPreviewResponse(
        selected=[schemas.ScheduledWorkoutOut.from_model(w) for w in preview.selected]
    )


@router.post("/garmin/deletions/apply", response_model=schemas.DeletionApplyResponse)
async def deletion_apply(
    payload: schemas.DeletionApplyRequest, user_id: str = Depends(current_user_id)
) -> schemas.DeletionApplyResponse:
    def _run(sync) -> list:
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

    results = await run_in_threadpool(lambda: garmin_session.run(user_id, _run))
    invalidate_calendar(user_id)
    return schemas.DeletionApplyResponse(
        results=[
            schemas.DeleteResultOut(
                workout=schemas.ScheduledWorkoutOut.from_model(r.workout), success=r.success, error=r.error
            )
            for r in results
        ]
    )
