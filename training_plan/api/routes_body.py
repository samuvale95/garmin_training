"""Read-only body/wellness endpoints (design screens 11-13)."""

from __future__ import annotations

import logging
from datetime import date, timedelta

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool

from .. import aerobic_efficiency, body_insights, checkin, db, fitness_fatigue, history, llm, models, plan_store, readiness
from . import garmin_session, schemas
from .auth import current_user_id
from .cache import (
    TTL_BODY_LOAD,
    TTL_BODY_METRICS,
    TTL_BODY_TODAY,
    TTL_READINESS_NARRATIVE,
    cache,
)

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
    snapshot = cache.get_or_call(
        "body:today",
        user_id,
        None,
        TTL_BODY_TODAY,
        lambda: garmin_session.run(user_id, lambda sync: body_insights.fetch_body_snapshot(sync=sync)),
        refresh=refresh,
    )
    if snapshot.rhr_norm is None and snapshot.hrv_norm is None:
        rhr_norm, hrv_norm = body_insights.compute_user_biometric_norms(user_id, snapshot.date)
        snapshot.rhr_norm = rhr_norm
        snapshot.hrv_norm = hrv_norm
    return snapshot


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


def _load_user_sessions(user_id: str) -> list[models.TrainingSession]:
    sessions: list[models.TrainingSession] = []
    try:
        raw_list = plan_store.list_sessions(user_id)
        for item in raw_list:
            try:
                sessions.append(schemas.TrainingSessionIn.model_validate(item).to_model())
            except Exception:
                d = item.get("date")
                if isinstance(d, str):
                    d = date.fromisoformat(d)
                if d:
                    sessions.append(
                        models.TrainingSession(
                            date=d,
                            sport=item.get("sport") or "running",
                            title=item.get("title") or "Sessione",
                        )
                    )
    except Exception:
        logger.warning("Could not load plan sessions for user %s", user_id, exc_info=True)
    return sessions


def _load_user_goal(user_id: str) -> models.RaceGoal | None:
    try:
        plan = db.get_plan(user_id)
        if plan and plan.goal:
            return schemas.RaceGoalIn.model_validate(plan.goal).to_model()
    except Exception:
        logger.warning("Could not load goal for user %s", user_id, exc_info=True)
    return None


def _load_user_activities(user_id: str, lookback_days: int = 90) -> list[dict]:
    try:
        today = date.today()
        start = today - timedelta(days=lookback_days)
        return history.activities_between(user_id, start, today)
    except Exception:
        logger.warning("Could not load activities for user %s", user_id, exc_info=True)
        return []


@router.get("/body/fitness-fatigue", response_model=schemas.FitnessFatigueResponse)
async def body_fitness_fatigue(
    lookback_days: int = 60,
    refresh: bool = False,
    user_id: str = Depends(current_user_id),
) -> schemas.FitnessFatigueResponse:
    """Continuous CTL, ATL, and TSB timeline with forward race projection."""
    def compute() -> schemas.FitnessFatigueResponse:
        activities = _load_user_activities(user_id, lookback_days=max(lookback_days, 60))
        sessions = _load_user_sessions(user_id)
        goal = _load_user_goal(user_id)
        today = date.today()
        wellness = history.wellness_between(user_id, today - timedelta(days=7), today)
        rhrs = [w.get("resting_hr") for w in wellness if w.get("resting_hr")]
        resting_hr = round(sum(rhrs) / len(rhrs)) if rhrs else 48

        result = fitness_fatigue.compute_fitness_fatigue_timeline(
            activities=activities,
            planned_sessions=sessions,
            goal=goal,
            today=today,
            lookback_days=lookback_days,
            resting_hr=resting_hr,
        )
        return schemas.FitnessFatigueResponse.from_model(result)

    return await run_in_threadpool(compute)


@router.get("/body/metrics", response_model=schemas.BodyMetricsResponse)
async def body_metrics(refresh: bool = False, user_id: str = Depends(current_user_id)) -> schemas.BodyMetricsResponse:
    if refresh:
        cache.invalidate(["garmin:body_metrics"], user_id)
    metrics = await run_in_threadpool(body_metrics_or_empty, user_id)
    return schemas.BodyMetricsResponse(**metrics)


def _load_ratio_or_none(user_id: str) -> float | None:
    """The acute:chronic ratio, or nothing.

    Its own Garmin read, cached for half an hour like the load screen's -- and wrapped,
    because a verdict about this morning must not fail because a *training-load* call
    did. One missing signal narrows the answer; an exception loses it entirely.
    """
    try:
        snapshot = cache.get_or_call(
            "body:load",
            user_id,
            None,
            TTL_BODY_LOAD,
            lambda: garmin_session.run(user_id, lambda sync: body_insights.fetch_load_snapshot(sync=sync)),
        )
        return snapshot.acute_chronic_ratio
    except Exception:  # noqa: BLE001 - a missing load reading is a narrower verdict, not an error
        logger.warning("load snapshot unavailable for the day verdict, degrading", exc_info=True)
        return None


