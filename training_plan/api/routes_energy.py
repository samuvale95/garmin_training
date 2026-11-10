"""Every activity and the day's energy (see `energy.py`): stored history plus Garmin."""

from __future__ import annotations

import logging
import time
from dataclasses import asdict
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool

from .. import db, energy, history
from . import garmin_session, schemas
from .auth import current_user_id
from .cache import TTL_GARMIN_DAY_ENERGY, TTL_PAST_RANGE, cache
from .routes_nutrition import _resolve_profile, _resolve_weight

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_RANGE_DAYS = 62


class _NoGarminDay(Exception):
    """Raised out of the cached read so a failure is not stored."""


def garmin_day(user_id: str, day: date) -> energy.GarminDay | None:
    """Garmin's calories and steps for a day, cached; None when Garmin has none or fails."""

    def read() -> energy.GarminDay:
        stats = garmin_session.run(user_id, lambda sync: sync.client.get_stats(day.isoformat()))
        if not isinstance(stats, dict) or not stats.get("totalKilocalories"):
            raise _NoGarminDay
        return energy.GarminDay(
            total_kcal=stats.get("totalKilocalories"),
            active_kcal=stats.get("activeKilocalories"),
            bmr_kcal=stats.get("bmrKilocalories"),
            steps=stats.get("totalSteps"),
        )

    ttl = TTL_GARMIN_DAY_ENERGY if day >= date.today() else TTL_PAST_RANGE
    try:
        return cache.get_or_call("garmin:day-energy", user_id, day, ttl, read)
    except _NoGarminDay:
        return None
    except Exception:  # noqa: BLE001 - no Garmin day is the estimate, not an error
        logger.warning("garmin day energy unavailable, using the estimate", exc_info=True)
        return None


def _weight(user_id: str) -> float:
    from ..nutrition import REFERENCE_WEIGHT_KG

    weight, _ = _resolve_weight(user_id, None)
    return weight or REFERENCE_WEIGHT_KG


@router.get("/activities", response_model=schemas.ActivitiesListResponse)
async def list_activities(
    start: date = Query(...), end: date = Query(...), user_id: str = Depends(current_user_id)
) -> schemas.ActivitiesListResponse:
    """Every workout in the range, from the stored history: all sports, Garmin and
    Strava-only, a copy counted once, with calories and where they come from."""
    if end < start or (end - start).days > MAX_RANGE_DAYS:
        raise HTTPException(status_code=422, detail="Intervallo non valido")

    def run() -> schemas.ActivitiesListResponse:
        weight = _weight(user_id)
        rows = history.activities_between(user_id, start, end)
        return schemas.ActivitiesListResponse(
            activities=[
                schemas.StoredActivityOut(
                    activity_id=row["activity_id"], day=row["day"], **asdict(energy.activity_energy(row, weight))
                )
                for row in rows
            ]
        )

    return await run_in_threadpool(run)


@router.post("/activities/manual", response_model=schemas.ManualActivityResponse)
async def create_manual_activity(
    payload: schemas.ManualActivityIn, user_id: str = Depends(current_user_id)
) -> schemas.ManualActivityResponse:
    """Record an unclocked / manual workout (e.g. soccer, beach volley, gym) to give context."""

    def run() -> schemas.ManualActivityResponse:
        weight = _weight(user_id)
        activity_id = int(time.time() * 1000000) % 9000000000000000
        family = history.sport_family(payload.sport)
        base_rate = energy.KCAL_PER_KG_PER_HOUR.get(family, energy.DEFAULT_KCAL_PER_KG_PER_HOUR)
        rpe_mult = max(0.5, min(1.5, 0.6 + 0.08 * (payload.rpe or 6)))
        kcal = round(base_rate * rpe_mult * weight * (payload.duration_min / 60.0))
        start_time = datetime.combine(payload.day, datetime.min.time().replace(hour=18))

        row_values = {
            "sport": payload.sport,
            "title": payload.title.strip() or energy.FAMILY_LABELS.get(family, family).capitalize(),
            "distance_km": payload.distance_km,
            "duration_min": payload.duration_min,
            "calories": kcal,
            "calories_source": "manual",
            "start_time": start_time,
            "summary": {"rpe": payload.rpe, "notes": payload.notes, "manual": True},
        }

        history.save_activity(user_id, "manual", activity_id, payload.day, row_values)
        saved_row = {"activity_id": activity_id, "day": payload.day, **row_values}
        act_energy = energy.activity_energy(saved_row, weight)
        out = schemas.StoredActivityOut(
            activity_id=activity_id,
            day=payload.day,
            title=act_energy.title,
            sport=act_energy.sport,
            family=act_energy.family,
            label=act_energy.label,
            start_time=act_energy.start_time,
            minutes=act_energy.minutes,
            distance_km=act_energy.distance_km,
            kcal=act_energy.kcal,
            source="manual",
        )
        return schemas.ManualActivityResponse(activity=out)

    return await run_in_threadpool(run)


@router.delete("/activities/manual/{activity_id}", response_model=schemas.DeletePlanResponse)
async def delete_manual_activity_endpoint(
    activity_id: int, user_id: str = Depends(current_user_id)
) -> schemas.DeletePlanResponse:
    """Delete a manually entered activity."""

    def run() -> schemas.DeletePlanResponse:
        deleted = history.delete_manual_activity(user_id, activity_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Attività manuale non trovata")
        return schemas.DeletePlanResponse(deleted=True)

    return await run_in_threadpool(run)


@router.get("/energy/day", response_model=schemas.DayEnergyResponse)
async def day_energy(day: date | None = None, user_id: str = Depends(current_user_id)) -> schemas.DayEnergyResponse:
    target = day or date.today()

    def run() -> schemas.DayEnergyResponse:
        from ..nutrition import basal_metabolic_rate

        weight = _weight(user_id)
        totals = db.totals_for_date(user_id, target.isoformat())
        result = energy.day_energy(
            day=target,
            activities=history.activities_between(user_id, target, target),
            weight_kg=weight,
            bmr_kcal=basal_metabolic_rate(weight, _resolve_profile(user_id)),
            garmin=garmin_day(user_id, target),
            intake_kcal=totals.get("kcal") or 0.0,
            entries=totals.get("entries") or 0,
            now=datetime.now(),
        )
        return schemas.DayEnergyResponse.from_model(result)

    return await run_in_threadpool(run)
