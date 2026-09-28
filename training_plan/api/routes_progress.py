"""Progress (see `progress.py`): streak, Disciplina points, badges, mascot."""

from __future__ import annotations

from dataclasses import asdict
from datetime import date, timedelta

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool

from .. import checkin, history, intensity, levels, plan_store, progress
from . import schemas
from .auth import current_user_id

router = APIRouter()


def _progress(user_id: str) -> schemas.ProgressResponse:
    today = date.today()
    start = today - timedelta(weeks=progress.WEEKS + 1)
    days = [
        levels.DayTraining(**row)
        for row in history.daily_training(
            user_id, start, today, running_sports=intensity.RUNNING_SPORTS, min_minutes=levels.MIN_SESSION_MINUTES
        )
    ]
    # The stored level: it only goes up, and every reader that computes the context
    # (limits, move warnings) raises it -- no Garmin call for a progress screen.
    level = history.load_profile(user_id)["reached_level"]
    result = progress.build_progress(
        today=today,
        days=days,
        planned=plan_store.list_sessions(user_id),
        checkins=checkin.get_range(user_id, start, today),
        reached_level=level,
    )
    return schemas.ProgressResponse(
        streak=result.streak,
        tokens=result.tokens,
        max_tokens=progress.MAX_TOKENS,
        week_points=result.week_points,
        week_lines=[schemas.PointLineOut(**asdict(line)) for line in result.week_lines],
        total_points=result.total_points,
        badges=[schemas.BadgeOut(**asdict(badge)) for badge in result.badges],
        mascot=schemas.MascotOut(**asdict(result.mascot)),
        level=level,
        level_name=levels.LEVEL_NAMES[level],
    )


@router.get("/progress", response_model=schemas.ProgressResponse)
async def get_progress(user_id: str = Depends(current_user_id)) -> schemas.ProgressResponse:
    return await run_in_threadpool(_progress, user_id)
