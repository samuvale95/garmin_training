import math
from datetime import date, timedelta

import pytest

from training_plan import fitness_fatigue
from training_plan.models import RaceGoal, Step, TrainingSession

TODAY = date(2026, 9, 15)


def test_calculate_activity_load_native_garmin():
    act = {
        "duration_min": 50,
        "summary": {"trainingLoad": 82.5},
    }
    assert fitness_fatigue.calculate_activity_load(act) == 82.5


def test_calculate_activity_load_strava_suffer():
    act = {
        "duration_min": 60,
        "summary": {"suffer_score": 75},
    }
    assert fitness_fatigue.calculate_activity_load(act) == 75.0


def test_calculate_activity_load_heart_rate_trimp():
    # 60 min at 155 bpm (resting 50, max 185 -> delta_hr = 105/135 = 0.777)
    act = {
        "duration_min": 60,
        "avg_hr": 155,
        "max_hr": 185,
        "summary": {},
    }
    load = fitness_fatigue.calculate_activity_load(act, resting_hr=50, max_hr=185)
    assert 60.0 <= load <= 100.0


def test_calculate_activity_load_pace_proxy():
    # 10 km in 50 min = 5:00/km -> rate 60/hr -> load 50
    act = {
        "duration_min": 50,
        "distance_km": 10.0,
        "sport": "running",
        "summary": {},
    }
    load = fitness_fatigue.calculate_activity_load(act)
    assert load == 50.0


def test_calculate_session_load_rest_and_easy():
    rest = TrainingSession(date=TODAY, sport="rest", title="Riposo")
    assert fitness_fatigue.calculate_session_load(rest) == 0.0

    easy = TrainingSession(
        date=TODAY,
        sport="running",
        title="Corsa Facile 45'",
        steps=[Step(type="interval", duration_type="time", duration_value=45)],
    )
    load = fitness_fatigue.calculate_session_load(easy)
    assert 30.0 <= load <= 40.0


def test_calculate_session_load_intervals_and_long():
    repeats = TrainingSession(
        date=TODAY,
        sport="running",
        title="Ripetute 6x1000",
        steps=[Step(type="interval", duration_type="time", duration_value=60)],
    )
    long_run = TrainingSession(
        date=TODAY,
        sport="running",
        title="Lungo 25 km",
        steps=[Step(type="interval", duration_type="time", duration_value=120)],
    )
    assert fitness_fatigue.calculate_session_load(repeats) == 75.0
    assert fitness_fatigue.calculate_session_load(long_run) == 130.0


def test_classify_tsb_bands():
    assert fitness_fatigue.classify_tsb(-30.0).key == fitness_fatigue.STATUS_OVERREACHING
    assert fitness_fatigue.classify_tsb(-18.0).key == fitness_fatigue.STATUS_OPTIMAL
    assert fitness_fatigue.classify_tsb(0.0).key == fitness_fatigue.STATUS_NEUTRAL
    assert fitness_fatigue.classify_tsb(12.0).key == fitness_fatigue.STATUS_FRESHNESS
    assert fitness_fatigue.classify_tsb(25.0).key == fitness_fatigue.STATUS_DETRAINING


def test_compute_fitness_fatigue_timeline_progression():
    activities = [
        {"day": TODAY - timedelta(days=i), "duration_min": 60, "summary": {"trainingLoad": 60.0}}
        for i in range(30, 0, -1)
    ]
    # Today rest
    planned = [
        TrainingSession(
            date=TODAY + timedelta(days=1),
            sport="running",
            title="Facile 40'",
            steps=[Step(type="interval", duration_type="time", duration_value=40)],
        ),
        TrainingSession(
            date=TODAY + timedelta(days=3),
            sport="running",
            title="Lungo 90'",
            steps=[Step(type="interval", duration_type="time", duration_value=90)],
        ),
    ]

    goal = RaceGoal(race_date=TODAY + timedelta(days=21), distance_km=42.195, name="Venice Marathon")

    result = fitness_fatigue.compute_fitness_fatigue_timeline(
        activities=activities,
        planned_sessions=planned,
        goal=goal,
        today=TODAY,
        lookback_days=30,
    )

    assert result.current.date == TODAY
    assert result.current.ctl > 0
    assert result.current.atl > 0
    assert len(result.history) == 31  # 30 days lookback + today
    assert len(result.projection) >= 21  # up to race date
    assert result.race_assessment is not None
    assert result.race_assessment.race_name == "Venice Marathon"
    assert result.race_assessment.days_to_race == 21
    # Because planned sessions in the last 2 weeks are very light, projected TSB should rise
    assert result.race_assessment.projected_tsb > result.current.tsb


def test_compute_fitness_fatigue_tapering_evaluates_verdict():
    # If athlete stops all training 10 days before race, TSB becomes very fresh
    goal = RaceGoal(race_date=TODAY + timedelta(days=10), distance_km=42.195, name="Venice Marathon")
    activities = [
        {"day": TODAY - timedelta(days=i), "duration_min": 60, "summary": {"trainingLoad": 80.0}}
        for i in range(20, 0, -1)
    ]
    # Very light shakeout planned
    planned = [
        TrainingSession(
            date=TODAY + timedelta(days=2),
            sport="running",
            title="Scarico 20'",
            steps=[Step(type="interval", duration_type="time", duration_value=20)],
        )
    ]

    result = fitness_fatigue.compute_fitness_fatigue_timeline(
        activities=activities,
        planned_sessions=planned,
        goal=goal,
        today=TODAY,
        lookback_days=20,
    )

    assessment = result.race_assessment
    assert assessment is not None
    assert assessment.days_to_race == 10
    assert assessment.projected_tsb > 0
    assert "Gara" in assessment.advice or "Venice" in assessment.advice
