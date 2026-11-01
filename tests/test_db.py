"""Food diary storage, against Postgres.

Rewritten from the SQLite-era file (a per-test data directory, photos saved as files,
no user): entries are now per user, and a photo travels as a thumbnail on the row, so
there is no file left to clean up when an entry goes. Each test gets its own user id,
which keeps them independent on a shared database.
"""

import os
import uuid
from datetime import date

import pytest

from training_plan import db

pytestmark = pytest.mark.skipif(not os.getenv("DATABASE_URL"), reason="needs Postgres (DATABASE_URL)")


@pytest.fixture
def user():
    db.ensure_schema()
    return f"test-{uuid.uuid4().hex}"


def _entry(user, **overrides):
    fields = {
        "user_id": user,
        "date": "2026-08-10",
        "source": "photo",
        "description": "pasta al pomodoro",
        "kcal": 620.0,
        "carb_g": 95.0,
        "protein_g": 20.0,
        "fat_g": 15.0,
        "confidence": "medium",
    }
    fields.update(overrides)
    return db.add_entry(**fields)


def test_an_entry_is_stored_and_read_back(user):
    entry = _entry(user)
    assert entry.id > 0
    assert db.get_entry(user, entry.id).description == "pasta al pomodoro"


def test_entries_belong_to_their_user(user):
    entry = _entry(user)
    assert db.get_entry(f"{user}-other", entry.id) is None
    assert db.entries_for_date(f"{user}-other", "2026-08-10") == []


def test_entries_come_back_for_their_day_only(user):
    _entry(user)
    _entry(user, date="2026-08-11")
    assert [e.date for e in db.entries_for_date(user, "2026-08-10")] == ["2026-08-10"]


def test_totals_sum_the_day(user):
    _entry(user, carb_g=95.0, protein_g=20.0)
    _entry(user, carb_g=40.0, protein_g=30.0)
    totals = db.totals_for_date(user, "2026-08-10")
    assert totals["carb_g"] == 135.0
    assert totals["protein_g"] == 50.0
    assert totals["entries"] == 2


def test_a_partly_filled_entry_still_counts(user):
    """A manual entry with only carbohydrates typed in is a real entry, not a null row."""
    _entry(user, source="manual", kcal=None, protein_g=None, fat_g=None, carb_g=60.0)
    totals = db.totals_for_date(user, "2026-08-10")
    assert totals["carb_g"] == 60.0
    assert totals["kcal"] == 0
    assert totals["entries"] == 1


def test_an_edit_marks_the_entry_as_corrected(user):
    """The flag is the point of the operation as much as the number is: it is what
    separates a figure a human confirmed from one a model guessed."""
    entry = _entry(user)
    assert entry.corrected is False
    updated = db.update_entry(user, entry.id, carb_g=120.0)
    assert updated.carb_g == 120.0
    assert updated.corrected is True


def test_an_edit_leaves_untouched_fields_alone(user):
    entry = _entry(user)
    updated = db.update_entry(user, entry.id, carb_g=120.0)
    assert updated.protein_g == 20.0
    assert updated.description == "pasta al pomodoro"


def test_an_edit_cannot_rewrite_where_the_entry_came_from(user):
    """An edit changes what was eaten, never when it was logged or how it got here."""
    entry = _entry(user)
    updated = db.update_entry(user, entry.id, source="manual", date="2020-01-01", logged_at="x")
    assert updated.source == "photo"
    assert updated.date == "2026-08-10"
    assert updated.logged_at == entry.logged_at


def test_editing_a_missing_entry_returns_none(user):
    assert db.update_entry(user, 999_999_999, carb_g=10.0) is None


def test_deleting_removes_the_entry(user):
    entry = _entry(user, thumbnail=b"jpeg-bytes")
    assert db.delete_entry(user, entry.id) is True
    assert db.get_entry(user, entry.id) is None


def test_deleting_a_missing_entry_is_false_not_an_error(user):
    assert db.delete_entry(user, 999_999_999) is False


def test_history_includes_the_days_with_nothing_logged(user):
    """A chart that silently skipped the days you forgot to log would be a flattering
    lie about exactly the thing it exists to show."""
    _entry(user, date="2026-08-10", carb_g=95.0)
    days = db.totals_between(user, date(2026, 8, 8), date(2026, 8, 11))
    assert [d["date"] for d in days] == ["2026-08-08", "2026-08-09", "2026-08-10", "2026-08-11"]
    assert [d["entries"] for d in days] == [0, 0, 1, 0]
    assert days[2]["carb_g"] == 95.0
