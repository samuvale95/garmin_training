"""Swimming and cycling steps, from the plan file to Garmin and back."""

import textwrap

import pytest

from training_plan import parser, plan_generator
from training_plan.garmin_sync import GarminSync, _build_step_payload, _parse_workout_step
from training_plan.models import Step, TargetRange, session_distance_km, session_duration_minutes

SWIM = """\
sessions:
  - date: 2026-11-06
    sport: swimming
    title: Piscina · 8×100
    pool_length: 50
    steps:
      - type: warmup
        meters: 300
        stroke: libero
      - repeat: 8
        steps:
          - type: interval
            meters: 100
            stroke: free
            note: 1:50/100 m
          - type: rest
            duration_type: time
            duration_value: 0.33
      - type: interval
        meters: 200
        stroke: libero
        equipment: pull buoy
      - type: cooldown
        meters: 100
        stroke: dorso
"""

BIKE = """\
sessions:
  - date: 2026-11-07
    sport: cycling
    title: Rulli · 3×10' soglia
    steps:
      - type: warmup
        duration_type: time
        duration_value: 15
        target_hr: 120-135
      - repeat: 3
        steps:
          - type: interval
            duration_type: time
            duration_value: 10
            target_power: 220-240
            target_cadence: 85-95
          - type: recovery
            duration_type: time
            duration_value: 5
            target_power: 130
      - type: cooldown
        duration_type: time
        duration_value: 10
"""


def _parse(tmp_path, text):
    path = tmp_path / "plan.yaml"
    path.write_text(text)
    return parser.parse_training_plan(path)


def test_a_swim_is_read_with_metres_strokes_equipment_and_pool(tmp_path):
    (swim,) = _parse(tmp_path, SWIM)
    assert swim.pool_length_m == 50
    warmup, block, pull, cooldown = swim.steps
    assert (warmup.duration_type, warmup.duration_value, warmup.stroke) == ("distance", 0.3, "free")
    assert block.reps == 8 and block.steps[0].duration_value == 0.1
    assert (pull.stroke, pull.equipment) == ("free", "pull_buoy")
    assert cooldown.stroke == "backstroke"
    assert session_distance_km(swim) == pytest.approx(1.4)
    assert 25 < session_duration_minutes(swim) < 35  # metres at a swim, not a running pace


def test_the_swim_reaches_garmin_with_the_pool_and_strokes(tmp_path):
    (swim,) = _parse(tmp_path, SWIM)
    payload = GarminSync.__new__(GarminSync).build_workout_payload(swim)
    assert payload["sportType"]["sportTypeKey"] == "swimming"
    assert payload["poolLength"] == 50.0 and payload["poolLengthUnit"]["unitKey"] == "meter"
    steps = payload["workoutSegments"][0]["workoutSteps"]
    assert steps[0]["endConditionValue"] == 300 and steps[0]["strokeType"]["strokeTypeKey"] == "free"
    assert steps[2]["equipmentType"]["equipmentTypeKey"] == "pull_buoy"


def test_a_swim_without_a_pool_goes_to_garmin_as_25_metres(tmp_path):
    (swim,) = _parse(tmp_path, SWIM.replace("    pool_length: 50\n", ""))
    assert GarminSync.__new__(GarminSync).build_workout_payload(swim)["poolLength"] == 25.0


def test_a_bike_session_carries_watts_heart_rate_and_cadence(tmp_path):
    (bike,) = _parse(tmp_path, BIKE)
    warmup, block, _ = bike.steps
    assert warmup.target_hr == TargetRange(120, 135)
    work, recovery = block.steps
    assert work.target_power == TargetRange(220, 240) and work.target_cadence == TargetRange(85, 95)
    assert recovery.target_power == TargetRange(124, 136)  # a single 130 W widened by 5%
    payload = GarminSync.__new__(GarminSync).build_workout_payload(bike)
    steps = payload["workoutSegments"][0]["workoutSteps"]
    assert steps[0]["targetType"]["workoutTargetTypeKey"] == "heart.rate.zone"
    sent = steps[1]["workoutSteps"][0]
    # Power is the primary target, cadence the secondary: "220-240 W at 85-95 rpm".
    assert sent["targetType"]["workoutTargetTypeKey"] == "power.zone"
    assert (sent["targetValueOne"], sent["targetValueTwo"]) == (220.0, 240.0)
    assert sent["secondaryTargetType"]["workoutTargetTypeKey"] == "cadence"
    assert (sent["secondaryTargetValueOne"], sent["secondaryTargetValueTwo"]) == (85.0, 95.0)
    assert _parse_workout_step(sent) == work


def test_targets_strokes_and_equipment_read_back_from_garmin():
    for step in (
        Step("interval", "time", 10, target_power=TargetRange(220, 240)),
        Step("warmup", "time", 15, target_hr=TargetRange(120, 135)),
        Step("interval", "distance", 0.1, stroke="free", equipment="pull_buoy"),
    ):
        assert _parse_workout_step(_build_step_payload(step, 1)) == step


@pytest.mark.parametrize("bad", ["stroke: crawlino", "equipment: ciambella", "target_power: tanto"])
def test_unknown_values_are_refused(tmp_path, bad):
    text = BIKE.replace("        target_hr: 120-135", "        " + bad)
    with pytest.raises(parser.TrainingPlanValidationError):
        _parse(tmp_path, text)


def test_everything_survives_the_database_and_the_export(tmp_path):
    for text in (SWIM, BIKE):
        (session,) = _parse(tmp_path, text)
        assert plan_generator.session_from_dict(plan_generator.session_to_dict(session)) == session
        exported = tmp_path / "export.yaml"
        exported.write_text(parser.serialize_plan([session]))
        assert parser.parse_training_plan(exported) == [session]


def test_the_generator_accepts_requested_swims_and_rides():
    import json
    from training_plan import plan_generator as gen
    from tests.test_plan_generator import window

    w = window()
    w.sports = ("running", "swimming", "cycling")
    runs = gen.compose_fallback(w)
    day = runs[0].date.isoformat()
    raw = json.dumps({"sessions": [
        {"date": day, "sport": "swimming", "title": "Piscina", "steps": [
            {"type": "warmup", "meters": 300, "stroke": "free"},
            {"repeat": 8, "steps": [
                {"type": "interval", "meters": 100, "stroke": "free", "note": "1:55/100 m"},
                {"type": "rest", "duration_type": "time", "duration_value": 0.33},
            ]},
        ]},
    ]})
    swims, errors = gen.parse_proposal(raw)
    assert errors == []
    assert gen.check([*runs, *swims], w) == []
