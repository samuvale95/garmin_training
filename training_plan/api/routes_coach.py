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
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from fastapi.concurrency import run_in_threadpool

from .. import history, intensity, llm, nutrition, paces, prescription, technique
from . import garmin_session, routes_strava, schemas
from .auth import current_user_id
from .cache import (
    TTL_COACH_EXECUTION,
    TTL_COACH_NARRATIVE,
    TTL_COACH_PLAN,
    TTL_COACH_TECHNIQUE,
    TTL_COACH_TREND,
    cache,
)

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


# ---- planned against executed ----------------------------------------------------------


def _zones(user_id: str) -> intensity.Zones | None:
    """The athlete's own zone boundaries, or nothing.

    Nothing is a supported answer and the screen says so: zones guessed from an age
    formula would carry an error wider than the bands they define, so this module would
    rather show no analysis than a confident wrong one.
    """
    threshold = garmin_session.run(user_id, lambda sync: sync.lactate_threshold())
    heart_rate = threshold.get("threshold_hr")
    if not heart_rate:
        return None
    return intensity.Zones.from_threshold(heart_rate, source="garmin")


@router.post("/coach/execution", response_model=schemas.ExecutionBlockResponse)
async def coach_execution(
    payload: schemas.ExecutionRequest, refresh: bool = False, user_id: str = Depends(current_user_id)
) -> schemas.ExecutionBlockResponse:
    """What the plan asked for, against what the streams say happened.

    The one screen in this app that can catch a mistake the athlete is certain they are
    not making -- easy days run too hard -- because it is the only one that reads the
    session second by second instead of through an average.

    The plan travels in the request, as it does for `/nutrition/targets` and
    `/body/readiness`: it lives on the device and the server holds no copy.
    """

    def compute() -> schemas.ExecutionBlockResponse:
        zones = _zones(user_id)
        if zones is None:
            return schemas.ExecutionBlockResponse(zones=None, block=None, sessions=[])

        sessions = [s.to_model() for s in payload.sessions]
        if not sessions:
            return schemas.ExecutionBlockResponse(zones=None, block=None, sessions=[])

        # The stored history first. Before it existed this endpoint matched against
        # Strava live and fetched a stream per session on every single view -- dozens of
        # third-party calls to redraw a screen about sessions that finished weeks ago.
        # Now the backfill has already paid for all of it, and a miss falls back to the
        # network only for the sessions the job has not reached yet.
        stored = {
            row["day"]: row
            for row in history.activities_between(
                user_id, min(s.date for s in sessions), max(s.date for s in sessions)
            )
        }

        executions = []
        for session in sessions:
            activity_id = None
            row = stored.get(session.date)
            if row:
                activity_id = int(row["activity_id"])
                streams = history.load_workout_streams(user_id, row["source"], activity_id) or {}
            else:
                streams = {}

            if not streams.get("heartrate"):
                match = routes_strava._run(
                    user_id, lambda sync: sync.find_activity_matches_for_range([session])
                )
                activity = (match.get(session.date.isoformat()) or {}).get("activity") or {}
                if not activity.get("id"):
                    continue
                activity_id = int(activity["id"])
                streams = routes_strava._run(user_id, lambda sync: sync.get_activity_streams(activity_id))

            heart_rates = streams.get("heartrate")
            if not heart_rates or activity_id is None:
                continue

            execution = intensity.read_execution(
                activity_id=activity_id,
                day=session.date,
                title=session.title,
                # The same load vocabulary the fuelling module already classifies by, so
                # "easy" means one thing across the app rather than three.
                intent=nutrition.classify_load(session),
                heart_rates=heart_rates,
                times=streams.get("time"),
                zones=zones,
            )
            if execution is not None:
                executions.append(execution)

        return schemas.ExecutionBlockResponse.from_models(zones, intensity.read_block(executions), executions)

    key = (payload.date_key(), len(payload.sessions))
    return await run_in_threadpool(
        lambda: cache.get_or_call("coach:execution", user_id, key, TTL_COACH_EXECUTION, compute, refresh=refresh)
    )


