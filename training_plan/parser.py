from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

import yaml

from .models import (
    DEFAULT_PACE_TOLERANCE_SECONDS,
    MAX_REPETITIONS,
    MIN_REPETITIONS,
    NAMED_DISTANCES_KM,
    SUPPORTED_DURATION_TYPES,
    SUPPORTED_SPORTS,
    SUPPORTED_STEP_TYPES,
    PaceTarget,
    RaceGoal,
    RepeatBlock,
    SessionStep,
    Step,
    TrainingSession,
)

_PACE_RE = re.compile(r"^(\d{1,3}):([0-5]\d)$")


class TrainingPlanValidationError(Exception):
    """Raised when one or more session entries in a training-plan file are invalid."""

    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__("\n".join(errors))


def _entry_label(index: int, raw_entry: dict[str, Any]) -> str:
    title = raw_entry.get("title") if isinstance(raw_entry, dict) else None
    return f"entry #{index + 1}" + (f" ({title!r})" if title else "")


def _validate_date(index: int, raw_entry: dict[str, Any], errors: list[str]) -> date | None:
    raw_date = raw_entry.get("date")
    if raw_date is None:
        errors.append(f"{_entry_label(index, raw_entry)}: missing required field 'date'")
        return None
    try:
        return datetime.strptime(str(raw_date), "%Y-%m-%d").date()
    except ValueError:
        errors.append(
            f"{_entry_label(index, raw_entry)}: invalid date {raw_date!r}, expected format YYYY-MM-DD"
        )
        return None


def _validate_sport(index: int, raw_entry: dict[str, Any], errors: list[str]) -> str | None:
    sport = raw_entry.get("sport")
    if sport is None:
        errors.append(f"{_entry_label(index, raw_entry)}: missing required field 'sport'")
        return None
    if sport not in SUPPORTED_SPORTS:
        errors.append(
            f"{_entry_label(index, raw_entry)}: invalid sport {sport!r}, expected one of {SUPPORTED_SPORTS}"
        )
        return None
    return sport


def _validate_title(index: int, raw_entry: dict[str, Any], errors: list[str]) -> str | None:
    title = raw_entry.get("title")
    if not title:
        errors.append(f"{_entry_label(index, raw_entry)}: missing required field 'title'")
        return None
    return str(title)


def _parse_pace_token(token: str) -> int:
    """Parse a single 'M:SS' pace into seconds per kilometre. Raises ValueError."""
    match = _PACE_RE.match(token.strip())
    if not match:
        raise ValueError(f"invalid pace {token.strip()!r}, expected format M:SS (minutes per km)")
    minutes, seconds = int(match.group(1)), int(match.group(2))
    total = minutes * 60 + seconds
    if total <= 0:
        raise ValueError(f"invalid pace {token.strip()!r}, must be greater than zero")
    return total


def parse_target_pace(raw: Any) -> PaceTarget:
    """Parse a 'target_pace' value into a PaceTarget. Raises ValueError if malformed.

    Accepts a single pace ("5:00", widened by DEFAULT_PACE_TOLERANCE_SECONDS in each
    direction since Garmin expects a range) or an explicit range ("5:30-5:00").
    """
    if not isinstance(raw, str):
        raise ValueError(f"invalid target_pace {raw!r}, expected a string like '5:00' or '5:30-5:00'")

    tokens = raw.split("-")
    if len(tokens) > 2:
        raise ValueError(f"invalid target_pace {raw!r}, expected a single pace or a 'M:SS-M:SS' range")

    try:
        parsed = [_parse_pace_token(token) for token in tokens]
    except ValueError as exc:
        raise ValueError(f"invalid target_pace {raw!r}: {exc}") from exc

    if len(parsed) == 1:
        centre = parsed[0]
        return PaceTarget(
            slower_sec_per_km=centre + DEFAULT_PACE_TOLERANCE_SECONDS,
            faster_sec_per_km=centre - DEFAULT_PACE_TOLERANCE_SECONDS,
        )

    first, second = parsed
    if first == second:
        raise ValueError(f"invalid target_pace {raw!r}, the two bounds must differ")
    # Accept either order in the file; slower pace is the larger seconds-per-km.
    return PaceTarget(slower_sec_per_km=max(first, second), faster_sec_per_km=min(first, second))


