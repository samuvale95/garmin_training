from datetime import date
from uuid import uuid4

import pytest

from training_plan import db, history, plan_export, plan_store
from training_plan.models import PaceTarget, Step, TrainingSession
from training_plan.parser import parse_plan_document


@pytest.fixture(autouse=True)
def clean_db():
    db.ensure_schema()
    plan_store.ensure_schema()
    yield


def test_enriched_export_and_roundtrip_parsing(tmp_path):
    user_id = f"test-export-{uuid4().hex[:8]}"

    # Store a plan with running and strength sessions
    db.save_plan(
        user_id=user_id,
        yaml_text="",
        filename="test.yaml",
        imported_at="2026-10-28",
        goal={"race_date": "2026-11-29", "distance_km": 42.195, "name": "Firenze Marathon"},
        name="Preparazione Maratona",
        sports=["running", "strength_training"],
    )

    today = date.today()
    yesterday = date.fromordinal(today.toordinal() - 1)
    tomorrow = date.fromordinal(today.toordinal() + 1)

    plan_store.import_sessions(
        user_id,
        [
            {
                "date": yesterday.isoformat(),
                "sport": "running",
                "title": "Fondo Medio 12km",
                "description": "Corsa a ritmo sostenuto",
                "steps": [
                    {
                        "type": "interval",
                        "duration_type": "distance",
                        "duration_value": 12.0,
                        "target_pace": "4:45-4:55",
                    }
                ],
            },
            {
                "date": tomorrow.isoformat(),
                "sport": "strength_training",
                "title": "Forza e Core",
                "description": "Potenziamento a corpo libero e pesi leggeri",
                "steps": [
                    {
                        "type": "interval",
                        "duration_type": "time",
                        "duration_value": 45.0,
                    }
                ],
            },
        ],
    )

    # Fake a completed activity yesterday in history
    start_dt = f"{yesterday.isoformat()}T07:30:00Z"
    with db.connect() as conn:
        conn.execute(
            """INSERT INTO activity
               (user_id, activity_id, source, day, start_time, sport, title, distance_km, duration_min, avg_hr, max_hr)
               VALUES (%s, 999111, 'garmin', %s, %s, 'running', 'Corsa mattutina', 12.15, 58.2, 155, 172)
               ON CONFLICT DO NOTHING""",
            (user_id, yesterday.isoformat(), start_dt),
        )

    # 1. Build enriched dictionary
    data = plan_export.build_enriched_plan_dict(user_id)

    assert "athlete_context" in data
    assert "weekly_load_summary" in data
    assert data["goal"]["name"] == "Firenze Marathon"
    assert len(data["sessions"]) == 2

    # Check that yesterday's session has the executed block
    yesterday_sess = next(s for s in data["sessions"] if s["date"] == yesterday.isoformat())
    assert "executed" in yesterday_sess
    assert yesterday_sess["executed"]["status"] == "completed"
    assert yesterday_sess["executed"]["activity_title"] == "Corsa mattutina"
    assert yesterday_sess["executed"]["actual_distance_km"] == 12.15

    # 2. Serialize to enriched YAML
    yaml_text = plan_export.serialize_enriched_plan_yaml(data)
    assert "athlete_context:" in yaml_text
    assert "weekly_load_summary:" in yaml_text
    assert "executed:" in yaml_text

    # 3. Round-trip test: ensure standard parser parses it cleanly!
    export_file = tmp_path / "enriched_export.yaml"
    export_file.write_text(yaml_text)

    parsed = parse_plan_document(export_file)
    assert len(parsed.sessions) == 2
    assert parsed.goal is not None
    assert parsed.goal.name == "Firenze Marathon"
    assert parsed.sessions[0].title == "Fondo Medio 12km"
    assert parsed.sessions[1].sport == "strength_training"

    # Clean up
    db.delete_plan(user_id)
