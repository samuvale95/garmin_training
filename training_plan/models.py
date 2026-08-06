from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date as date_type

SUPPORTED_SPORTS = ("running", "cycling", "swimming", "strength_training", "other")
SUPPORTED_STEP_TYPES = ("warmup", "interval", "recovery", "rest", "cooldown")
SUPPORTED_DURATION_TYPES = ("time", "distance")

# Garmin caps a repeat group's iterations; anything outside this range is rejected by
# the API rather than clamped, so it is validated on the way in instead.
MIN_REPETITIONS = 2
MAX_REPETITIONS = 99

# Garmin Connect sportType payload fragments, keyed by our file-format sport value.
SPORT_TYPE_PAYLOAD = {
    "running": {"sportTypeId": 1, "sportTypeKey": "running", "displayOrder": 1},
    "cycling": {"sportTypeId": 2, "sportTypeKey": "cycling", "displayOrder": 2},
    "swimming": {"sportTypeId": 3, "sportTypeKey": "swimming", "displayOrder": 3},
    "strength_training": {"sportTypeId": 6, "sportTypeKey": "fitness_equipment", "displayOrder": 6},
    "other": {"sportTypeId": 8, "sportTypeKey": "other", "displayOrder": 8},
}

# The other direction: Garmin's own sport keys, mapped back onto the five file-format
# values. Garmin has far more sports than this format does (and spells some of ours
# differently -- strength training is "fitness_equipment"), so anything read *from* the
# calendar has to be brought back into the format before it can be written out again.
# Substrings, not an exhaustive list: Garmin's keys are compounds around a handful of
# stems ("trail_running", "indoor_cycling", "lap_swimming", ...), and a new one should
# land on the closest sport rather than on "other".
_GARMIN_SPORT_STEMS = (
    ("swim", "swimming"),
    ("run", "running"),
    ("cycl", "cycling"),
    ("bik", "cycling"),
    ("ride", "cycling"),
    ("strength", "strength_training"),
    ("fitness_equipment", "strength_training"),
)


def sport_from_garmin_key(key: str | None) -> str:
    """A Garmin sport key as one of `SUPPORTED_SPORTS` -- "other" when nothing fits.

    Needed wherever a workout Garmin holds becomes a `TrainingSession` this app can edit
    and write back: `SPORT_TYPE_PAYLOAD` is keyed by the file-format value, so a session
    carrying Garmin's own spelling could be shown but never saved.
    """
    normalized = (key or "").strip().lower()
    if normalized in SUPPORTED_SPORTS:
        return normalized
    for stem, sport in _GARMIN_SPORT_STEMS:
        if stem in normalized:
            return sport
    return "other"


# Garmin Connect stepType payload fragments, keyed by our file-format step type.
#
# What these mean *on the watch*, since the choice is not cosmetic:
#   warmup / cooldown -- bookend steps, shown as such and excluded from Garmin's
#     interval statistics.
#   interval          -- the work step ("Ripetuta").
#   recovery          -- an *active* recovery ("Recupero"): the watch keeps you moving
#     and, if the step carries a pace target, holds you to that (slow) pace. This is
#     the one to use for a jogged recovery.
#   rest              -- a standing rest ("Riposo"): same timer, but presented as a
#     pause, and a pace target on it makes no sense.
# None of them stops the timer or auto-advances: every step ends on its own
# distance/time condition regardless of type. The difference the athlete actually
# feels is the label plus whether a pace target is attached (see PACE_TARGET_PAYLOAD).
STEP_TYPE_PAYLOAD = {
    "warmup": {"stepTypeId": 1, "stepTypeKey": "warmup", "displayOrder": 1},
    "interval": {"stepTypeId": 3, "stepTypeKey": "interval", "displayOrder": 3},
    "recovery": {"stepTypeId": 4, "stepTypeKey": "recovery", "displayOrder": 4},
    "rest": {"stepTypeId": 5, "stepTypeKey": "rest", "displayOrder": 5},
    "cooldown": {"stepTypeId": 2, "stepTypeKey": "cooldown", "displayOrder": 2},
}

# A repeat group is itself a step in Garmin's tree (stepTypeId 6), holding the steps it
# repeats as children rather than an end condition of its own.
REPEAT_STEP_TYPE_PAYLOAD = {"stepTypeId": 6, "stepTypeKey": "repeat", "displayOrder": 6}

# ...and the "end after N iterations" condition that goes with it. `displayable` is
# False because the count is already shown by the group itself.
ITERATIONS_CONDITION_PAYLOAD = {
    "conditionTypeId": 7,
    "conditionTypeKey": "iterations",
    "displayOrder": 7,
    "displayable": False,
}

# Garmin Connect endCondition payload fragments, keyed by our file-format duration_type.
# The IDs below were verified empirically against the live API (1=lap.button, 2=time,
# 3=distance, 4=calories, 5=power). Do NOT take them from the bundled library's
# `ConditionType` helper, which claims DISTANCE=1 — sending that silently turns a
# distance step into a "press the lap button" step.
CONDITION_TYPE_PAYLOAD = {
    "time": {"conditionTypeId": 2, "conditionTypeKey": "time", "displayOrder": 2, "displayable": True},
    "distance": {"conditionTypeId": 3, "conditionTypeKey": "distance", "displayOrder": 3, "displayable": True},
}

# End condition for the single step of a "simple" (no explicit steps) entry: the
# athlete ends the step manually (Garmin's "lap button" condition), since the file
# format carries no duration/distance for these entries.
LAP_BUTTON_CONDITION_PAYLOAD = {
    "conditionTypeId": 1,
    "conditionTypeKey": "lap.button",
    "displayOrder": 1,
    "displayable": True,
}