def _validate_step(label: str, raw_step: Any, errors: list[str]) -> Step | None:
    step_type = raw_step.get("type") if isinstance(raw_step, dict) else None
    duration_type = raw_step.get("duration_type") if isinstance(raw_step, dict) else None
    duration_value = raw_step.get("duration_value") if isinstance(raw_step, dict) else None

    if step_type not in SUPPORTED_STEP_TYPES:
        errors.append(f"{label}: invalid or missing 'type', expected one of {SUPPORTED_STEP_TYPES}")
        return None
    if duration_type not in SUPPORTED_DURATION_TYPES:
        errors.append(
            f"{label}: invalid or missing 'duration_type', expected one of {SUPPORTED_DURATION_TYPES}"
        )
        return None
    if not isinstance(duration_value, (int, float)) or isinstance(duration_value, bool) or duration_value <= 0:
        errors.append(f"{label}: 'duration_value' must be a positive number")
        return None

    target_pace = None
    raw_target_pace = raw_step.get("target_pace")
    if raw_target_pace is not None:
        try:
            target_pace = parse_target_pace(raw_target_pace)
        except ValueError as exc:
            errors.append(f"{label}: {exc}")
            return None

    return Step(
        type=step_type,
        duration_type=duration_type,
        duration_value=float(duration_value),
        target_pace=target_pace,
    )


def _validate_repeat_block(label: str, raw_block: dict[str, Any], errors: list[str]) -> RepeatBlock | None:
    """A `repeat:`/`steps:` mapping as a `RepeatBlock`, or None (having recorded why).

    A block's own steps are validated exactly like top-level ones -- only nesting a
    block inside a block is refused, since `RepeatBlock` is one level deep by design.
    """
    reps = raw_block.get("repeat")
    if not isinstance(reps, int) or isinstance(reps, bool) or not MIN_REPETITIONS <= reps <= MAX_REPETITIONS:
        errors.append(
            f"{label}: 'repeat' must be a whole number between {MIN_REPETITIONS} and {MAX_REPETITIONS}"
        )
        return None

    raw_steps = raw_block.get("steps")
    if not isinstance(raw_steps, list) or not raw_steps:
        errors.append(f"{label}: a repeat block needs a non-empty 'steps' list")
        return None

    steps: list[Step] = []
    for step_index, raw_step in enumerate(raw_steps):
        step_label = f"{label}, step #{step_index + 1}"
        if isinstance(raw_step, dict) and "repeat" in raw_step:
            errors.append(f"{step_label}: repeat blocks cannot be nested inside one another")
            continue
        step = _validate_step(step_label, raw_step, errors)
        if step is not None:
            steps.append(step)

    return RepeatBlock(reps=reps, steps=steps) if steps else None


def _validate_steps(index: int, raw_entry: dict[str, Any], errors: list[str]) -> list[SessionStep]:
    steps: list[SessionStep] = []
    raw_steps = raw_entry.get("steps") or []
    for step_index, raw_step in enumerate(raw_steps):
        # A repeat block is told apart from a step by its 'repeat' key: a step never
        # has one, and a block has no 'type'/'duration_*' of its own.
        if isinstance(raw_step, dict) and "repeat" in raw_step:
            label = f"{_entry_label(index, raw_entry)}, block #{step_index + 1}"
            block = _validate_repeat_block(label, raw_step, errors)
            if block is not None:
                steps.append(block)
            continue

        label = f"{_entry_label(index, raw_entry)}, step #{step_index + 1}"
        step = _validate_step(label, raw_step, errors)
        if step is not None:
            steps.append(step)
    return steps


