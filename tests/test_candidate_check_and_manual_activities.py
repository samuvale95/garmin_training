import pytest
from datetime import date
from training_plan.models import TrainingSession, Step
from training_plan.move_check import check_candidate_session
from training_plan.plan_rules import RuleContext
from training_plan.plan_store import generate_fallback_short_variant


def test_check_candidate_session_calisthenics_consecutive_triggers_warning():
    today = date(2026, 11, 2)
    ctx = RuleContext(
        effective_level=1,
        recent_weekly_minutes=150.0,
        recent_longest_run=60.0,
        today=today,
    )
    # Stored plan already has calisthenics on Monday Nov 2
    stored = [
        {
            "id": "s-monday",
            "date": "2026-11-02",
            "sport": "calisthenics",
            "title": "Trazioni e dip",
            "steps": [],
        }
    ]

    # Candidate session is calisthenics on Tuesday Nov 3
    candidate = TrainingSession(
        date=date(2026, 11, 3),
        sport="calisthenics",
        title="Skills calisthenics",
        steps=[Step(type="interval", duration_type="time", duration_value=30)],
    )

    warnings = check_candidate_session(
        candidate=candidate,
        session_id="candidate",
        stored=stored,
        days=[],
        checkins=[],
        context=ctx,
        today=today,
    )

    assert any(w.key == "strength_in_a_row" for w in warnings)
    warn = next(w for w in warnings if w.key == "strength_in_a_row")
    assert "consecutive" in warn.message


def test_generate_fallback_short_variant_running():
    session = {
        "title": "Corsa facile 50'",
        "sport": "running",
        "steps": [
            {"type": "interval", "duration_type": "time", "duration_value": 50, "target_pace": "5:30"}
        ],
    }
    short = generate_fallback_short_variant(session)
    assert short is not None
    assert "ridotta" in short["title"]
    assert len(short["steps"]) > 0
    assert short["steps"][0]["duration_value"] <= 30


def test_generate_fallback_short_variant_calisthenics():
    session = {
        "title": "Workout calisthenics 45'",
        "sport": "calisthenics",
        "steps": [
            {"type": "interval", "duration_type": "time", "duration_value": 45}
        ],
    }
    short = generate_fallback_short_variant(session)
    assert short is not None
    assert "25" in short["title"] or "express" in short["title"]
