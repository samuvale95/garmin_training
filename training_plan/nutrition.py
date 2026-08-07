"""Carbohydrate and protein availability matched to the training load of a day.

Pure arithmetic over the plan's own sessions: no I/O, no Garmin, no model. Every number
this module produces is a published consensus range multiplied by a body weight, which
means the user can redo it by hand -- the same discipline `goal.py` will need and the
reason none of it is asked of an LLM.

Three things are deliberately *not* here, and their absence is the design:

- **No calorie budget, no deficit, no weight target.** The frame is fuelling, never
  restriction. Exceeding a carbohydrate range is not an error state; missing one before
  a hard session is the only thing worth flagging.
- **No claim to precision.** The ranges are wide because the science is wide. A single
  number would imply a confidence nobody has.
- **No judgement of what was eaten.** The module answers "how much fuel does tomorrow
  ask for", not "was that lunch a good idea".

Ranges follow the standard endurance-nutrition consensus (Burke et al., and what every
sports-nutrition body has published for two decades): carbohydrate scaled to the day's
training, protein flat across the day.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date as date_type
from datetime import timedelta
from typing import Literal

from .models import (
    TrainingSession,
    avg_pace_sec_per_km,
    flatten_steps,
    session_duration_minutes,
    session_fallback_pace,
)

# How hard a day asks the body to work, in the only granularity the carbohydrate ranges
# actually distinguish. Not the same axis as `sessionVisuals.ts`'s `SessionKind`, which
# classifies a session by *shape* (ripetute / lungo / forza) to pick a colour: a 40-minute
# interval session and a three-hour long run are different cards there and different
# fuelling days here, but the two taxonomies answer different questions and are kept apart
# on purpose.
SessionLoad = Literal["riposo", "facile", "moderato", "duro", "molto_lungo"]

# Grams of carbohydrate per kg of body weight, per day, by the load of the session being
# fuelled for.
CARB_G_PER_KG: dict[SessionLoad, tuple[float, float]] = {
    "riposo": (3.0, 5.0),
    "facile": (3.0, 5.0),
    "moderato": (5.0, 7.0),
    "duro": (7.0, 10.0),
    "molto_lungo": (10.0, 12.0),
}

# Flat across every day: protein supports repair, and repair happens on the rest day too.
PROTEIN_G_PER_KG = (1.6, 2.0)

# Flat across every day too, for the same reason: fat is not periodized around a
# session the way carbohydrate is. The range is the standard endurance-athlete floor
# (essential fatty acids, hormone production) up to a share that still leaves room for
# the carbohydrate a hard day needs.
FAT_G_PER_KG = (0.8, 1.2)

# The weight the ranges are shown against when no real one is available. Never presented
# silently -- `DailyFuelling.weight_source` is "reference" and the UI must say so.
REFERENCE_WEIGHT_KG = 70.0

# A step counts as quality work when its pace is at least this much faster than the
# slowest pace the session itself names. Below this, a "faster" step is warmup drift
# rather than a workout: 20 s/km is roughly the gap between an easy pace and a steady
# one, and comfortably inside the tolerance a plan writes paces with.
QUALITY_PACE_DELTA_SEC_PER_KM = 20.0

# A quality session shorter than this is a strides day or a short tune-up -- real work,
# but not enough of it to move the day's carbohydrate need.
MIN_QUALITY_MINUTES = 30.0

# Minutes above which an otherwise-easy session is "long" -- the plan's "hard *or* long,
# 1-3 h" row -- and above which it is very long.
LONG_MINUTES = 90.0
VERY_LONG_MINUTES = 180.0

# Sports that do not deplete glycogen the way running does. Strength work is real
# training and gets protein, but a 70-minute gym session is not a 70-minute tempo run
# and must not be fuelled like one.
LOW_GLYCOGEN_SPORTS = ("strength_training", "other")


@dataclass
class DayTarget:
    """What one calendar day asks for, and why."""

    date: date_type
    session_title: str | None
    load: SessionLoad
    duration_minutes: float | None
    carb_g_per_kg: tuple[float, float]
    protein_g_per_kg: tuple[float, float]
    fat_g_per_kg: tuple[float, float]
    # Absolute grams, or None when there is no weight to multiply by -- the caller
    # decides whether to fall back to REFERENCE_WEIGHT_KG and say so.
    carb_g: tuple[int, int] | None
    protein_g: tuple[int, int] | None
    fat_g: tuple[int, int] | None


@dataclass
class DailyFuelling:
    date: date_type
    weight_kg: float | None
    # Where `weight_kg` came from: a smart scale, the Garmin profile field, typed in by
    # the user, or REFERENCE_WEIGHT_KG standing in for all three.
    weight_source: Literal["scale", "profile", "manual", "reference"] | None
    today: DayTarget
    tomorrow: DayTarget
    # The deterministic sentence. Always present: the screen never depends on a model
    # being reachable, so this is what it renders and a narrative only replaces it.
    advice: str


def has_quality_work(session: TrainingSession) -> bool:
    """True when the session contains work meaningfully faster than its own easy pace.

    Reads paces rather than step *types* on purpose. A plan writes "interval" for the
    working part of every session, including the 40-minute steady run that is one long
    `interval` step at easy pace -- classifying on the type alone would make every
    session a hard one.
    """
    steps = flatten_steps(session.steps)
    paced = [s for s in steps if s.target_pace]
    if not paced:
        return False
    slowest = session_fallback_pace(steps)
    fastest = min(avg_pace_sec_per_km(s.target_pace) for s in paced)
    return (slowest - fastest) >= QUALITY_PACE_DELTA_SEC_PER_KM


def classify_load(session: TrainingSession | None) -> SessionLoad:
    """The fuelling load of a single session, from its own steps.

    A heuristic, and it should be read as one: the file format carries no intensity
    field, so duration and the spread of the paces are all there is to go on. It is
    good enough to choose between two adjacent consensus ranges, which is all it is
    asked to do.
    """
    if session is None:
        return "riposo"

    minutes = session_duration_minutes(session)
    if minutes <= 0:
        # A session with no step detail at all -- a workout read straight off the Garmin
        # calendar, say. Something is planned, so it is not a rest day, but there is
        # nothing to size it by.
        return "facile"

    if session.sport in LOW_GLYCOGEN_SPORTS:
        return "moderato" if minutes >= LONG_MINUTES else "facile"

    if minutes > VERY_LONG_MINUTES:
        return "molto_lungo"
    if minutes >= LONG_MINUTES:
        return "duro"
    if has_quality_work(session) and minutes >= MIN_QUALITY_MINUTES:
        return "duro"
    if minutes >= 60:
        return "moderato"
    return "facile"


def _bump(load: SessionLoad) -> SessionLoad:
    order: list[SessionLoad] = ["riposo", "facile", "moderato", "duro", "molto_lungo"]
    return order[min(order.index(load) + 1, len(order) - 1)]


def _grams(per_kg: tuple[float, float], weight_kg: float | None) -> tuple[int, int] | None:
    if weight_kg is None:
        return None
    return (round(per_kg[0] * weight_kg), round(per_kg[1] * weight_kg))


def day_target(
    day: date_type,
    session: TrainingSession | None,
    weight_kg: float | None,
    *,
    load_override: SessionLoad | None = None,
) -> DayTarget:
    load = load_override or classify_load(session)
    carb = CARB_G_PER_KG[load]
    return DayTarget(
        date=day,
        session_title=session.title if session else None,
        load=load,
        duration_minutes=round(session_duration_minutes(session), 1) if session else None,
        carb_g_per_kg=carb,
        protein_g_per_kg=PROTEIN_G_PER_KG,
        fat_g_per_kg=FAT_G_PER_KG,
        carb_g=_grams(carb, weight_kg),
        protein_g=_grams(PROTEIN_G_PER_KG, weight_kg),
        fat_g=_grams(FAT_G_PER_KG, weight_kg),
    )


def _session_on(sessions: list[TrainingSession], day: date_type) -> TrainingSession | None:
    """The day's session, or None for a rest day.

    A rest day is the *absence* of an entry -- the file format has no "rest" session
    type -- so a missing plan and a planned rest day are indistinguishable here. The
    caller knows which it has; see `DailyFuelling.weight_source`'s equivalent problem.
    """
    for session in sessions:
        if session.date == day:
            return session
    return None


def daily_fuelling(
    day: date_type,
    sessions: list[TrainingSession],
    weight_kg: float | None = None,
    weight_source: Literal["scale", "profile", "manual", "reference"] | None = None,
) -> DailyFuelling:
    """Today's and tomorrow's targets plus the sentence that explains them.

    Tomorrow is the one that matters: glycogen is loaded the day before, not the morning
    of, which is why the screen leads with it.
    """
    if weight_kg is None:
        weight_kg, weight_source = REFERENCE_WEIGHT_KG, "reference"

    tomorrow = day + timedelta(days=1)
    today_session = _session_on(sessions, day)
    tomorrow_session = _session_on(sessions, tomorrow)
    day_after_load = classify_load(_session_on(sessions, tomorrow + timedelta(days=1)))

    tomorrow_load = classify_load(tomorrow_session)
    # Back-to-back hard days are the case the flat table misses: the second one starts
    # from a tank the first one emptied, so the day before them both carries more.
    if tomorrow_load in ("duro", "molto_lungo") and day_after_load in ("duro", "molto_lungo"):
        tomorrow_load = _bump(tomorrow_load)

    today_target = day_target(day, today_session, weight_kg)
    tomorrow_target = day_target(tomorrow, tomorrow_session, weight_kg, load_override=tomorrow_load)

    return DailyFuelling(
        date=day,
        weight_kg=round(weight_kg, 1),
        weight_source=weight_source,
        today=today_target,
        tomorrow=tomorrow_target,
        advice=templated_advice(today_target, tomorrow_target),
    )


def _session_phrase(target: DayTarget) -> str:
    """"domani il lungo" out of a session title, without repeating the word twice."""
    title = (target.session_title or "").strip().lower()
    return title or "un allenamento"


def templated_advice(today: DayTarget, tomorrow: DayTarget) -> str:
    """The deterministic Italian sentence, and the fallback whenever the model is not
    reachable.

    Written to stand on its own: this is what most users will read most days, not a
    degraded placeholder for something better. The LLM narrative replaces it with
    something warmer, never with something that says more.
    """
    if tomorrow.load == "molto_lungo":
        return (
            f"Domani {_session_phrase(tomorrow)}: stasera carica di carboidrati, "
            "e colazione almeno due ore prima."
        )
    if tomorrow.load == "duro":
        return f"Domani {_session_phrase(tomorrow)}: stasera un piatto pieno di carboidrati."
    if tomorrow.load == "moderato":
        return f"Domani {_session_phrase(tomorrow)}: mangia come sempre, senza pensarci troppo."

    # Tomorrow is easy or rest, so the useful thing to say is about today.
    if today.load in ("duro", "molto_lungo"):
        return "Oggi hai speso parecchio: reintegra stasera, adesso il recupero passa da lì."
    if tomorrow.load == "facile":
        return f"Domani {_session_phrase(tomorrow)}: giornata leggera, niente da preparare."
    return "Domani riposo: niente da caricare, tieni le proteine dove sono."


def fuelling_facts(fuelling: DailyFuelling, consumed: dict[str, float] | None = None) -> dict:
    """The small deterministic dict handed to the model to be written up.

    Only derived figures, no raw training data and nothing identifying: the model is
    asked to phrase an answer that has already been computed, so it never needs the
    plan, the weight, or a photo to do its job.
    """
    facts = {
        "domani_sessione": fuelling.tomorrow.session_title,
        "domani_carico": fuelling.tomorrow.load,
        "domani_minuti": fuelling.tomorrow.duration_minutes,
        "domani_carboidrati_g": list(fuelling.tomorrow.carb_g) if fuelling.tomorrow.carb_g else None,
        "oggi_carico": fuelling.today.load,
        "oggi_carboidrati_g": list(fuelling.today.carb_g) if fuelling.today.carb_g else None,
        "peso_stimato": fuelling.weight_source == "reference",
    }
    if consumed:
        facts["oggi_assunto"] = {
            "carboidrati_g": round(consumed.get("carb_g", 0.0)),
            "proteine_g": round(consumed.get("protein_g", 0.0)),
        }
    return facts