def _validate_goal(raw: dict[str, Any], errors: list[str]) -> RaceGoal | None:
    """The optional top-level `goal:` block, validated as strictly as a session is.

    A goal the file states wrongly is an error, not something to guess at: a race date
    that doesn't parse would otherwise silently become "no goal", and every screen
    downstream would quietly render the no-goal state instead of saying what is wrong.
    """
    raw_goal = raw.get("goal")
    if raw_goal is None:
        return None
    if not isinstance(raw_goal, dict):
        errors.append(f"goal: expected a mapping of fields, got {type(raw_goal).__name__}")
        return None

    goal_errors: list[str] = []

    race_date: date | None = None
    raw_date = raw_goal.get("race_date")
    if raw_date is None:
        goal_errors.append("goal: 'race_date' is required")
    elif isinstance(raw_date, date):
        race_date = raw_date
    else:
        try:
            race_date = date.fromisoformat(str(raw_date))
        except ValueError:
            goal_errors.append(f"goal: 'race_date' must be YYYY-MM-DD, got {raw_date!r}")

    distance_km: float | None = None
    raw_distance = raw_goal.get("distance_km", raw_goal.get("distance"))
    if raw_distance is None:
        goal_errors.append("goal: 'distance_km' is required")
    elif isinstance(raw_distance, str) and raw_distance.strip().lower() in NAMED_DISTANCES_KM:
        distance_km = NAMED_DISTANCES_KM[raw_distance.strip().lower()]
    else:
        try:
            distance_km = float(raw_distance)
        except (TypeError, ValueError):
            named = ", ".join(sorted(NAMED_DISTANCES_KM))
            goal_errors.append(f"goal: 'distance_km' must be a number or one of {named}, got {raw_distance!r}")
        else:
            if distance_km <= 0:
                goal_errors.append(f"goal: 'distance_km' must be positive, got {distance_km}")
                distance_km = None

    target_seconds: int | None = None
    raw_target = raw_goal.get("target_time")
    if raw_target is not None:
        target_seconds = _parse_target_time(raw_target)
        if target_seconds is None:
            goal_errors.append(f"goal: 'target_time' must be H:MM:SS or MM:SS, got {raw_target!r}")

    raw_name = raw_goal.get("name")
    if raw_name is not None and not isinstance(raw_name, str):
        goal_errors.append(f"goal: 'name' must be text, got {type(raw_name).__name__}")
        raw_name = None

    errors.extend(goal_errors)
    if goal_errors or race_date is None or distance_km is None:
        return None

    return RaceGoal(
        race_date=race_date,
        distance_km=distance_km,
        name=raw_name.strip() if isinstance(raw_name, str) and raw_name.strip() else None,
        target_time_seconds=target_seconds,
    )


def _parse_target_time(raw: Any) -> int | None:
    """`H:MM:SS` or `MM:SS` as seconds, or None when it is neither.

    A bare number is rejected on purpose: "180" is three minutes to one reader and three
    hours to another, and a goal time guessed wrong is a pace target guessed wrong.
    """
    parts = str(raw).strip().split(":")
    if len(parts) not in (2, 3) or not all(part.isdigit() for part in parts):
        return None
    values = [int(part) for part in parts]
    if any(v > 59 for v in values[1:]):
        return None
    if len(values) == 2:
        minutes, seconds = values
        return minutes * 60 + seconds
    hours, minutes, seconds = values
    return hours * 3600 + minutes * 60 + seconds


@dataclass
class ParsedPlan:
    """A plan file's two halves. `goal` is None for the many plans that don't state one."""

    sessions: list[TrainingSession]
    goal: RaceGoal | None = None


def parse_plan_document(path: str | Path) -> ParsedPlan:
    """Parse and validate a training-plan YAML file: its sessions and its optional goal.

    Raises TrainingPlanValidationError, with every entry's problems collected,
    if anything is invalid. Nothing is returned when validation fails.
    """
    raw = yaml.safe_load(Path(path).read_text()) or {}
    raw_sessions = raw.get("sessions") or []

    errors: list[str] = []
    sessions: list[TrainingSession] = []

    for index, raw_entry in enumerate(raw_sessions):
        if not isinstance(raw_entry, dict):
            errors.append(f"entry #{index + 1}: expected a mapping of fields, got {type(raw_entry).__name__}")
            continue

        entry_errors: list[str] = []
        entry_date = _validate_date(index, raw_entry, entry_errors)
        sport = _validate_sport(index, raw_entry, entry_errors)
        title = _validate_title(index, raw_entry, entry_errors)
        steps = _validate_steps(index, raw_entry, entry_errors)

        errors.extend(entry_errors)
        if entry_errors:
            continue

        sessions.append(
            TrainingSession(
                date=entry_date,
                sport=sport,
                title=title,
                description=raw_entry.get("description"),
                steps=steps,
            )
        )

    goal = _validate_goal(raw, errors)

    if errors:
        raise TrainingPlanValidationError(errors)

    return ParsedPlan(sessions=sessions, goal=goal)


def parse_training_plan(path: str | Path) -> list[TrainingSession]:
    """Just the sessions -- what the CLI and the sync path want, neither of which has
    anything to do with a race date."""
    return parse_plan_document(path).sessions
