"""Exercises and repetitions in strength steps, from the plan file to Garmin and back."""

import textwrap

import pytest

from training_plan import exercises, parser, plan_generator
from training_plan.garmin_sync import GarminSync, _build_step_payload, _parse_workout_step
from training_plan.models import Step


def _plan(tmp_path, steps_yaml):
    path = tmp_path / "plan.yaml"
    path.write_text(
        "sessions:\n  - date: 2026-11-05\n    sport: calisthenics\n    title: Parchetto\n    steps:\n"
        + textwrap.indent(textwrap.dedent(steps_yaml), "      ")
    )
    return path


def test_names_resolve_from_garmin_spelling_or_common_italian():
    assert exercises.resolve("PULL_UP").category == "PULL_UP"
    assert exercises.resolve("pull up").name == "PULL_UP"
    assert exercises.resolve("trazioni").name == "PULL_UP"
    dip = exercises.resolve("dip alle parallele")
    assert (dip.category, dip.name) == ("TRICEPS_EXTENSION", "BODY_WEIGHT_DIP")
    assert exercises.resolve("non esiste") is None


def test_a_step_with_exercise_and_reps_is_read_from_the_file(tmp_path):
    path = _plan(tmp_path, """\
        - repeat: 3
          steps:
            - type: interval
              exercise: trazioni
              reps: 6
            - type: rest
              duration_type: time
              duration_value: 1.5
        """)
    (session,) = parser.parse_training_plan(path)
    block = session.steps[0]
    pull = block.steps[0]
    assert (pull.exercise, pull.duration_type, pull.duration_value) == ("PULL_UP", "reps", 6.0)


def test_an_unknown_exercise_is_refused_with_a_suggestion(tmp_path):
    path = _plan(tmp_path, """\
        - type: interval
          exercise: PUL_UP
          reps: 6
        """)
    with pytest.raises(parser.TrainingPlanValidationError) as error:
        parser.parse_training_plan(path)
    assert "PULL_UP" in str(error.value)


def test_repetitions_must_be_whole(tmp_path):
    path = _plan(tmp_path, """\
        - type: interval
          exercise: PUSH_UP
          reps: 6.5
        """)
    with pytest.raises(parser.TrainingPlanValidationError):
        parser.parse_training_plan(path)


def test_the_garmin_step_names_the_exercise_and_ends_on_reps():
    payload = _build_step_payload(Step(type="interval", duration_type="reps", duration_value=8, exercise="BODY_WEIGHT_DIP"), 1)
    assert payload["endCondition"]["conditionTypeKey"] == "reps"
    assert payload["endCondition"]["conditionTypeId"] == 10
    assert payload["endConditionValue"] == 8
    assert (payload["category"], payload["exerciseName"]) == ("TRICEPS_EXTENSION", "BODY_WEIGHT_DIP")


def test_a_garmin_strength_step_reads_back_as_exercise_and_reps():
    raw = {
        "type": "ExecutableStepDTO",
        "stepType": {"stepTypeId": 3, "stepTypeKey": "interval"},
        "endCondition": {"conditionTypeId": 10, "conditionTypeKey": "reps"},
        "endConditionValue": 12.0,
        "category": "PUSH_UP",
        "exerciseName": "PUSH_UP",
    }
    step = _parse_workout_step(raw)
    assert (step.duration_type, step.duration_value, step.exercise) == ("reps", 12.0, "PUSH_UP")


def test_note_and_exercise_survive_the_database_round_trip(tmp_path):
    """Steps were stored with their note and exercise but read back without them, so
    neither ever reached Garmin from a saved plan."""
    path = _plan(tmp_path, """\
        - type: interval
          exercise: PLANK
          duration_type: time
          duration_value: 0.75
          note: Bacino in linea
        """)
    (session,) = parser.parse_training_plan(path)
    again = plan_generator.session_from_dict(plan_generator.session_to_dict(session))
    step = again.steps[0]
    assert (step.exercise, step.note) == ("PLANK", "Bacino in linea")
    payload = GarminSync.__new__(GarminSync).build_workout_payload(again)
    sent = payload["workoutSegments"][0]["workoutSteps"][0]
    assert sent["exerciseName"] == "PLANK" and sent["description"] == "Bacino in linea"
    assert payload["sportType"]["sportTypeKey"] == "strength_training"
