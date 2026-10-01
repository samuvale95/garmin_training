from datetime import date, timedelta
from unittest.mock import patch

import pytest

from training_plan import aerobic_efficiency
from training_plan.intensity import Zones

TODAY = date(2026, 9, 20)
ZONES = Zones.from_threshold(165, source="stimato")  # aerobic_hr = 165 * 0.85 = 140


def test_compute_weighted_averages():
    # 10s at 130 bpm & 3 m/s, 20s at 140 bpm & 4 m/s
    hrs = [130.0, 140.0]
    speeds = [3.0, 4.0]
    times = [0.0, 10.0, 30.0]  # first interval 10s, second 20s

    avg_hr, avg_speed, duration = aerobic_efficiency._compute_weighted_averages(hrs, speeds, times)
    assert duration == 30.0
    assert avg_hr == pytest.approx((130.0 * 10 + 140.0 * 20) / 30.0, rel=1e-2)
    assert avg_speed == pytest.approx((3.0 * 10 + 4.0 * 20) / 30.0, rel=1e-2)


def test_is_easy_run():
    # 80% time below aerobic_hr (140)
    hrs = [130.0, 135.0, 150.0]
    times = [0.0, 40.0, 80.0, 100.0]  # 40s at 130, 40s at 135, 20s at 150
    assert aerobic_efficiency._is_easy_run(hrs, times, 140) is True

    # 80% time above aerobic_hr (140)
    hrs_hard = [150.0, 155.0, 130.0]
    assert aerobic_efficiency._is_easy_run(hrs_hard, times, 140) is False


def test_linear_regression_slope():
    # Perfect linear positive slope
    x = [0.0, 10.0, 20.0, 30.0]
    y = [1.0, 2.0, 3.0, 4.0]
    assert aerobic_efficiency._linear_regression_slope(x, y) == pytest.approx(0.1, rel=1e-3)


def test_compute_aerobic_efficiency_with_mock_history():
    # Generate 3 mock runs:
    # Run 1: 30 days ago, 50 min, easy run, EF ~ 3.0 m/s / 135 bpm = 0.0222
    # Run 2: 15 days ago, 60 min, easy run with decoupling, 1st half: 3.3 m/s / 135 bpm, 2nd half: 3.2 m/s / 138 bpm
    # Run 3: 5 days ago, 50 min, easy run, EF ~ 3.3 m/s / 133 bpm = 0.0248 (improved!)
    mock_streams = []

    def make_run(day, duration_sec, hr_base, speed_base, hr_drift=0.0):
        step_s = 5
        n_pts = duration_sec // step_s
        times = [float(i * step_s) for i in range(n_pts)]
        hrs = [float(hr_base + (hr_drift * (i / n_pts))) for i in range(n_pts)]
        speeds = [float(speed_base) for _ in range(n_pts)]
        act = {
            "activity_id": int(day.strftime("%Y%m%d")),
            "source": "garmin",
            "day": day.isoformat(),
            "sport": "running",
            "title": "Corsa Facile",
            "duration_min": duration_sec / 60.0,
            "distance_km": (speed_base * duration_sec) / 1000.0,
        }
        streams = {
            "time": times,
            "heartrate": hrs,
            "velocity_smooth": speeds,
        }
        return act, streams

    mock_streams.append(make_run(TODAY - timedelta(days=28), 3000, 135, 3.0))
    mock_streams.append(make_run(TODAY - timedelta(days=14), 3600, 132, 3.2, hr_drift=4.0))
    mock_streams.append(make_run(TODAY - timedelta(days=4), 3000, 130, 3.2))

    with patch("training_plan.history.streams_between", return_value=mock_streams):
        res = aerobic_efficiency.compute_aerobic_efficiency(
            user_id="test_user",
            lookback_days=60,
            zones=ZONES,
            today=TODAY,
        )

        assert len(res.history) == 3
        # Check trend is improving
        assert res.trend is not None
        assert res.trend.classification == "miglioramento"
        assert res.trend.change_pct > 0

        # Check decoupling was calculated on the 60-min run (>= 45 min)
        decoupling_run = res.history[1]
        assert decoupling_run.decoupling_pct is not None
        # Drift was positive, so decoupling_pct > 0
        assert decoupling_run.decoupling_pct > 0

        # Check findings were generated
        assert len(res.findings) >= 1
        assert any(f.key == "ef_trend" for f in res.findings)
