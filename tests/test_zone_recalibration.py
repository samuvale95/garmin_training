from datetime import date, timedelta
from unittest.mock import patch

import pytest

from training_plan import zone_recalibration
from training_plan.intensity import Zones

TODAY = date(2026, 9, 20)


def test_calculate_5_zones():
    lthr = 168
    threshold_pace_sec = 255  # 4:15/km

    zones = zone_recalibration.calculate_5_zones(lthr, threshold_pace_sec)
    assert len(zones) == 5

    # Z1: < 80% LTHR (168 * 0.80 = 134)
    z1 = zones[0]
    assert z1.zone_number == 1
    assert z1.hr_max == 134
    assert z1.pace_min_sec == 300  # 4:15 + 45s = 5:00/km

    # Z4: 94% - 100% LTHR (158 - 168 bpm)
    z4 = zones[3]
    assert z4.zone_number == 4
    assert z4.hr_max == 168
    assert z4.pace_min_sec == 250  # 4:10/km

    # Z5: > 168 bpm
    z5 = zones[4]
    assert z5.zone_number == 5
    assert z5.hr_min == 169


def test_find_best_20min_effort():
    # 30 min run (1800s):
    # First 10 min: 140 bpm, 3.0 m/s
    # Next 20 min: 170 bpm, 3.8 m/s
    times = [float(i) for i in range(1800)]
    hrs = [140.0 if i < 600 else 170.0 for i in range(1800)]
    speeds = [3.0 if i < 600 else 3.8 for i in range(1800)]

    res = zone_recalibration._find_best_20min_effort(hrs, speeds, times)
    assert res is not None
    avg_hr, avg_speed = res
    assert 168.0 <= avg_hr <= 171.0
    assert 3.75 <= avg_speed <= 3.85


def test_recalibrate_zones_with_mock_history():
    # 25 min tempo run with 20 min at 170 bpm & 3.85 m/s (~4:20/km)
    times = [float(i) for i in range(1500)]
    hrs = [170.0 for _ in range(1500)]
    speeds = [3.85 for _ in range(1500)]

    act = {
        "activity_id": 999,
        "source": "garmin",
        "day": TODAY.isoformat(),
        "sport": "running",
        "title": "Medio veloce",
        "duration_min": 25.0,
        "distance_km": 5.7,
    }
    streams = {
        "time": times,
        "heartrate": hrs,
        "velocity_smooth": speeds,
    }

    current_zones = Zones.from_threshold(160, source="garmin")

    with patch("training_plan.history.streams_between", return_value=[(act, streams)]):
        result = zone_recalibration.recalibrate_zones(
            user_id="test_user",
            current_zones=current_zones,
            lookback_days=70,
            today=TODAY,
        )

        assert result.estimated_lthr is not None
        # 170 * 0.95 = 161 or 162
        assert 160 <= result.estimated_lthr <= 165
        assert result.estimated_threshold_pace_sec is not None
        assert len(result.zones) == 5
        assert len(result.supporting_workouts) == 1
        assert result.supporting_workouts[0].activity_id == 999