# ---- the coach plan ------------------------------------------------------------------------

# How far back the diagnosis looks. Long enough for a distribution to be a habit rather
# than a phase, short enough to still describe the athlete as they are now.
PLAN_LOOKBACK_DAYS = 365


class _NoZones(Exception):
    """No threshold to anchor on -- raised out of the cached computation so it is not stored."""


@router.get("/coach/plan", response_model=schemas.CoachPlanResponse)
async def coach_plan(
    # Bounded: every distinct value is its own cache entry and its own full read of the
    # history, and nothing on the screen asks for more than two years.
    days: int = Query(PLAN_LOOKBACK_DAYS, ge=28, le=730),
    refresh: bool = False,
    user_id: str = Depends(current_user_id),
) -> schemas.CoachPlanResponse:
    """How this athlete actually trains, and the sessions that would change it.

    Reads the stored history and nothing else -- no imported plan required, which is the
    point: the diagnosis is about what was *done*, and the plan file only ever says what
    was intended. It was the missing piece that made the execution screen unusable for
    an account training off the Garmin calendar.
    """

    def compute() -> schemas.CoachPlanResponse:
        zones = _zones(user_id)
        if zones is None:
            raise _NoZones

        today = date.today()
        executions: list[intensity.SessionExecution] = []
        histogram: dict[int, float] = {}
        samples: list[tuple[float | None, float | None]] = []

        # Running only, filtered in SQL: the zones are anchored on a running threshold,
        # so every other sport would be decoded here only to be dropped by `read_block`.
        for row, streams in history.streams_between(
            user_id, today - timedelta(days=days), today, intensity.RUNNING_SPORTS
        ):
            if not streams.get("heartrate"):
                continue

            execution = intensity.read_execution(
                activity_id=int(row["activity_id"]),
                day=row["day"],
                title=row["title"] or "Seduta",
                # Without an imported plan there is no stated intent, and inventing one
                # would be the app marking its own homework. The block still answers
                # "quanto del tuo tempo è davvero facile", which is a question about time
                # and needs no intent -- but no session is judged against a plan it never had.
                intent=intensity.NO_INTENT,
                sport=row["sport"],
                heart_rates=streams["heartrate"],
                times=streams.get("time"),
                zones=zones,
            )
            if execution is None:
                continue
            executions.append(execution)
            histogram = intensity.merge_histograms(
                [histogram, intensity.heart_rate_histogram(streams["heartrate"], streams.get("time"))]
            )
            samples.extend(
                paces.samples_from_streams(streams, near=(zones.aerobic_hr, zones.threshold_hr))
            )

        block = intensity.read_block(executions)
        if block is None:
            return schemas.CoachPlanResponse(zones=schemas.ZonesOut.from_model(zones))

        profile = paces.build_profile(samples, aerobic_hr=zones.aerobic_hr, threshold_hr=zones.threshold_hr)
        plan = prescription.CoachPlan(
            zones=zones,
            block=block,
            profile=profile,
            prescriptions=prescription.prescribe(block, zones, profile, today=today),
            sensitivity=intensity.threshold_sensitivity(histogram, zones.threshold_hr),
        )
        return schemas.CoachPlanResponse.from_model(plan)

    def cached() -> schemas.CoachPlanResponse:
        # Keyed on the stored streams as well as the range, so a run that syncs shows up
        # on the next view rather than whenever the TTL happens to lapse.
        key = (days, history.streams_version(user_id))
        return cache.get_or_call("coach:plan", user_id, key, TTL_COACH_PLAN, compute, refresh=refresh)

    try:
        return await run_in_threadpool(cached)
    except _NoZones:
        # Not cached: `lactate_threshold` degrades a timeout or a rate limit to "no
        # estimate", and caching that would hide real zones for the whole TTL.
        return schemas.CoachPlanResponse(zones=None)
