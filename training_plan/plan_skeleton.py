"""The shape of the plan up to the goal: how much, how fast it grows, when it steps back.

The generated plan has two horizons (`BRAINSTORM-miglioramenti-e-gamification.md` §0.4):
this skeleton, one row per week to the race, and the detailed window the model fills
inside it. The skeleton is arithmetic on numbers the app already has -- recent volume,
level, goal -- so it is computed here and never asked of a model: the figures that decide
whether a block is safe are exactly the ones that must be recomputable by hand.

Pure: no database, no clock. `plan_generator` stores the result with the inputs it came
from and reuses it, so the progression builds instead of re-basing on whatever the user
happened to run last week.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date as date_type
from datetime import timedelta

from .models import PHASE_BASE, PHASE_BUILD, PHASE_PEAK, RaceGoal, race_phase

PHASE_RACE = "gara"
PHASE_TAPER = "scarico"
PHASE_HABIT = "costanza"

# Weeks with no goal: the window alone (§0.4, "senza obiettivo niente scheletro").
NO_GOAL_WEEKS = 3
MAX_WEEKS = 52

# Per effective level 1, 2, 3 (design.md decision #1). Growth is half the `volume_growth`
# limit and the lighter week 5 points under `deload`, so the model has room around a
# target without breaking a rule.
START_MINUTES = (60, 100, 160)
BUILD_GROWTH = (0.05, 0.07, 0.10)
LIGHTER_RATIO = (0.75, 0.75, 0.80)
LIGHTER_EVERY = 4
DAYS_RANGE = ((2, 4), (3, 5), (3, 6))
DAYS_WITHOUT_HISTORY = (3, 3, 4)
NO_GOAL_CEILING = (150, 240, 360)
NO_GOAL_LONG_RUN = (60, 90, 120)
LEVEL_CEILING_FACTOR = (0.5, 0.75, 1.0)

# (up to this distance in km, weekly ceiling in minutes at level 3, longest run cap)
DISTANCE_CAPS = ((5.0, 210, 70), (10.0, 270, 90), (21.1, 330, 120), (float("inf"), 420, 180))

# The long run's share of the week, by running days: with three runs a week the long one
# is naturally close to half of it; with six it is a third.
LONG_RUN_SHARE = {1: 0.5, 2: 0.5, 3: 0.45, 4: 0.40}
LONG_RUN_SHARE_MANY_DAYS = 0.35
# Running days that are not quality: at least the long run and one easy day. On the real
# account the first skeleton gave three runs a week, all of them hard.
EASY_DAYS_BEYOND_QUALITY = 2
MIN_SESSION_MINUTES = 20
BEFORE_RACE_RATIO = 0.75
RACE_WEEK_RATIO = 0.50

PHASE_LABELS = {
    PHASE_BASE: "Base",
    PHASE_BUILD: "Costruzione",
    PHASE_PEAK: "Picco",
    PHASE_TAPER: "Scarico prima della gara",
    PHASE_RACE: "Settimana della gara",
    PHASE_HABIT: "Costanza",
}


@dataclass
class SkeletonInputs:
    start: date_type  # Monday of the first week
    effective_level: int
    # None: thin history, the per-level starting volume applies.
    recent_weekly_minutes: float | None
    # Median running days per complete week recently; None without history.
    recent_running_days: int | None
    goal: RaceGoal | None = None


@dataclass
class SkeletonWeek:
    monday: date_type
    phase: str
    target_minutes: int
    long_run_minutes: int
    quality_sessions: int
    running_days: int
    lighter: bool
    reason: str

    def to_dict(self) -> dict:
        out = asdict(self)
        out["monday"] = self.monday.isoformat()
        return out

    @classmethod
    def from_dict(cls, data: dict) -> "SkeletonWeek":
        return cls(**{**data, "monday": date_type.fromisoformat(data["monday"])})


def _round5(value: float) -> int:
    # Half up, not Python's half-to-even: 202.5 is 205, as anyone checking by hand expects.
    return int(value / 5 + 0.5) * 5


def _monday(day: date_type) -> date_type:
    return day - timedelta(days=day.weekday())


def _caps(inputs: SkeletonInputs) -> tuple[int, int, str]:
    """Weekly ceiling, longest-run cap, and how to name the ceiling in a reason."""
    index = inputs.effective_level - 1
    if inputs.goal is None:
        return NO_GOAL_CEILING[index], NO_GOAL_LONG_RUN[index], f"il tetto del livello {inputs.effective_level}"
    for up_to, ceiling, long_run in DISTANCE_CAPS:
        if inputs.goal.distance_km <= up_to:
            return (
                _round5(ceiling * LEVEL_CEILING_FACTOR[index]),
                long_run,
                f"il tetto per {inputs.goal.distance_km:g} km al livello {inputs.effective_level}",
            )
    raise AssertionError("DISTANCE_CAPS ends with infinity")


def _weeks(inputs: SkeletonInputs) -> tuple[list[date_type], bool]:
    """The Mondays of the skeleton, and whether they run to a race."""
    start = _monday(inputs.start)
    goal = inputs.goal
    if goal is not None and _monday(goal.race_date) >= start:
        count = min((_monday(goal.race_date) - start).days // 7 + 1, MAX_WEEKS)
        return [start + timedelta(weeks=k) for k in range(count)], True
    return [start + timedelta(weeks=k) for k in range(NO_GOAL_WEEKS)], False


def _running_days(inputs: SkeletonInputs, target: int) -> int:
    index = inputs.effective_level - 1
    low, high = DAYS_RANGE[index]
    if inputs.recent_running_days is None:
        days = DAYS_WITHOUT_HISTORY[index]
    else:
        # One day more than the habit, at most: costanza grows by adding a day, not three.
        days = max(low, min(high, inputs.recent_running_days + 1))
    # Every session has to be worth putting shoes on for.
    return max(1, min(days, target // MIN_SESSION_MINUTES))


def _quality(level: int, phase: str, lighter: bool, before_race: bool) -> int:
    if level == 1 or phase == PHASE_RACE:
        return 0
    base = 1 if level == 2 or phase == PHASE_BASE else 2
    return max(0, base - 1) if lighter or before_race else base


def build_skeleton(inputs: SkeletonInputs) -> list[SkeletonWeek]:
    level = max(1, min(3, inputs.effective_level))
    index = level - 1
    mondays, to_race = _weeks(inputs)
    ceiling, long_cap, ceiling_name = _caps(inputs)
    thin = inputs.recent_weekly_minutes is None
    start_volume = START_MINUTES[index] if thin else inputs.recent_weekly_minutes
    ceiling = max(ceiling, _round5(start_volume))
    growth = BUILD_GROWTH[index]

    out: list[SkeletonWeek] = []
    highest_build: int | None = None
    for i, monday in enumerate(mondays):
        remaining = len(mondays) - 1 - i
        peak = max((week.target_minutes for week in out), default=_round5(start_volume))
        lighter = False
        before_race = False

        if to_race and remaining == 0:
            phase = PHASE_RACE
            target = _round5(peak * RACE_WEEK_RATIO)
            reason = f"Settimana della gara: {target} minuti, metà della settimana più carica ({peak})."
        elif to_race and remaining == 1 and len(mondays) >= 3:
            phase, before_race = PHASE_TAPER, True
            target = _round5(peak * BEFORE_RACE_RATIO)
            reason = (
                f"Settimana prima della gara: {target} minuti, il {round(BEFORE_RACE_RATIO * 100)}% "
                f"della più carica ({peak}), per arrivarci fresco."
            )
        else:
            phase = race_phase(inputs.goal, monday) if to_race else PHASE_HABIT
            if (i + 1) % LIGHTER_EVERY == 0 and out:
                lighter = True
                previous = out[-1].target_minutes
                target = _round5(previous * LIGHTER_RATIO[index])
                reason = (
                    f"Settimana più leggera: {target} minuti, il {round(LIGHTER_RATIO[index] * 100)}% "
                    f"di {previous}, per assorbire le tre settimane prima."
                )
            elif i == 0 and thin:
                target = _round5(start_volume)
                reason = f"Si parte da {target} minuti, il volume d'avvio del livello {level}."
            else:
                base = highest_build if highest_build is not None else start_volume
                grown = _round5(base * (1 + growth))
                target = min(grown, ceiling)
                if target < grown:
                    reason = f"Resta a {target} minuti, {ceiling_name}."
                elif highest_build is None:
                    reason = (
                        f"{target} minuti: +{round(growth * 100)}% sui {round(base)} minuti medi "
                        "delle ultime 4 settimane."
                    )
                else:
                    reason = f"{target} minuti: +{round(growth * 100)}% sulla settimana più carica finora ({base})."
                highest_build = max(highest_build or 0, target)

        days = _running_days(inputs, target)
        share = LONG_RUN_SHARE.get(days, LONG_RUN_SHARE_MANY_DAYS)
        long_run = max(MIN_SESSION_MINUTES, min(_round5(target * share), long_cap))
        quality = min(_quality(level, phase, lighter, before_race), max(0, days - EASY_DAYS_BEYOND_QUALITY))
        label = PHASE_LABELS.get(phase, phase.capitalize())
        detail = f"lungo fino a {long_run} minuti, {days} giorni di corsa"
        if quality:
            detail += f", {quality} {'seduta' if quality == 1 else 'sedute'} di qualità"
        out.append(
            SkeletonWeek(
                monday=monday,
                phase=phase,
                target_minutes=target,
                long_run_minutes=long_run,
                quality_sessions=quality,
                running_days=days,
                lighter=lighter,
                reason=f"{label}. {reason} {detail[0].upper()}{detail[1:]}.",
            )
        )
    return out