NO_TARGET_PAYLOAD = {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1}

# Garmin pace target. Garmin stores the two bounds as speeds in metres/second on the
# step itself (targetValueOne/targetValueTwo), NOT nested inside targetType.
PACE_TARGET_PAYLOAD = {"workoutTargetTypeId": 6, "workoutTargetTypeKey": "pace.zone", "displayOrder": 6}

# Seconds a single-value pace target is widened by in each direction, since Garmin
# expects a range rather than an exact pace.
DEFAULT_PACE_TOLERANCE_SECONDS = 5


@dataclass
class PaceTarget:
    """A pace range for a step, held as seconds per kilometre."""

    slower_sec_per_km: int
    faster_sec_per_km: int

    def as_speeds_mps(self) -> tuple[float, float]:
        """Return (slower, faster) bounds converted to metres/second for Garmin."""
        return 1000 / self.slower_sec_per_km, 1000 / self.faster_sec_per_km


@dataclass
class Step:
    type: str
    duration_type: str
    duration_value: float  # minutes for "time", kilometers for "distance"
    target_pace: PaceTarget | None = None


@dataclass
class RepeatBlock:
    """A group of steps performed `reps` times over -- Garmin's own `RepeatGroupDTO`.

    Kept as a real structure rather than expanded into repeated `Step`s, because
    Garmin supports repeat groups natively: sending one means the watch shows
    "Ripetuta 3/6" instead of six indistinguishable steps, and the workout survives a
    round-trip through Garmin Connect looking the way it was written.

    Deliberately one level deep (`steps` holds plain `Step`s, never another block):
    Garmin allows nesting, but nothing in this app's file format or its editor offers
    it, and a workout read back with nested groups is flattened one level on the way
    in (see `garmin_sync._parse_workout_steps`).
    """

    reps: int
    steps: list[Step] = field(default_factory=list)


# What a session's `steps` list may hold: plain steps, repeat blocks, or a mix.
SessionStep = Step | RepeatBlock


def flatten_steps(steps: list[SessionStep]) -> list[Step]:
    """Every step in execution order, with repeat blocks expanded out.

    For the many read-only consumers that only ever ask "how far / how long / at what
    pace is this session" (planned totals, distance rings, content hashing) and have
    no interest in how the steps are grouped. The `Step`s are shared, not copied --
    callers must not mutate them.
    """
    flat: list[Step] = []
    for item in steps:
        if isinstance(item, RepeatBlock):
            flat.extend(item.steps * item.reps)
        else:
            flat.append(item)
    return flat


# Stand-in pace for a time-based step that names none and sits in a session that names
# none either -- 6:00/km, an unhurried running pace. Mirrors DEFAULT_EASY_PACE_SEC_PER_KM
# in format.ts; the two must agree or the same session gets two different planned totals.
DEFAULT_EASY_PACE_SEC_PER_KM = 360.0


def avg_pace_sec_per_km(target: PaceTarget) -> float:
    return (target.slower_sec_per_km + target.faster_sec_per_km) / 2


def session_fallback_pace(steps: list[Step]) -> float:
    """The pace to assume for the steps that carry no target of their own: the slowest
    one the session does name. The unpaced steps are a session's easy parts, so its
    slowest named pace is the closest honest proxy -- borrowing the interval pace would
    turn a 15-minute warmup into 3.7 km.

    Takes *flattened* steps: a repeat block holds its own paces and they count.
    """
    paces = [avg_pace_sec_per_km(step.target_pace) for step in steps if step.target_pace]
    return max(paces) if paces else DEFAULT_EASY_PACE_SEC_PER_KM


def step_distance_km(step: Step, fallback_pace: float = DEFAULT_EASY_PACE_SEC_PER_KM) -> float:
    """Mirrors the frontend's `stepDistanceKm` (format.ts): a step's own distance if it
    has one, otherwise a pace-derived estimate from its time and either its own target
    pace or `fallback_pace`.

    The fallback matters: a time-based step with no pace of its own used to count as
    0 km, which understated the planned distance of every session written as
    "riscaldamento: 15 min" with no target -- and that planned total is what the Strava
    comparison holds the actual run up against. "rest" really is 0 km: standing still.
    """
    if step.duration_type == "distance":
        return step.duration_value
    if step.type == "rest":
        return 0.0
    sec_per_km = avg_pace_sec_per_km(step.target_pace) if step.target_pace else fallback_pace
    return (step.duration_value * 60) / sec_per_km


def step_duration_minutes(step: Step, fallback_pace: float = DEFAULT_EASY_PACE_SEC_PER_KM) -> float:
    """The mirror image of `step_distance_km`: minutes on the feet, with a distance-based
    step converted through its pace.

    Time spent is what fuelling scales on -- 90 minutes is 90 minutes of glycogen whether
    the file wrote it as "90 min" or as "15 km" -- so a totals function that only summed
    the time-based steps (as `strava_sync._planned_summary` does, deliberately, for a
    different purpose) would read a plan written in kilometres as a rest day.
    """
    if step.duration_type == "time":
        return step.duration_value
    sec_per_km = avg_pace_sec_per_km(step.target_pace) if step.target_pace else fallback_pace
    return (step.duration_value * sec_per_km) / 60


@dataclass
class TrainingSession:
    date: date_type
    sport: str
    title: str
    description: str | None = None
    steps: list[SessionStep] = field(default_factory=list)


def session_duration_minutes(session: TrainingSession) -> float:
    """Total minutes the session asks for, repeat blocks expanded and distance steps
    converted at their own (or the session's slowest named) pace."""
    steps = flatten_steps(session.steps)
    fallback = session_fallback_pace(steps)
    return sum(step_duration_minutes(step, fallback) for step in steps)
