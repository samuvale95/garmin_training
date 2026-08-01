from datetime import date
from pathlib import Path

import pytest

from training_plan.parser import (
    TrainingPlanValidationError,
    parse_target_pace,
    parse_training_plan,
)


def _write(tmp_path: Path, content: str) -> Path:
    path = tmp_path / "plan.yaml"
    path.write_text(content)
    return path


def test_minimal_valid_entry(tmp_path):
    path = _write(
        tmp_path,
        """
        sessions:
          - date: "2026-08-01"
            sport: running
            title: Easy run
        """,
    )
    sessions = parse_training_plan(path)
    assert len(sessions) == 1
    session = sessions[0]
    assert session.date == date(2026, 8, 1)
    assert session.sport == "running"
    assert session.title == "Easy run"
    assert session.description is None
    assert session.steps == []


def test_structured_entry_with_steps(tmp_path):
    path = _write(
        tmp_path,
        """
        sessions:
          - date: "2026-08-02"
            sport: running
            title: Intervals
            description: 5x400m
            steps:
              - type: warmup
                duration_type: time
                duration_value: 10
              - type: interval
                duration_type: distance
                duration_value: 0.4
              - type: recovery
                duration_type: time
                duration_value: 2
              - type: cooldown
                duration_type: time
                duration_value: 10
        """,
    )
    sessions = parse_training_plan(path)
    assert len(sessions) == 1
    steps = sessions[0].steps
    assert [s.type for s in steps] == ["warmup", "interval", "recovery", "cooldown"]
    assert steps[1].duration_type == "distance"
    assert steps[1].duration_value == 0.4


@pytest.mark.parametrize("missing_field", ["date", "sport", "title"])
def test_missing_required_field(tmp_path, missing_field):
    fields = {"date": '"2026-08-01"', "sport": "running", "title": "Easy run"}
    del fields[missing_field]
    body = "\n".join(f"    {k}: {v}" for k, v in fields.items())
    path = _write(tmp_path, f"sessions:\n  - {body.strip()}\n")

    with pytest.raises(TrainingPlanValidationError) as exc_info:
        parse_training_plan(path)
    assert any(missing_field in error and "missing required field" in error for error in exc_info.value.errors)


def test_invalid_sport(tmp_path):
    path = _write(
        tmp_path,
        """
        sessions:
          - date: "2026-08-01"
            sport: unicycling
            title: Weird
        """,
    )
    with pytest.raises(TrainingPlanValidationError) as exc_info:
        parse_training_plan(path)
    assert any("invalid sport" in error for error in exc_info.value.errors)


def test_invalid_date(tmp_path):
    path = _write(
        tmp_path,
        """
        sessions:
          - date: "08/01/2026"
            sport: running
            title: Easy run
        """,
    )
    with pytest.raises(TrainingPlanValidationError) as exc_info:
        parse_training_plan(path)
    assert any("invalid date" in error for error in exc_info.value.errors)


def test_invalid_step_missing_duration_value(tmp_path):
    path = _write(
        tmp_path,
        """
        sessions:
          - date: "2026-08-01"
            sport: running
            title: Intervals
            steps:
              - type: warmup
                duration_type: time
        """,
    )
    with pytest.raises(TrainingPlanValidationError) as exc_info:
        parse_training_plan(path)
    assert any("duration_value" in error for error in exc_info.value.errors)


def test_target_pace_range_parsed_slower_first():
    target = parse_target_pace("5:30-5:00")
    assert target.slower_sec_per_km == 330
    assert target.faster_sec_per_km == 300


def test_target_pace_range_accepts_reversed_order():
    target = parse_target_pace("5:00-5:30")
    assert target.slower_sec_per_km == 330
    assert target.faster_sec_per_km == 300


def test_target_pace_single_value_widened_by_tolerance():
    target = parse_target_pace("5:00")
    assert target.slower_sec_per_km == 305
    assert target.faster_sec_per_km == 295


def test_target_pace_converts_to_expected_speeds():
    # 8:30/km and 8:00/km -> the m/s bounds Garmin stores.
    target = parse_target_pace("8:30-8:00")
    slower, faster = target.as_speeds_mps()
    assert round(slower, 7) == 1.9607843
    assert round(faster, 7) == 2.0833333


@pytest.mark.parametrize("bad", ["5.30", "5:99", "abc", "5:30-", "5:30-5:00-4:30", "0:00", 300])
def test_target_pace_invalid_values_rejected(bad):
    with pytest.raises(ValueError):
        parse_target_pace(bad)


def test_target_pace_identical_bounds_rejected():
    with pytest.raises(ValueError):
        parse_target_pace("5:00-5:00")


def test_step_with_target_pace_in_file(tmp_path):
    path = _write(
        tmp_path,
        """
        sessions:
          - date: "2026-08-05"
            sport: running
            title: Threshold
            steps:
              - type: interval
                duration_type: distance
                duration_value: 5
                target_pace: "4:20-4:10"
              - type: cooldown
                duration_type: time
                duration_value: 10
        """,
    )
    steps = parse_training_plan(path)[0].steps
    assert steps[0].target_pace.slower_sec_per_km == 260
    assert steps[0].target_pace.faster_sec_per_km == 250
    assert steps[1].target_pace is None


def test_invalid_target_pace_reports_entry_and_step(tmp_path):
    path = _write(
        tmp_path,
        """
        sessions:
          - date: "2026-08-05"
            sport: running
            title: Threshold
            steps:
              - type: interval
                duration_type: distance
                duration_value: 5
                target_pace: "four minutes"
        """,
    )
    with pytest.raises(TrainingPlanValidationError) as exc_info:
        parse_training_plan(path)
    assert any("target_pace" in error and "step #1" in error for error in exc_info.value.errors)


def test_all_entry_errors_collected_not_just_first(tmp_path):
    path = _write(
        tmp_path,
        """
        sessions:
          - date: "bad-date"
            sport: running
            title: First
          - date: "2026-08-02"
            sport: bad-sport
            title: Second
        """,
    )
    with pytest.raises(TrainingPlanValidationError) as exc_info:
        parse_training_plan(path)
    assert len(exc_info.value.errors) == 2
