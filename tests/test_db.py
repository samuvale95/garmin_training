from datetime import date
from pathlib import Path

from training_plan import db


def _entry(**overrides):
    fields = {
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


def test_a_fresh_install_creates_its_own_schema():
    """No migration step, no setup command: the first write makes the database."""
    entry = _entry()
    assert entry.id > 0
    assert db.db_path().exists()


def test_entries_come_back_for_their_day_only():
    _entry()
    _entry(date="2026-08-11")
    assert [e.date for e in db.entries_for_date("2026-08-10")] == ["2026-08-10"]


def test_totals_sum_the_day():
    _entry(carb_g=95.0, protein_g=20.0)
    _entry(carb_g=40.0, protein_g=30.0)
    totals = db.totals_for_date("2026-08-10")
    assert totals["carb_g"] == 135.0
    assert totals["protein_g"] == 50.0
    assert totals["entries"] == 2


def test_a_partly_filled_entry_still_counts():
    """A manual entry with only carbohydrates typed in is a real entry, not a null row."""
    _entry(source="manual", kcal=None, protein_g=None, fat_g=None, carb_g=60.0)
    totals = db.totals_for_date("2026-08-10")
    assert totals["carb_g"] == 60.0
    assert totals["kcal"] == 0
    assert totals["entries"] == 1


def test_an_edit_marks_the_entry_as_corrected():
    """The flag is the point of the operation as much as the number is: it is what
    separates a figure a human confirmed from one a model guessed."""
    entry = _entry()
    assert entry.corrected is False
    updated = db.update_entry(entry.id, carb_g=120.0)
    assert updated.carb_g == 120.0
    assert updated.corrected is True


def test_an_edit_leaves_untouched_fields_alone():
    entry = _entry()
    updated = db.update_entry(entry.id, carb_g=120.0)
    assert updated.protein_g == 20.0
    assert updated.description == "pasta al pomodoro"


def test_an_edit_cannot_rewrite_where_the_entry_came_from():
    """An edit changes what was eaten, never when it was logged or how it got here."""
    entry = _entry()
    updated = db.update_entry(entry.id, source="manual", date="2020-01-01", logged_at="x")
    assert updated.source == "photo"
    assert updated.date == "2026-08-10"
    assert updated.logged_at == entry.logged_at


def test_editing_a_missing_entry_returns_none():
    assert db.update_entry(999, carb_g=10.0) is None


def test_deleting_removes_the_photo_too():
    path = db.save_photo(b"jpeg-bytes")
    entry = _entry(image_path=path)
    assert Path(path).exists()

    assert db.delete_entry(entry.id) is True
    assert db.get_entry(entry.id) is None
    assert not Path(path).exists()


def test_deleting_survives_a_photo_that_is_already_gone():
    path = db.save_photo(b"jpeg-bytes")
    entry = _entry(image_path=path)
    Path(path).unlink()
    assert db.delete_entry(entry.id) is True


def test_deleting_a_missing_entry_is_false_not_an_error():
    assert db.delete_entry(999) is False


def test_history_includes_the_days_with_nothing_logged():
    """A chart that silently skipped the days you forgot to log would be a flattering
    lie about exactly the thing it exists to show."""
    _entry(date="2026-08-10", carb_g=95.0)
    days = db.totals_between(date(2026, 8, 8), date(2026, 8, 11))
    assert [d["date"] for d in days] == ["2026-08-08", "2026-08-09", "2026-08-10", "2026-08-11"]
    assert [d["entries"] for d in days] == [0, 0, 1, 0]
    assert days[2]["carb_g"] == 95.0


def test_photos_are_stored_under_the_data_dir():
    path = Path(db.save_photo(b"jpeg-bytes"))
    assert path.parent == db.photos_dir()
    assert path.read_bytes() == b"jpeg-bytes"
