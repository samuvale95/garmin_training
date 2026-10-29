from datetime import date
from uuid import uuid4
import pytest
from training_plan.models import (
    Step,
    RepeatBlock,
    ShortVariant,
    TrainingSession,
    session_distance_km,
    session_duration_minutes,
)
from training_plan.parser import parse_sessions, serialize_plan
from training_plan import plan_store


def test_short_variant_yaml_parsing_and_serialization():
    raw_sessions = [
        {
            "date": "2026-11-04",
            "sport": "calisthenics",
            "title": "Parco: Trazioni e Dip",
            "priority": "flexible",
            "min_duration_minutes": 25,
            "steps": [
                {
                    "type": "warmup",
                    "duration_type": "time",
                    "duration_value": 8,
                    "note": "Mobilità scapole e polsi",
                },
                {
                    "repeat": 4,
                    "steps": [
                        {
                            "type": "interval",
                            "duration_type": "time",
                            "duration_value": 1.5,
                            "note": "Trazioni alla sbarra",
                        },
                        {
                            "type": "rest",
                            "duration_type": "time",
                            "duration_value": 2.0,
                        },
                    ],
                },
            ],
            "short_variant": {
                "title": "Parco Express Superset (20')",
                "description": "Superserie senza pause intermedie",
                "steps": [
                    {
                        "type": "warmup",
                        "duration_type": "time",
                        "duration_value": 5,
                    },
                    {
                        "repeat": 3,
                        "steps": [
                            {
                                "type": "interval",
                                "duration_type": "time",
                                "duration_value": 2,
                                "note": "Superset Trazioni + Dip",
                            },
                            {
                                "type": "rest",
                                "duration_type": "time",
                                "duration_value": 1.5,
                            },
                        ],
                    },
                ],
            },
        }
    ]

    sessions, errors = parse_sessions(raw_sessions)
    assert not errors
    assert len(sessions) == 1
    sess = sessions[0]

    assert sess.sport == "calisthenics"
    assert sess.priority == "flexible"
    assert sess.min_duration_minutes == 25.0
    assert sess.short_variant is not None
    assert sess.short_variant.title == "Parco Express Superset (20')"
    assert len(sess.short_variant.steps) == 2
    assert sess.steps[0].note == "Mobilità scapole e polsi"

    # Distances
    assert session_distance_km(sess) == 0.0

    # Serialization round-trip
    yaml_text = serialize_plan(sessions)
    assert "calisthenics" in yaml_text
    assert "short_variant:" in yaml_text
    assert "Parco Express Superset" in yaml_text
    assert "Mobilità scapole e polsi" in yaml_text


def test_cycling_distance_modeling():
    session = TrainingSession(
        date=date(2026, 11, 5),
        sport="cycling",
        title="Uscita Z2 Bici",
        steps=[
            Step(type="interval", duration_type="time", duration_value=60.0),
        ],
    )
    # 60 min cycling at 25 km/h = 25 km
    assert session_distance_km(session) == 25.0
    assert session_duration_minutes(session) == 60.0


def test_effective_properties_and_store_toggle():
    user_id = f"test-sv-{uuid4().hex[:8]}"
    plan_store.ensure_schema()
    sess_dict = {
        "date": "2026-11-06",
        "sport": "running",
        "title": "Corsa facile 50'",
        "description": "Corsa continua Z2",
        "steps": [
            {"type": "interval", "duration_type": "time", "duration_value": 50.0}
        ],
        "short_variant": {
            "title": "Corsa facile (ridotta 30')",
            "description": "Variante salva-tempo 30'",
            "steps": [
                {"type": "interval", "duration_type": "time", "duration_value": 30.0}
            ],
        },
        "is_short_active": False,
    }

    created = plan_store.create_session(user_id, sess_dict, origin="manual")
    assert not created["is_short_active"]
    assert created["short_variant"]["title"] == "Corsa facile (ridotta 30')"

    # Toggle short variant
    updated = plan_store.toggle_short_variant(user_id, created["id"])
    assert updated["is_short_active"] is True

    # Toggle back
    updated2 = plan_store.toggle_short_variant(user_id, created["id"])
    assert updated2["is_short_active"] is False
