"""Unit tests for rolling ACWR calculation and injury prevention limits."""

from datetime import date, timedelta

import pytest

from training_plan import move_check, plan_limits, plan_rules
from training_plan.models import Step, TrainingSession
from training_plan.plan_rules import RuleContext

TODAY = date(2026, 9, 28)  # Monday


def _session(day: date, minutes: int, title: str = "Corsa") -> TrainingSession:
    return TrainingSession(
        date=day,
        sport="running",
        title=title,
        steps=[Step(type="interval", duration_type="time", duration_value=minutes)],
    )


def test_calculate_acwr_returns_ratio():
    assert plan_limits.calculate_acwr(150.0, 150.0) == 1.00
    assert plan_limits.calculate_acwr(213.0, 150.0) == 1.42
    assert plan_limits.calculate_acwr(230.0, 150.0) == 1.53


def test_calculate_acwr_with_insufficient_chronic_baseline():
    assert plan_limits.calculate_acwr(100.0, None) is None
    assert plan_limits.calculate_acwr(100.0, 5.0) is None  # < 10 min/week


def test_assess_acwr_categorizes_correctly():
    assert plan_limits.assess_acwr(None) == plan_limits.STATUS_UNKNOWN
    assert plan_limits.assess_acwr(0.60) == plan_limits.STATUS_UNDERLOAD
    assert plan_limits.assess_acwr(1.10) == plan_limits.STATUS_SAFE
    assert plan_limits.assess_acwr(1.40) == plan_limits.STATUS_HIGH
    assert plan_limits.assess_acwr(1.55) == plan_limits.STATUS_EXCESSIVE


def test_calculate_rolling_acwr_from_daily_series():
    # 28 days of 20 min/day -> chronic = 140 min/week
    daily = {TODAY - timedelta(days=27 - i): 20.0 for i in range(28)}
    # But last 7 days were 35 min/day -> acute = 245 min
    for i in range(7):
        daily[TODAY - timedelta(days=6 - i)] = 35.0

    acwr, acute, chronic = plan_limits.calculate_rolling_acwr(daily, TODAY)
    assert chronic == 166.2
    assert acute == 245.0
    assert acwr == 1.47


def test_safe_workload_within_acwr_limits_generates_no_violations():
    # Chronic baseline: 150 min/week
    ctx = RuleContext(effective_level=2, recent_weekly_minutes=150.0, recent_longest_run=60.0, today=TODAY)
    # Plan 3 sessions totaling 150 minutes in the week -> ACWR = 1.00
    sessions = [
        _session(TODAY + timedelta(days=1), 50, "Martedì"),
        _session(TODAY + timedelta(days=3), 40, "Giovedì"),
        _session(TODAY + timedelta(days=5), 60, "Sabato"),
    ]
    violations = plan_rules.validate(sessions, ctx)
    assert not any(v.key in ("acwr_high", "acwr_excessive") for v in violations)


def test_acute_spike_above_1_35_triggers_acwr_high():
    # Chronic baseline: 150 min/week
    ctx = RuleContext(effective_level=2, recent_weekly_minutes=150.0, recent_longest_run=75.0, today=TODAY)
    # Plan sessions totaling 213 minutes in a 7-day window -> ACWR = 213/150 = 1.42
    sessions = [
        _session(TODAY + timedelta(days=1), 55, "Martedì"),
        _session(TODAY + timedelta(days=3), 50, "Giovedì"),
        _session(TODAY + timedelta(days=4), 38, "Venerdì"),
        _session(TODAY + timedelta(days=6), 70, "Domenica"),
    ]
    violations = plan_rules.validate(sessions, ctx)
    acwr_violations = [v for v in violations if v.key == "acwr_high"]
    assert len(acwr_violations) == 1
    assert acwr_violations[0].warn_on_move is True
    assert "1.42" in acwr_violations[0].message
    assert "1.35" in acwr_violations[0].message


def test_acute_spike_above_1_50_triggers_acwr_excessive():
    # Chronic baseline: 150 min/week
    ctx = RuleContext(effective_level=2, recent_weekly_minutes=150.0, recent_longest_run=80.0, today=TODAY)
    # Plan sessions totaling 230 minutes in a 7-day window -> ACWR = 230/150 = 1.53
    sessions = [
        _session(TODAY + timedelta(days=1), 60, "Martedì"),
        _session(TODAY + timedelta(days=3), 50, "Giovedì"),
        _session(TODAY + timedelta(days=4), 45, "Venerdì"),
        _session(TODAY + timedelta(days=6), 75, "Domenica"),
    ]
    violations = plan_rules.validate(sessions, ctx)
    acwr_violations = [v for v in violations if v.key == "acwr_excessive"]
    assert len(acwr_violations) == 1
    assert acwr_violations[0].warn_on_move is True
    assert "1.53" in acwr_violations[0].message
    assert "1.50" in acwr_violations[0].message
    assert "infortuni" in acwr_violations[0].message


def test_rescheduling_workout_causing_acwr_spike_is_flagged_in_move_check():
    ctx = RuleContext(effective_level=2, recent_weekly_minutes=140.0, recent_longest_run=70.0, today=TODAY)
    # Stored plan has an easy run on Tuesday and a long run next Sunday
    stored = [
        {
            "id": "tue", "date": (TODAY + timedelta(days=1)).isoformat(), "sport": "running", "title": "Facile 40'",
            "steps": [{"type": "interval", "duration_type": "time", "duration_value": 40}],
        },
        {
            "id": "thu", "date": (TODAY + timedelta(days=3)).isoformat(), "sport": "running", "title": "Medio 50'",
            "steps": [{"type": "interval", "duration_type": "time", "duration_value": 50}],
        },
        {
            "id": "sat", "date": (TODAY + timedelta(days=5)).isoformat(), "sport": "running", "title": "Progressione 50'",
            "steps": [{"type": "interval", "duration_type": "time", "duration_value": 50}],
        },
        {
            "id": "next_sun", "date": (TODAY + timedelta(days=13)).isoformat(), "sport": "running", "title": "Lungo 75'",
            "steps": [{"type": "interval", "duration_type": "time", "duration_value": 75}],
        },
    ]
    # Move next_sun from day 13 to day 6 (Sunday of this week):
    # This week's volume goes from 140' to 215' (215/140 = 1.54 ACWR -> acwr_excessive)
    result = move_check.check_move(
        session_id="next_sun",
        new_date=TODAY + timedelta(days=6),
        stored=stored,
        days=[],
        checkins=[],
        context=ctx,
        today=TODAY,
    )
    acwr_warnings = [w for w in result.warnings if w.key in ("acwr_high", "acwr_excessive")]
    assert len(acwr_warnings) == 1
    assert "acuto" in acwr_warnings[0].message
