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


def session_distance_km(session: TrainingSession) -> float:
    """The other half of the same sum: kilometres, with time-based steps converted
    through their pace (see `step_distance_km`).

    Zero for a session with no steps -- a live Garmin calendar entry carries only a
    title, and calling that "0 km" in a total is exactly the lie every consumer of this
    has to be able to spot. Callers that add these up are expected to say how many of
    the sessions they counted had no detail at all.
    """
    steps = flatten_steps(session.steps)
    fallback = session_fallback_pace(steps)
    return sum(step_distance_km(step, fallback) for step in steps)


# ---- race goal ------------------------------------------------------------------------

# The named distances a plan may write instead of a number, in km. Both the English and
# the Italian spelling, since the file is written by hand and the app speaks Italian.
NAMED_DISTANCES_KM = {
    "5k": 5.0,
    "10k": 10.0,
    "half": 21.0975,
    "mezza": 21.0975,
    "half_marathon": 21.0975,
    "mezza_maratona": 21.0975,
    "marathon": 42.195,
    "maratona": 42.195,
}

# Where the calendar says you are, relative to the race. Deliberately crude: it labels
# the distance to the start line, not what the plan actually periodises -- see
# `race_phase`.
PHASE_BASE = "base"
PHASE_BUILD = "costruzione"
PHASE_PEAK = "picco"
PHASE_TAPER = "scarico"
PHASE_DONE = "gara passata"


@dataclass
class RaceGoal:
    """The race the plan is written for.

    Optional everywhere: a plan without one still works, and every screen that reads a
    goal has to render without it. `target_time_seconds` is separately optional --
    "arrivare in fondo" is a goal too, and one the app must not turn into a pace.
    """

    race_date: date_type
    distance_km: float
    name: str | None = None
    target_time_seconds: int | None = None


def days_to_race(goal: RaceGoal, today: date_type | None = None) -> int:
    """Negative once the race has been run."""
    return (goal.race_date - (today or date_type.today())).days


def weeks_to_race(goal: RaceGoal, today: date_type | None = None) -> float:
    return days_to_race(goal, today) / 7


def race_phase(goal: RaceGoal, today: date_type | None = None) -> str:
    """Which block of the calendar today falls in.

    This is arithmetic on a date, not an assessment of the plan: it says how far the
    race is, in the vocabulary a runner already uses for it. Nothing here reads the
    sessions, so it cannot and must not be presented as "you are in your build phase"
    in the coaching sense -- only as "the race is eight weeks out".
    """
    weeks = weeks_to_race(goal, today)
    if weeks < 0:
        return PHASE_DONE
    if weeks > 12:
        return PHASE_BASE
    if weeks > 4:
        return PHASE_BUILD
    if weeks > 1:
        return PHASE_PEAK
    return PHASE_TAPER
