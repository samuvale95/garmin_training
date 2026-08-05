"""Strava connection, activity-match, and shoe-wear endpoints.

Thin adapters over `strava_sync.py`, following the same pattern as
`routes_garmin.py`: each handler builds a fresh `StravaSync()` and runs its
(synchronous, blocking-I/O) call on a thread.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from ..strava_sync import StravaSync
from . import schemas

router = APIRouter()


@router.get("/strava/authorize", response_model=schemas.StravaAuthorizeResponse)
async def authorize() -> schemas.StravaAuthorizeResponse:
    url = await run_in_threadpool(lambda: StravaSync().authorize_url())
    return schemas.StravaAuthorizeResponse(authorize_url=url)


@router.post("/strava/connect", response_model=schemas.StravaConnectResponse)
async def connect(payload: schemas.StravaConnectRequest) -> schemas.StravaConnectResponse:
    await run_in_threadpool(StravaSync().exchange_code, payload.code)
    return schemas.StravaConnectResponse(connected=True)


@router.get("/strava/status", response_model=schemas.StravaStatusResponse)
async def status() -> schemas.StravaStatusResponse:
    result = await run_in_threadpool(lambda: StravaSync().connection_status())
    return schemas.StravaStatusResponse(**result)


@router.post("/strava/disconnect", response_model=schemas.StravaDisconnectResponse)
async def disconnect() -> schemas.StravaDisconnectResponse:
    await run_in_threadpool(lambda: StravaSync().disconnect())
    return schemas.StravaDisconnectResponse(connected=False)


@router.post("/strava/activity-match", response_model=schemas.StravaActivityMatchResponse)
async def activity_match(payload: schemas.StravaActivityMatchRequest) -> schemas.StravaActivityMatchResponse:
    session = payload.session.to_model()
    result = await run_in_threadpool(lambda: StravaSync().find_activity_match(session))
    return schemas.StravaActivityMatchResponse(**result)


@router.get("/strava/shoes", response_model=schemas.ShoesResponse)
async def shoes() -> schemas.ShoesResponse:
    result = await run_in_threadpool(lambda: StravaSync().shoe_wear())
    return schemas.ShoesResponse(shoes=[schemas.ShoeOut(**s) for s in result])


@router.post("/strava/shoes/{gear_id}/retire", response_model=schemas.RetireShoeResponse)
async def retire_shoe(gear_id: str) -> schemas.RetireShoeResponse:
    await run_in_threadpool(StravaSync().retire_shoe, gear_id)
    return schemas.RetireShoeResponse(id=gear_id, retired=True)
