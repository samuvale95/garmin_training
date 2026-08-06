"""The food log: the first server-side state this project keeps.

Everything else Passo shows is fetched fresh from Garmin or Strava, or lives in the
plan file on the user's device -- "il file resta la verità". A food diary cannot work
that way. It is an append-only record that only has meaning longitudinally, nothing
upstream holds it, and `localStorage` loses it to a cleared browser. So this breaks the
no-database invariant, knowingly and narrowly: one table, and nothing else moves in
here.

Plain `sqlite3` from the standard library. An ORM would be more machinery than the
schema has rows of DDL, and this file is small enough to read in full before trusting
it with a year of someone's meals.

Connections are opened per call rather than shared. Requests run in FastAPI's
threadpool, SQLite connections are not safe to pass between threads, and the cost of
opening one against a local file is far below the cost of getting that wrong.
"""

from __future__ import annotations

import os
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import date as date_type
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

# Its own directory rather than another dotfile in `$HOME` (the tokenstores' pattern):
# this is a database plus a growing pile of photographs, and the two belong together
# where a user can find, back up, or delete them in one move.
DEFAULT_DATA_DIR = Path.home() / ".passo"

SCHEMA = """
CREATE TABLE IF NOT EXISTS food_entry (
  id           INTEGER PRIMARY KEY,
  date         TEXT NOT NULL,
  logged_at    TEXT NOT NULL,
  source       TEXT NOT NULL,
  description  TEXT,
  kcal         REAL,
  carb_g       REAL,
  protein_g    REAL,
  fat_g        REAL,
  confidence   TEXT,
  corrected    INTEGER NOT NULL DEFAULT 0,
  image_path   TEXT
);
CREATE INDEX IF NOT EXISTS idx_food_entry_date ON food_entry(date);
"""

Confidence = Literal["low", "medium", "high"]
Source = Literal["photo", "manual"]


@dataclass
class FoodEntry:
    id: int
    date: str
    logged_at: str
    source: str
    description: str | None
    kcal: float | None
    carb_g: float | None
    protein_g: float | None
    fat_g: float | None
    confidence: str | None
    # True once the user has edited the numbers. Kept because it is the difference
    # between a figure someone confirmed and a figure a model guessed, and any later
    # analysis over this table has to be able to tell them apart.
    corrected: bool
    image_path: str | None

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "FoodEntry":
        return cls(
            id=row["id"],
            date=row["date"],
            logged_at=row["logged_at"],
            source=row["source"],
            description=row["description"],
            kcal=row["kcal"],
            carb_g=row["carb_g"],
            protein_g=row["protein_g"],
            fat_g=row["fat_g"],
            confidence=row["confidence"],
            corrected=bool(row["corrected"]),
            image_path=row["image_path"],
        )


def data_dir() -> Path:
    """Read from the environment on every call, not captured at import: the tests point
    it at a tmpdir per test, and a module-level constant would freeze the first one."""
    return Path(os.getenv("PASSO_DATA_DIR", str(DEFAULT_DATA_DIR))).expanduser()


def db_path() -> Path:
    return Path(os.getenv("PASSO_DB_PATH", str(data_dir() / "nutrition.db"))).expanduser()


def photos_dir() -> Path:
    return data_dir() / "photos"


def connect() -> sqlite3.Connection:
    """An initialised connection. Schema creation is idempotent and runs every time --
    it costs microseconds against a local file and removes the entire class of bug where
    a fresh install hits a missing table."""
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def save_photo(image_bytes: bytes, suffix: str = ".jpg") -> str:
    """Store a plate photo next to the database and return its path.

    Local only. The bytes go to the vision model at estimation time and nowhere else --
    there is no upload, no CDN and no thumbnail service, which is what makes the privacy
    note in `llm.config_state()` a statement about one call rather than about the app.
    """
    directory = photos_dir()
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{uuid.uuid4().hex}{suffix}"
    path.write_bytes(image_bytes)
    return str(path)


