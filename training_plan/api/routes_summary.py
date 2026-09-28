"""The weekly summary (see `weekly_summary.py`): read the rows, build, phrase."""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool

from .. import checkin, db, history, intensity, levels, llm, plan_store, weekly_summary
from ..plan_skeleton import SkeletonWeek
from . import schemas
from .auth import current_user_id
from .cache import TTL_SUMMARY_NARRATIVE, cache

router = APIRouter()


def _summary(user_id: str, monday: date | None) -> weekly_summary.WeekSummary:
    today = date.today()
    monday = weekly_summary.monday_of(monday) if monday else weekly_summary.default_monday(today)
    sunday = monday + timedelta(days=6)
    days = [
        levels.DayTraining(**row)
        for row in history.daily_training(
            user_id,
            today - timedelta(weeks=weekly_summary.STREAK_WEEKS + 1),
            today,
            running_sports=intensity.RUNNING_SPORTS,
            min_minutes=levels.MIN_SESSION_MINUTES,
        )
    ]
    stored_skeleton = db.get_skeleton(user_id)
    all_checkins = checkin.get_range(user_id, monday - timedelta(weeks=weekly_summary.STREAK_WEEKS), today)
    return weekly_summary.build_summary(
        monday=monday,
        today=today,
        planned=plan_store.list_sessions(user_id),
        days=days,
        checkins=[c for c in all_checkins if monday <= c.date <= sunday],
        skeleton=[SkeletonWeek.from_dict(w) for w in (stored_skeleton or {}).get("weeks", [])],
        reached_level=history.load_profile(user_id)["reached_level"],
        all_checkins=all_checkins,
    )


@router.get("/summary/week", response_model=schemas.WeekSummaryResponse)
async def week_summary(monday: date | None = None, user_id: str = Depends(current_user_id)) -> schemas.WeekSummaryResponse:
    summary = await run_in_threadpool(_summary, user_id, monday)
    return schemas.WeekSummaryResponse.from_model(summary)


@router.get("/summary/week/narrative", response_model=schemas.NarrativeResponse)
async def week_summary_narrative(
    monday: date | None = None, refresh: bool = False, user_id: str = Depends(current_user_id)
) -> schemas.NarrativeResponse:
    """The week, phrased by the model -- the headline when it is unavailable. Cached on
    the facts, so a new run or check-in gets a new sentence and nothing else does."""
    summary = await run_in_threadpool(_summary, user_id, monday)
    facts = weekly_summary.facts(summary)

    def compute() -> schemas.NarrativeResponse:
        text = llm.write_summary_narrative(facts)
        if text:
            return schemas.NarrativeResponse(text=text, source="model")
        return schemas.NarrativeResponse(text=summary.headline, source="template")

    key = (summary.monday, repr(sorted(facts.items(), key=lambda item: item[0])))
    return await run_in_threadpool(
        lambda: cache.get_or_call("summary:narrative", user_id, key, TTL_SUMMARY_NARRATIVE, compute, refresh=refresh)
    )
