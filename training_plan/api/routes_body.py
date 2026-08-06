"""Read-only body/wellness endpoints (design screens 11-13)."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from .. import body_insights
from . import garmin_session, schemas
from .cache import TTL_BODY_LOAD, TTL_BODY_TODAY, cache

router = APIRouter()


def _body_snapshot(refresh: bool = False) -> body_insights.BodySnapshot:
    """Today's snapshot, computed at most once per TTL.

    Eleven Garmin calls sit behind this, and both `/body/today` and `/body/conflict`
    need exactly the same answer -- the conflict endpoint used to recompute the whole
    thing, doubling the cost of the Oggi screen for data Garmin only updates overnight.
    """
    return cache.get_or_call(
        "body:today",
        None,
        TTL_BODY_TODAY,
        lambda: garmin_session.run(lambda sync: body_insights.fetch_body_snapshot(sync=sync)),
        refresh=refresh,
    )


@router.get("/body/today", response_model=schemas.BodySnapshotResponse)
async def body_today(refresh: bool = False) -> schemas.BodySnapshotResponse:
    snapshot = await run_in_threadpool(_body_snapshot, refresh)
    return schemas.BodySnapshotResponse.from_model(snapshot)


@router.get("/body/load", response_model=schemas.LoadSnapshotResponse)
async def body_load(refresh: bool = False) -> schemas.LoadSnapshotResponse:
    snapshot = await run_in_threadpool(
        lambda: cache.get_or_call(
            "body:load",
            None,
            TTL_BODY_LOAD,
            lambda: garmin_session.run(lambda sync: body_insights.fetch_load_snapshot(sync=sync)),
            refresh=refresh,
        )
    )
    return schemas.LoadSnapshotResponse.from_model(snapshot)


@router.post("/body/conflict", response_model=schemas.ConflictResponse)
async def body_conflict(payload: schemas.ConflictRequest) -> schemas.ConflictResponse:
    snapshot = await run_in_threadpool(_body_snapshot)
    next_session = payload.next_session.to_model() if payload.next_session else None
    assessment = body_insights.assess_conflict(snapshot, next_session)
    return schemas.ConflictResponse.from_model(assessment)
