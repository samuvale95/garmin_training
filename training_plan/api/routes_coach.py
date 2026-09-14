"""Technique endpoints: what a finished activity says about how it was done.

Thin adapters over `technique.py`, same as every other route module here -- the bands
and the verdicts live there, the Garmin calls live in `garmin_session`, and the sentence
a coach would say over the top lives in `llm.py`.

Both answers are cached: an activity that has already happened cannot change, so the
only thing a second request buys is a second pair of Garmin calls. The narrative is
cached harder still, because it is the one that costs money.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool

from .. import llm, technique
from . import garmin_session, schemas
from .auth import current_user_id
from .cache import TTL_COACH_NARRATIVE, TTL_COACH_TECHNIQUE, TTL_COACH_TREND, cache

logger = logging.getLogger(__name__)

router = APIRouter()


def _form(user_id: str, activity_id: int, refresh: bool = False) -> technique.ActivityForm:
    return cache.get_or_call(
        "coach:technique",
        user_id,
        activity_id,
        TTL_COACH_TECHNIQUE,
        lambda: garmin_session.run(user_id, lambda sync: technique.fetch_activity_form(activity_id, sync)),
        refresh=refresh,
    )


@router.get("/coach/technique/{activity_id}", response_model=schemas.ActivityFormResponse)
async def coach_technique(
    activity_id: int, refresh: bool = False, user_id: str = Depends(current_user_id)
) -> schemas.ActivityFormResponse:
    form = await run_in_threadpool(_form, user_id, activity_id, refresh)
    return schemas.ActivityFormResponse.from_model(form)


@router.get("/coach/technique/{activity_id}/narrative", response_model=schemas.NarrativeResponse)
async def coach_technique_narrative(
    activity_id: int, refresh: bool = False, user_id: str = Depends(current_user_id)
) -> schemas.NarrativeResponse:
    """The same read, phrased -- falling back to its deterministic headline.

    The verdicts are decided before the model is asked (see `technique.coach_facts`): it
    phrases a conclusion, it does not reach one.
    """
    form = await run_in_threadpool(_form, user_id, activity_id)

    def compute() -> schemas.NarrativeResponse:
        text = llm.write_coach_narrative(technique.coach_facts(form))
        if text:
            return schemas.NarrativeResponse(text=text, source="model")
        fallback = f"{form.headline}. {form.focus}" if form.focus else form.headline
        return schemas.NarrativeResponse(text=fallback, source="template")

    return await run_in_threadpool(
        lambda: cache.get_or_call("coach:narrative", user_id, activity_id, TTL_COACH_NARRATIVE, compute, refresh=refresh)
    )


@router.post("/coach/trend", response_model=schemas.CoachTrendResponse)
async def coach_trend(
    payload: schemas.CoachTrendRequest, refresh: bool = False, user_id: str = Depends(current_user_id)
) -> schemas.CoachTrendResponse:
    """The same metrics, followed across recent sessions of one sport.

    Reads several activities behind one request, so it is the expensive endpoint here --
    but every activity it touches lands in the same per-activity cache
    `/coach/technique/{id}` fills, so opening a single session afterwards is free, and
    so is coming back to this one.
    """

    def compute() -> schemas.CoachTrendResponse:
        forms = garmin_session.run(user_id, lambda sync: technique.fetch_trend(payload.activity_ids, sync))
        # Seed the per-activity cache with what this already paid for. Without it the
        # claim above is false: tapping a session right after viewing the trend would
        # re-read the very activity that was just fetched.
        for form in forms:
            cache.put("coach:technique", user_id, form.activity_id, TTL_COACH_TECHNIQUE, form)
        return schemas.CoachTrendResponse(
            sessions_read=len(forms),
            trends=[schemas.MetricTrendOut.from_model(t) for t in technique.build_trends(forms)],
        )

    key = tuple(payload.activity_ids[: technique.MAX_TREND_ACTIVITIES])
    return await run_in_threadpool(
        lambda: cache.get_or_call("coach:trend", user_id, key, TTL_COACH_TREND, compute, refresh=refresh)
    )
