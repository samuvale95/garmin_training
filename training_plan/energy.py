"""The day's energy at 360°: every activity, Garmin's own figures, our estimate, the food.

Food targets used to see only the planned run. This reads the whole day: every activity
from any source (Garmin, Strava, recorded on another device), the calories Garmin
measured for each one and for the day, an estimate built from resting metabolism,
activities and steps, and what was logged to eat. Each figure says where it comes from,
because a number whose source is hidden is one the user cannot judge.

Two rules decided with the user:

- **Garmin's day total is trusted when there is one** (measured from heart rate and steps
  over the whole day); the estimate stands in when it is missing and is shown next to it
  otherwise, so the two can be compared.
- **Level 1 sees words, not kilocalories**: counting calories is the opposite of the
  habit level 1 is building.

And the frame is `nutrition.py`'s: refuelling, never restriction. The balance can say "you
are short, eat", never "you are over".
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date as date_type
from datetime import datetime
from typing import Sequence

from .history import sport_family

# Gross cost per kg per hour by sport family (MET-style), for activities no source gave
# calories for. Middle-of-the-range values: a Strava-only swim or ride is an estimate and
# is labelled as one.
KCAL_PER_KG_PER_HOUR = {
    "run": 10.0,
    "ride": 7.5,
    "swim": 8.0,
    "hike": 6.0,
    "walk": 3.5,
    "strength": 5.0,
    "ski": 6.5,
    "tennis": 7.0,
    "climb": 7.0,
    "paddle": 5.0,
    "sail": 3.0,
    "soccer": 8.0,
}
DEFAULT_KCAL_PER_KG_PER_HOUR = 5.0

# Families that draw on glycogen the way the carbohydrate ranges assume.
ENDURANCE_FAMILIES = ("run", "ride", "swim", "hike", "ski", "paddle", "tennis", "soccer")

FAMILY_LABELS = {
    "run": "corsa",
    "ride": "bici",
    "swim": "nuoto",
    "hike": "escursione",
    "walk": "camminata",
    "strength": "forza",
    "ski": "sci",
    "tennis": "tennis",
    "climb": "arrampicata",
    "paddle": "paddle",
    "sail": "vela",
    "soccer": "calcio",
}

# Everyday movement from steps, per kg per step (about 0.04 kcal a step at 70 kg).
KCAL_PER_KG_PER_STEP = 0.00055
# Steps an activity itself contributes per minute, to avoid counting them twice.
STEPS_PER_MINUTE = {"run": 165, "walk": 110, "hike": 100}
# Resting metabolism when neither Garmin nor a profile gives one: kcal per kg per day.
FALLBACK_BMR_PER_KG = 22.0

# A day with at least this much activity is a training day.
TRAINING_MINUTES = 20
# Food logged under this share of what was spent, on a training day, is worth a word.
REFUEL_SHARE = 0.7
# Before this hour, today's food is simply not eaten yet.
REFUEL_HOUR = 18


@dataclass
class ActivityEnergy:
    title: str
    sport: str | None
    family: str
    label: str
    start_time: datetime | None
    minutes: float
    distance_km: float | None
    kcal: int
    source: str  # garmin | strava | stima


@dataclass
class GarminDay:
    total_kcal: float | None
    active_kcal: float | None
    bmr_kcal: float | None
    steps: int | None


@dataclass
class DayEnergy:
    date: date_type
    activities: list[ActivityEnergy] = field(default_factory=list)
    activities_kcal: int = 0
    garmin_total_kcal: int | None = None
    garmin_active_kcal: int | None = None
    garmin_bmr_kcal: int | None = None
    steps: int | None = None
    estimate_kcal: int = 0
    estimate_bmr_kcal: int = 0
    estimate_steps_kcal: int = 0
    spent_kcal: int = 0
    spent_source: str = "stima"  # garmin | stima
    intake_kcal: int = 0
    entries: int = 0
    training_day: bool = False
    missing_kcal: int | None = None
    message: str = ""
    # The same, without numbers, for level 1.
    words: str = ""


def activity_energy(row: dict, weight_kg: float) -> ActivityEnergy:
    family = sport_family(row.get("sport"))
    minutes = float(row.get("duration_min") or 0.0)
    if row.get("calories"):
        kcal, source = float(row["calories"]), row.get("calories_source") or "garmin"
    else:
        rate = KCAL_PER_KG_PER_HOUR.get(family, DEFAULT_KCAL_PER_KG_PER_HOUR)
        kcal, source = rate * weight_kg * minutes / 60, "stima"
    return ActivityEnergy(
        title=row.get("title") or FAMILY_LABELS.get(family, family).capitalize(),
        sport=row.get("sport"),
        family=family,
        label=FAMILY_LABELS.get(family, family),
        start_time=row.get("start_time"),
        minutes=round(minutes),
        distance_km=row.get("distance_km"),
        kcal=round(kcal),
        source=source,
    )


def endurance_minutes(rows: Sequence[dict]) -> float:
    """Minutes of the day that draw on glycogen: what sizes the carbohydrate load."""
    return sum(float(r.get("duration_min") or 0.0) for r in rows if sport_family(r.get("sport")) in ENDURANCE_FAMILIES)


def day_energy(
    *,
    day: date_type,
    activities: Sequence[dict],
    weight_kg: float,
    bmr_kcal: float | None,
    garmin: GarminDay | None,
    intake_kcal: float,
    entries: int,
    now: datetime,
) -> DayEnergy:
    """The day's energy from every source. Pure."""
    acts = [activity_energy(row, weight_kg) for row in activities]
    activities_kcal = sum(a.kcal for a in acts)

    rest = bmr_kcal or (garmin.bmr_kcal if garmin and garmin.bmr_kcal else None) or FALLBACK_BMR_PER_KG * weight_kg
    steps = garmin.steps if garmin else None
    activity_steps = sum(a.minutes * STEPS_PER_MINUTE.get(a.family, 0) for a in acts)
    steps_kcal = max(0.0, (steps or 0) - activity_steps) * KCAL_PER_KG_PER_STEP * weight_kg
    # An activity's calories include the resting metabolism of its minutes, which `rest`
    # already counts for the whole day: taken out once so it is not counted twice.
    active_minutes = sum(a.minutes for a in acts)
    estimate = rest + activities_kcal - rest * active_minutes / 1440 + steps_kcal

    out = DayEnergy(
        date=day,
        activities=acts,
        activities_kcal=activities_kcal,
        steps=steps,
        estimate_kcal=round(estimate),
        estimate_bmr_kcal=round(rest),
        estimate_steps_kcal=round(steps_kcal),
        intake_kcal=round(intake_kcal),
        entries=entries,
        training_day=sum(a.minutes for a in acts) >= TRAINING_MINUTES,
    )
    if garmin and garmin.total_kcal:
        out.garmin_total_kcal = round(garmin.total_kcal)
        out.garmin_active_kcal = round(garmin.active_kcal) if garmin.active_kcal is not None else None
        out.garmin_bmr_kcal = round(garmin.bmr_kcal) if garmin.bmr_kcal is not None else None
        out.spent_kcal, out.spent_source = out.garmin_total_kcal, "garmin"
    else:
        out.spent_kcal, out.spent_source = out.estimate_kcal, "stima"

    in_progress = day == now.date() and now.hour < REFUEL_HOUR
    if out.training_day and entries and not in_progress and out.intake_kcal < out.spent_kcal * REFUEL_SHARE:
        out.missing_kcal = out.spent_kcal - out.intake_kcal
    out.message, out.words = _sentences(out, day == now.date())
    return out


def _sentences(e: DayEnergy, today: bool) -> tuple[str, str]:
    """(with numbers, without numbers)."""
    when = "oggi" if today else "quel giorno"
    if not e.activities:
        return (
            f"Giornata senza allenamenti: {when} hai speso circa {e.spent_kcal} kcal.",
            "Giornata di riposo: mangia come sempre, il recupero è parte dell'allenamento.",
        )
    what = ", ".join(f"{a.label} {a.minutes}'" for a in e.activities)
    if e.missing_kcal:
        return (
            f"{what.capitalize()}: {when} hai speso {e.spent_kcal} kcal e ne hai registrate {e.intake_kcal}. "
            f"Mancano circa {e.missing_kcal} kcal per ricaricare.",
            "Hai speso molto più di quanto hai mangiato: ricarica, soprattutto con carboidrati.",
        )
    if not e.entries:
        return (
            f"{what.capitalize()}: {when} hai speso circa {e.spent_kcal} kcal.",
            "Giornata di allenamento: mangia con calma e abbondante per recuperare.",
        )
    return (
        f"{what.capitalize()}: {e.spent_kcal} kcal spese, {e.intake_kcal} registrate.",
        "Stai mangiando in linea con quanto hai speso.",
    )
