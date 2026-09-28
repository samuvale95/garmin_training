"""The 10-second check-in (see `checkin.py`): store and read, nothing else."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool

from .. import checkin
from . import schemas
from .auth import current_user_id

router = APIRouter()

# A range is for a screen: a week, a month. Bounded so one request cannot read years.
MAX_RANGE_DAYS = 400


def _out(item: checkin.CheckIn) -> schemas.CheckInOut:
    return schemas.CheckInOut(date=item.date, effort=item.effort, body=item.body, pain_area=item.pain_area)


@router.get("/checkins", response_model=schemas.CheckInsResponse)
async def list_checkins(
    start: date = Query(...), end: date = Query(...), user_id: str = Depends(current_user_id)
) -> schemas.CheckInsResponse:
    if end < start or (end - start).days > MAX_RANGE_DAYS:
        raise HTTPException(status_code=422, detail="Intervallo non valido")
    items = await run_in_threadpool(checkin.get_range, user_id, start, end)
    return schemas.CheckInsResponse(checkins=[_out(item) for item in items])


@router.put("/checkins/{day}", response_model=schemas.CheckInOut)
async def save_checkin(
    day: date, payload: schemas.CheckInIn, user_id: str = Depends(current_user_id)
) -> schemas.CheckInOut:
    item = checkin.CheckIn(date=day, body=payload.body, effort=payload.effort, pain_area=payload.pain_area)
    try:
        saved = await run_in_threadpool(lambda: checkin.save(user_id, item, today=date.today()))
    except checkin.InvalidCheckIn as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return _out(saved)


@router.delete("/checkins/{day}", response_model=schemas.DeletePlanResponse)
async def delete_checkin(day: date, user_id: str = Depends(current_user_id)) -> schemas.DeletePlanResponse:
    await run_in_threadpool(checkin.delete, user_id, day)
    return schemas.DeletePlanResponse(ok=True)
