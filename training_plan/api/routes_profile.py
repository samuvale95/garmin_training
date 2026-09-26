"""The athlete's level, and the one preference that goes with it.

Computed on read from the stored history (see `levels.py` for the rules). The level only
ever goes up: when the computed level is higher than the stored one it is written back,
never the other way. There is deliberately no endpoint that sets the level -- it is a
claim about the history, so only the history sets it.
"""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool

from .. import history, intensity, levels
from . import schemas
from .auth import current_user_id
from .cache import TTL_PROFILE_LEVEL, cache
from .routes_coach import _zones

router = APIRouter()


def _assess(user_id: str) -> levels.LevelAssessment:
    today = date.today()
    days = [
        levels.DayTraining(**row)
        for row in history.daily_training(
            user_id,
            today - timedelta(days=levels.LOOKBACK_DAYS),
            today,
            running_sports=intensity.RUNNING_SPORTS,
            min_minutes=levels.MIN_SESSION_MINUTES,
        )
    ]
    profile = history.load_profile(user_id)
    assessment = levels.assess(
        days,
        today=today,
        # A Garmin hiccup here only leaves the threshold criterion unmet for one read; a
        # user already at level 3 keeps it through the stored level.
        threshold_available=_zones(user_id) is not None,
        reached_level=profile["reached_level"],
        adaptation_mode=profile["adaptation_mode"],
    )
    if assessment.computed_level > profile["reached_level"]:
        history.raise_reached_level(user_id, assessment.computed_level)
    return assessment


@router.get("/profile/level", response_model=schemas.AthleteLevelResponse)
async def athlete_level(refresh: bool = False, user_id: str = Depends(current_user_id)) -> schemas.AthleteLevelResponse:
    def cached() -> schemas.AthleteLevelResponse:
        key = (date.today(), history.activities_version(user_id))
        return cache.get_or_call(
            "profile:level",
            user_id,
            key,
            TTL_PROFILE_LEVEL,
            lambda: schemas.AthleteLevelResponse.from_model(_assess(user_id)),
            refresh=refresh,
        )

    return await run_in_threadpool(cached)


@router.put("/profile/adaptation-mode", response_model=schemas.AthleteLevelResponse)
async def adaptation_mode(
    payload: schemas.AdaptationModeRequest, user_id: str = Depends(current_user_id)
) -> schemas.AthleteLevelResponse:
    """Stored now, applied once the plan adapts (phase 2). `null` returns to the default."""

    def update() -> schemas.AthleteLevelResponse:
        history.set_adaptation_mode(user_id, payload.mode)
        cache.invalidate(("profile:level",), user_id)
        return schemas.AthleteLevelResponse.from_model(_assess(user_id))

    return await run_in_threadpool(update)
