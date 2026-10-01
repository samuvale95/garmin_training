from datetime import date, timedelta

import pytest

from training_plan import race_prediction
from training_plan.models import RaceGoal, Step, TrainingSession

TODAY = date(2026, 9, 20)
RACE_DATE = date(2026, 10, 25)  # Venice Marathon (~5 weeks out)

GOAL_MARATHON = RaceGoal(
    name="Maratona di Venezia",
    race_date=RACE_DATE,
    distance_km=42.195,
    target_time_seconds=12600,  # 3h30m (210 min = 12600s)
)


def test_riegel_formula():
    # 10 km in 45 min (2700s) -> Marathon (42.195 km)
    # T2 = 2700 * (42.195 / 10)^1.06 ~= 2700 * 4.605 ~= 12435s (~3h27m)
    t_marathon = race_prediction.calculate_riegel_time(10.0, 2700.0, 42.195)
    assert 12000 <= t_marathon <= 13000
    assert 3.3 <= t_marathon / 3600.0 <= 3.6


def test_honest_failure_mode_no_quality_runs():
    # Only short 3 km easy runs in the last 8 weeks
    short_runs = [
        {
            "activity_id": 101,
            "day": (TODAY - timedelta(days=5)).isoformat(),
            "sport": "running",
            "title": "Trotto breve",
            "distance_km": 3.0,
            "duration_min": 20.0,
            "avg_hr": 125,
        }
    ]

    res = race_prediction.assess_race_prediction(
        activities=short_runs,
        goal=GOAL_MARATHON,
        today=TODAY,
    )

    assert res.confidence == race_prediction.CONFIDENCE_UNKNOWN
    assert res.predicted_time_seconds is None
    assert any(f.key == "no_efforts" for f in res.factors)
    assert "Mancano sforzi ad alta intensità" in res.verdict


def test_race_prediction_with_qualifying_effort():
    # Fast 15 km run (70 min = 4:40/km) and a 30 km long run
    activities = [
        {
            "activity_id": 201,
            "day": (TODAY - timedelta(days=14)).isoformat(),
            "sport": "running",
            "title": "Medio 15k",
            "distance_km": 15.0,
            "duration_min": 70.0,
            "avg_hr": 158,
        },
        {
            "activity_id": 202,
            "day": (TODAY - timedelta(days=7)).isoformat(),
            "sport": "running",
            "title": "Lungo 30k",
            "distance_km": 30.0,
            "duration_min": 160.0,
            "avg_hr": 142,
        },
    ]

    # Planned sessions to check adherence
    planned = [
        TrainingSession(
            date=TODAY - timedelta(days=14),
            sport="running",
            title="Medio 15k",
            steps=[Step(type="interval", duration_type="distance", duration_value=15.0)],
        ),
        TrainingSession(
            date=TODAY - timedelta(days=7),
            sport="running",
            title="Lungo 30k",
            steps=[Step(type="interval", duration_type="distance", duration_value=30.0)],
        ),
    ]

    res = race_prediction.assess_race_prediction(
        activities=activities,
        goal=GOAL_MARATHON,
        planned_sessions=planned,
        today=TODAY,
        vo2max=52.0,
    )

    assert res.predicted_time_seconds is not None
    # 15km in 70min -> Marathon should be ~3h28m (approx 12500s)
    assert 11500 <= res.predicted_time_seconds <= 13500
    assert res.predicted_pace_sec_km is not None
    assert res.reference_effort is not None
    assert res.reference_effort.distance_km == 15.0
    assert res.longest_completed_km == 30.0
    assert res.confidence in (race_prediction.CONFIDENCE_HIGH, race_prediction.CONFIDENCE_MEDIUM)
    assert res.confidence_score >= 60

    # Target comparison
    assert res.target_time_seconds == 12600
    assert res.gap_seconds is not None
