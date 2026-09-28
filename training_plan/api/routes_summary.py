"""The weekly summary (see `weekly_summary.py`): read the rows, build, phrase."""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool

from .. import checkin, db, history, intensity, levels, llm, nutrition, plan_store, weekly_summary
from ..plan_skeleton import SkeletonWeek
from . import schemas
from .auth import current_user_id
from .cache import TTL_SUMMARY_NARRATIVE, cache

router = APIRouter()


def _food(user_id: str, monday: date, sunday: date, planned: list[dict]) -> tuple[int, list[date]]:
    """Days with food logged, and days under the carbohydrate range before a hard day."""
    from ..plan_generator import session_from_dict
    from .routes_nutrition import _resolve_weight

    totals = {row["date"]: row for row in db.totals_between(user_id, monday, sunday) if row["entries"]}
    if not totals:
        return 0, []
    sessions = [session_from_dict(s) for s in planned]
    weight, source = _resolve_weight(user_id, None)
    short = []
    for day, row in totals.items():
        day = day if isinstance(day, date) else date.fromisoformat(str(day))
        fuelling = nutrition.daily_fuelling(day, sessions, weight_kg=weight, weight_source=source)
        target = fuelling.today.carb_g
        if (
            target
            and fuelling.tomorrow.load in ("duro", "molto_lungo")
            and row["carb_g"] < target[0] * (1 - nutrition.COMPLIANCE_TOLERANCE)
        ):
            short.append(day)
    return len(totals), short


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
    planned = plan_store.list_sessions(user_id)
    food_days, carb_short = _food(user_id, monday, sunday, planned)
    all_checkins = checkin.get_range(user_id, monday - timedelta(weeks=weekly_summary.STREAK_WEEKS), today)
    return weekly_summary.build_summary(
        monday=monday,
        today=today,
        planned=planned,
        days=days,
        checkins=[c for c in all_checkins if monday <= c.date <= sunday],
        skeleton=[SkeletonWeek.from_dict(w) for w in (stored_skeleton or {}).get("weeks", [])],
        reached_level=history.load_profile(user_id)["reached_level"],
        all_checkins=all_checkins,
        food_days=food_days,
        carb_short_days=carb_short,
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