def add_entry(
    *,
    date: str,
    source: Source,
    description: str | None = None,
    kcal: float | None = None,
    carb_g: float | None = None,
    protein_g: float | None = None,
    fat_g: float | None = None,
    confidence: Confidence | None = None,
    corrected: bool = False,
    image_path: str | None = None,
) -> FoodEntry:
    logged_at = datetime.now(timezone.utc).isoformat()
    with connect() as conn:
        cursor = conn.execute(
            """INSERT INTO food_entry
               (date, logged_at, source, description, kcal, carb_g, protein_g, fat_g,
                confidence, corrected, image_path)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                date,
                logged_at,
                source,
                description,
                kcal,
                carb_g,
                protein_g,
                fat_g,
                confidence,
                int(corrected),
                image_path,
            ),
        )
        row = conn.execute("SELECT * FROM food_entry WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return FoodEntry.from_row(row)


def get_entry(entry_id: int) -> FoodEntry | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM food_entry WHERE id = ?", (entry_id,)).fetchone()
    return FoodEntry.from_row(row) if row else None


def entries_for_date(date: str) -> list[FoodEntry]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM food_entry WHERE date = ? ORDER BY logged_at", (date,)
        ).fetchall()
    return [FoodEntry.from_row(row) for row in rows]


# The fields a correction may touch. `source`, `date` and `logged_at` are not among them:
# an edit changes what was eaten, never when it was logged or how it got here.
EDITABLE_FIELDS = ("description", "kcal", "carb_g", "protein_g", "fat_g")


def update_entry(entry_id: int, **fields: Any) -> FoodEntry | None:
    """Apply a correction. Any touched entry is marked `corrected`, permanently.

    That flag is the point of the operation as much as the new numbers are: it records
    that a human looked at this row, which is the only thing that separates a measured
    figure from a guessed one once both are sitting in the same table.
    """
    updates = {k: v for k, v in fields.items() if k in EDITABLE_FIELDS}
    if not updates:
        return get_entry(entry_id)

    assignments = ", ".join(f"{key} = ?" for key in updates)
    with connect() as conn:
        cursor = conn.execute(
            f"UPDATE food_entry SET {assignments}, corrected = 1 WHERE id = ?",
            (*updates.values(), entry_id),
        )
        if cursor.rowcount == 0:
            return None
        row = conn.execute("SELECT * FROM food_entry WHERE id = ?", (entry_id,)).fetchone()
    return FoodEntry.from_row(row)


def delete_entry(entry_id: int) -> bool:
    """Remove an entry and its photo. False when there was nothing to remove."""
    entry = get_entry(entry_id)
    if entry is None:
        return False
    with connect() as conn:
        conn.execute("DELETE FROM food_entry WHERE id = ?", (entry_id,))
    if entry.image_path:
        # A photo left behind after its row is gone is an orphan nobody will ever find
        # in a directory of uuid filenames; a missing file is not worth failing over.
        Path(entry.image_path).unlink(missing_ok=True)
    return True


def totals_for_date(date: str) -> dict[str, float]:
    """Summed macros for a day. Missing values count as zero -- a manual entry with only
    carbohydrates filled in is still a real entry."""
    with connect() as conn:
        row = conn.execute(
            """SELECT COALESCE(SUM(kcal), 0)      AS kcal,
                      COALESCE(SUM(carb_g), 0)    AS carb_g,
                      COALESCE(SUM(protein_g), 0) AS protein_g,
                      COALESCE(SUM(fat_g), 0)     AS fat_g,
                      COUNT(*)                    AS entries
               FROM food_entry WHERE date = ?""",
            (date,),
        ).fetchone()
    return {
        "kcal": round(row["kcal"], 1),
        "carb_g": round(row["carb_g"], 1),
        "protein_g": round(row["protein_g"], 1),
        "fat_g": round(row["fat_g"], 1),
        "entries": row["entries"],
    }


def totals_between(start: date_type, end: date_type) -> list[dict[str, Any]]:
    """Per-day totals across a range, including the days with nothing logged.

    The empty days are returned on purpose: the history strip is a picture of
    consistency, and a chart that silently skips the days you forgot to log would be a
    flattering lie about exactly the thing it exists to show.
    """
    with connect() as conn:
        rows = conn.execute(
            """SELECT date,
                      COALESCE(SUM(kcal), 0)      AS kcal,
                      COALESCE(SUM(carb_g), 0)    AS carb_g,
                      COALESCE(SUM(protein_g), 0) AS protein_g,
                      COALESCE(SUM(fat_g), 0)     AS fat_g,
                      COUNT(*)                    AS entries
               FROM food_entry
               WHERE date BETWEEN ? AND ?
               GROUP BY date""",
            (start.isoformat(), end.isoformat()),
        ).fetchall()

    by_date = {row["date"]: row for row in rows}
    days: list[dict[str, Any]] = []
    current = start
    while current <= end:
        key = current.isoformat()
        row = by_date.get(key)
        days.append(
            {
                "date": key,
                "kcal": round(row["kcal"], 1) if row else 0.0,
                "carb_g": round(row["carb_g"], 1) if row else 0.0,
                "protein_g": round(row["protein_g"], 1) if row else 0.0,
                "fat_g": round(row["fat_g"], 1) if row else 0.0,
                "entries": row["entries"] if row else 0,
            }
        )
        current = date_type.fromordinal(current.toordinal() + 1)
    return days
