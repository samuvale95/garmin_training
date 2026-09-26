"""The YAML file is the import and the export: whatever goes out comes back the same."""

from pathlib import Path

import pytest

from training_plan.parser import parse_plan_document, serialize_plan

EXAMPLES = sorted((Path(__file__).parent.parent / "examples").glob("*.yaml"))


@pytest.mark.parametrize("path", EXAMPLES, ids=[p.name for p in EXAMPLES])
def test_every_example_plan_round_trips(path, tmp_path):
    original = parse_plan_document(path)

    exported = tmp_path / "export.yaml"
    exported.write_text(serialize_plan(original.sessions, original.goal))
    again = parse_plan_document(exported)

    assert again.sessions == original.sessions
    assert again.goal == original.goal


def test_the_export_reads_like_the_import(tmp_path):
    """Plain keys a person can edit, not a dump of Python objects."""
    original = parse_plan_document(EXAMPLES[0])
    text = serialize_plan(original.sessions, original.goal)
    assert "!!python" not in text
    assert text.lstrip().startswith(("goal:", "sessions:"))
