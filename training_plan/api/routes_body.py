"""Read-only body/wellness endpoints (design screens 11-13)."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool

from .. import body_insights
from . import garmin_session, schemas
from .auth import current_user_id
from .cache import TTL_BODY_LOAD, TTL_BODY_METRICS, TTL_BODY_TODAY, cache

logger = logging.getLogger(__name__)

router = APIRouter()


def body_metrics_or_empty(user_id: str) -> dict:
    """Garmin's view of the user's body -- weight, height, age -- cached, degrading to
    an empty dict.

    Shared with the fuelling routes, which scale their targets by the weight. Unlike
    every other endpoint in this module, a missing Garmin session here is a *supported*
    state rather than a 401: the nutrition screen falls back to a reference weight and
    says so, and the settings screen offers to take the weight by hand.
    """
    try:
        return cache.get_or_call(
            "garmin:body_metrics",
            user_id,
            None,
            TTL_BODY_METRICS,
            lambda: garmin_session.run(user_id, lambda sync: sync.body_metrics()),
        )
    except Exception:  # noqa: BLE001 - no Garmin is a supported state, not an error
        logger.warning("body metrics unavailable, degrading to no weight", exc_info=True)
        return {}


def _body_snapshot(user_id: str, refresh: bool = False) -> body_insights.BodySnapshot:
    """Today's snapshot, computed at most once per TTL.

    Eleven Garmin calls sit behind this, and both `/body/today` and `/body/conflict`
    need exactly the same answer -- the conflict endpoint used to recompute the whole
    thing, doubling the cost of the Oggi screen for data Garmin only updates overnight.
    """
    return cache.get_or_call(
        "body:today",
        user_id,
        None,
        TTL_BODY_TODAY,
        lambda: garmin_session.run(user_id, lambda sync: body_insights.fetch_body_snapshot(sync=sync)),
        refresh=refresh,
    )


@router.get("/body/today", response_model=schemas.BodySnapshotResponse)
async def body_today(refresh: bool = False, user_id: str = Depends(current_user_id)) -> schemas.BodySnapshotResponse:
    snapshot = await run_in_threadpool(_body_snapshot, user_id, refresh)
    return schemas.BodySnapshotResponse.from_model(snapshot)


@router.get("/body/load", response_model=schemas.LoadSnapshotResponse)
async def body_load(refresh: bool = False, user_id: str = Depends(current_user_id)) -> schemas.LoadSnapshotResponse:
    snapshot = await run_in_threadpool(
        lambda: cache.get_or_call(
            "body:load",
            user_id,
            None,
            TTL_BODY_LOAD,
            lambda: garmin_session.run(user_id, lambda sync: body_insights.fetch_load_snapshot(sync=sync)),
            refresh=refresh,
        )
    )
    return schemas.LoadSnapshotResponse.from_model(snapshot)


@router.get("/body/metrics", response_model=schemas.BodyMetricsResponse)
async def body_metrics(refresh: bool = False, user_id: str = Depends(current_user_id)) -> schemas.BodyMetricsResponse:
    if refresh:
        cache.invalidate(["garmin:body_metrics"], user_id)
    metrics = await run_in_threadpool(body_metrics_or_empty, user_id)
    return schemas.BodyMetricsResponse(**metrics)


@router.post("/body/conflict", response_model=schemas.ConflictResponse)
async def body_conflict(
    payload: schemas.ConflictRequest, user_id: str = Depends(current_user_id)
) -> schemas.ConflictResponse:
    snapshot = await run_in_threadpool(_body_snapshot, user_id)
    next_session = payload.next_session.to_model() if payload.next_session else None
    assessment = body_insights.assess_conflict(snapshot, next_session)
    return schemas.ConflictResponse.from_model(assessment)