def _reported_signals(user_id: str, day: date | None) -> list[readiness.Signal]:
    """What the user said in the check-ins of the day and the day before."""
    today = day or date.today()
    try:
        return checkin.signals(checkin.get_range(user_id, today - timedelta(days=1), today), today)
    except Exception:  # noqa: BLE001 - a missing check-in narrows the verdict, never breaks it
        logger.warning("check-ins unavailable for the day verdict, degrading", exc_info=True)
        return []


@router.post("/body/readiness", response_model=schemas.DayVerdictResponse)
async def body_readiness(
    payload: schemas.DayVerdictRequest, user_id: str = Depends(current_user_id)
) -> schemas.DayVerdictResponse:
    """Today's state, and what it means for today's session.

    Every figure in the answer is `readiness.py`'s arithmetic over an already-cached
    snapshot, so this is cheap and is not cached itself: the plan can change under it
    (the session is sent by the client) and a cached verdict would outlive that. The
    sentence a model writes about it is the slow half, and lives at
    `/body/readiness/narrative`.
    """
    snapshot = await run_in_threadpool(_body_snapshot, user_id)
    ratio = await run_in_threadpool(_load_ratio_or_none, user_id)
    reported = await run_in_threadpool(_reported_signals, user_id, payload.date)
    verdict = readiness.assess_day(
        snapshot,
        payload.session.to_model() if payload.session else None,
        acute_chronic_ratio=ratio,
        goal=payload.goal.to_model() if payload.goal else None,
        today=payload.date,
        reported=reported,
    )
    return schemas.DayVerdictResponse.from_model(verdict)


@router.post("/body/readiness/narrative", response_model=schemas.NarrativeResponse)
async def body_readiness_narrative(
    payload: schemas.DayVerdictRequest, refresh: bool = False, user_id: str = Depends(current_user_id)
) -> schemas.NarrativeResponse:
    """The same verdict, phrased -- falling back to its deterministic headline.

    The decision is made before the model is asked (see `readiness.verdict_facts`): it
    phrases a conclusion, it does not reach one. Cached on the verdict itself, so the
    sentence changes exactly when what it describes changes.
    """
    snapshot = await run_in_threadpool(_body_snapshot, user_id)
    ratio = await run_in_threadpool(_load_ratio_or_none, user_id)
    goal = payload.goal.to_model() if payload.goal else None
    reported = await run_in_threadpool(_reported_signals, user_id, payload.date)
    verdict = readiness.assess_day(
        snapshot,
        payload.session.to_model() if payload.session else None,
        acute_chronic_ratio=ratio,
        goal=goal,
        today=payload.date,
        reported=reported,
    )

    def compute() -> schemas.NarrativeResponse:
        text = llm.write_readiness_narrative(readiness.verdict_facts(verdict, goal))
        if text:
            return schemas.NarrativeResponse(text=text, source="model")
        return schemas.NarrativeResponse(text=verdict.headline, source="template")

    key = (
        verdict.date,
        verdict.state,
        verdict.action,
        verdict.session_title,
        tuple(signal.key for signal in verdict.signals),
    )
    return await run_in_threadpool(
        lambda: cache.get_or_call("body:readiness-narrative", user_id, key, TTL_READINESS_NARRATIVE, compute, refresh=refresh)
    )


@router.post("/body/conflict", response_model=schemas.ConflictResponse)
async def body_conflict(
    payload: schemas.ConflictRequest, user_id: str = Depends(current_user_id)
) -> schemas.ConflictResponse:
    snapshot = await run_in_threadpool(_body_snapshot, user_id)
    next_session = payload.next_session.to_model() if payload.next_session else None
    assessment = body_insights.assess_conflict(snapshot, next_session)
    return schemas.ConflictResponse.from_model(assessment)


@router.get("/body/aerobic-efficiency", response_model=schemas.AerobicEfficiencyResponse)
async def body_aerobic_efficiency(
    lookback_days: int = 90,
    user_id: str = Depends(current_user_id),
) -> schemas.AerobicEfficiencyResponse:
    """Efficiency Factor trend and Cardiac Decoupling on easy runs.

    Reads stored activity streams (HR and velocity) and computes:
    - EF (speed / HR) for every qualifying easy run
    - Cardiac decoupling (first half vs second half EF) for runs >= 45 min
    - Linear trend over the lookback window
    """
    from .. import intensity
    from .routes_coach import _zones

    def compute() -> schemas.AerobicEfficiencyResponse:
        zones = _zones(user_id)
        if zones is None:
            return schemas.AerobicEfficiencyResponse()

        result = aerobic_efficiency.compute_aerobic_efficiency(
            user_id=user_id,
            lookback_days=lookback_days,
            zones=zones,
        )
        return schemas.AerobicEfficiencyResponse.from_model(result)

    return await run_in_threadpool(compute)
