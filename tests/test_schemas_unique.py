"""Two classes with one name in schemas.py: the second silently replaces the first, and
every `from_model` of the first breaks at runtime. That took /coach/plan down."""

import ast
from collections import Counter
from pathlib import Path

from training_plan.api import schemas


def test_no_class_is_defined_twice():
    tree = ast.parse(Path(schemas.__file__).read_text())
    names = Counter(node.name for node in tree.body if isinstance(node, ast.ClassDef))
    assert [name for name, count in names.items() if count > 1] == []


def test_the_coach_plan_finding_can_be_built():
    assert hasattr(schemas.FindingOut, "from_model")
