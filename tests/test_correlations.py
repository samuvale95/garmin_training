from datetime import date, timedelta
from unittest.mock import patch

import pytest

from training_plan import correlations

TODAY = date(2026, 9, 20)


def test_pearson_correlation():
    # Perfect positive
    x = [1.0, 2.0, 3.0, 4.0, 5.0]
    y = [2.0, 4.0, 6.0, 8.0, 10.0]
    r = correlations._pearson_correlation(x, y)
    assert r == pytest.approx(1.0, rel=1e-3)

    # Negative
    y_neg = [10.0, 8.0, 6.0, 4.0, 2.0]
    r_neg = correlations._pearson_correlation(x, y_neg)
    assert r_neg == pytest.approx(-1.0, rel=1e-3)

    # Empty / too small
    assert correlations._pearson_correlation([1.0], [2.0]) is None


def test_correlations_with_mock_data():
    # 8 days of paired data:
    # 4 good nights: 8h sleep, HRV 60ms, run at 4:30/km (speed 3.7 m/s, HR 140 -> EF 0.0264)
    # 4 bad nights: 5.5h sleep, HRV 40ms, run at 4:55/km (speed 3.38 m/s, HR 145 -> EF 0.0233)
    mock_wellness = []
    mock_activities = []

    for i in range(8):
        day = TODAY - timedelta(days=i * 2)
        is_good = (i % 2 == 0)
        sleep_min = 480 if is_good else 330
        hrv = 60.0 if is_good else 40.0
        rhr = 46 if is_good else 53

        speed = 3.70 if is_good else 3.38
        hr = 140.0 if is_good else 145.0
        dur_min = 45.0
        dist_km = (speed * 45 * 60) / 1000.0

        mock_wellness.append({
            "day": day.isoformat(),
            "sleep_total_min": sleep_min,
            "sleep_score": 85 if is_good else 60,
            "hrv_ms": hrv,
            "resting_hr": rhr,
        })
        mock_activities.append({
            "activity_id": 1000 + i,
            "day": day.isoformat(),
            "sport": "running",
            "title": "Corsa",
            "distance_km": dist_km,
            "duration_min": dur_min,
            "avg_hr": hr,
        })

    with patch("training_plan.history.wellness_between", return_value=mock_wellness), \
         patch("training_plan.history.activities_between", return_value=mock_activities), \
         patch("training_plan.checkin.get_range", return_value=[]):

        res = correlations.compute_personal_correlations(
            user_id="test_user",
            lookback_days=30,
            today=TODAY,
        )

        assert res.total_paired_runs == 8
        assert res.status in ("solido", "preliminare")
        assert len(res.insights) >= 2

        # Check sleep insight
        sleep_ins = next((ins for ins in res.insights if ins.metric_x == "sonno"), None)
        assert sleep_ins is not None
        assert sleep_ins.delta_pct is not None
        assert sleep_ins.delta_pct > 0  # good sleep gives higher EF

        # Check HRV insight
        hrv_ins = next((ins for ins in res.insights if ins.metric_x == "hrv"), None)
        assert hrv_ins is not None
