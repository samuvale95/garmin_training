"""Read-only body/wellness endpoints (design screens 11-13)."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from .. import body_insights
from . import schemas

router = APIRouter()


@router.get("/body/today", response_model=schemas.BodySnapshotResponse)
async def body_today() -> schemas.BodySnapshotResponse:
    snapshot = await run_in_threadpool(body_insights.fetch_body_snapshot)
    return schemas.BodySnapshotResponse.from_model(snapshot)


@router.get("/body/load", response_model=schemas.LoadSnapshotResponse)
async def body_load() -> schemas.LoadSnapshotResponse:
    snapshot = await run_in_threadpool(body_insights.fetch_load_snapshot)
    return schemas.LoadSnapshotResponse.from_model(snapshot)


@router.post("/body/conflict", response_model=schemas.ConflictResponse)
async def body_conflict(payload: schemas.ConflictRequest) -> schemas.ConflictResponse:
    snapshot = await run_in_threadpool(body_insights.fetch_body_snapshot)
    next_session = payload.next_session.to_model() if payload.next_session else None
    assessment = body_insights.assess_conflict(snapshot, next_session)
    return schemas.ConflictResponse.from_model(assessment)
