from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date as date_type

SUPPORTED_SPORTS = ("running", "cycling", "swimming", "strength_training", "other")
SUPPORTED_STEP_TYPES = ("warmup", "interval", "recovery", "cooldown")
SUPPORTED_DURATION_TYPES = ("time", "distance")

# Garmin Connect sportType payload fragments, keyed by our file-format sport value.
SPORT_TYPE_PAYLOAD = {
    "running": {"sportTypeId": 1, "sportTypeKey": "running", "displayOrder": 1},
    "cycling": {"sportTypeId": 2, "sportTypeKey": "cycling", "displayOrder": 2},
    "swimming": {"sportTypeId": 3, "sportTypeKey": "swimming", "displayOrder": 3},
    "strength_training": {"sportTypeId": 6, "sportTypeKey": "fitness_equipment", "displayOrder": 6},
    "other": {"sportTypeId": 8, "sportTypeKey": "other", "displayOrder": 8},
}

# Garmin Connect stepType payload fragments, keyed by our file-format step type.
STEP_TYPE_PAYLOAD = {
    "warmup": {"stepTypeId": 1, "stepTypeKey": "warmup", "displayOrder": 1},
    "interval": {"stepTypeId": 3, "stepTypeKey": "interval", "displayOrder": 3},
    "recovery": {"stepTypeId": 4, "stepTypeKey": "recovery", "displayOrder": 4},
    "cooldown": {"stepTypeId": 2, "stepTypeKey": "cooldown", "displayOrder": 2},
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
class TrainingSession:
    date: date_type
    sport: str
    title: str
    description: str | None = None
    steps: list[Step] = field(default_factory=list)
