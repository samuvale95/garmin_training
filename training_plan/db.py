"""Server-held state this project keeps: the food log, and the active training plan.

Everything else Passo shows is fetched fresh from Garmin or Strava. Both tables here
broke the original no-database invariant knowingly: a food diary only has meaning
longitudinally and nothing upstream holds it, and the plan -- device-only at first --
turned out to not survive a cleared browser or a second device either. `localStorage`
stays as a same-tab-instant mirror for both; this is what makes either of them durable.

Postgres (Supabase), not SQLite: the app now runs as a stateless deployed service with
several people behind the same backend, so the database has to live somewhere every
instance can reach, not next to one process on one disk. `psycopg` directly, no ORM --
the same discipline as before, just against a different engine. Every function takes a
`user_id` (the Supabase auth subject), because more than one person's diary now lives
in this one table.

The full-resolution photo is never written anywhere: those bytes go to the vision model
in memory (see `llm.estimate_macros_from_photo`) and are discarded the moment that call
returns. A separate, low-quality thumbnail -- generated client-side, a few KB, only ever
good enough for the meal-list icon -- is persisted in `thumbnail` so a logged meal has a
picture to show without the original ever touching disk.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date as date_type
from datetime import datetime, timezone
from typing import Any, Literal

import psycopg
from psycopg.rows import DictRow, dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

SCHEMA = """
CREATE TABLE IF NOT EXISTS food_entry (
  id           BIGSERIAL PRIMARY KEY,
  user_id      TEXT NOT NULL,
  date         TEXT NOT NULL,
  logged_at    TEXT NOT NULL,
  source       TEXT NOT NULL,
  description  TEXT,
  kcal         DOUBLE PRECISION,
  carb_g       DOUBLE PRECISION,
  protein_g    DOUBLE PRECISION,
  fat_g        DOUBLE PRECISION,
  confidence   TEXT,
  corrected    BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_food_entry_user_date ON food_entry(user_id, date);
ALTER TABLE food_entry ADD COLUMN IF NOT EXISTS thumbnail BYTEA;

CREATE TABLE IF NOT EXISTS user_plan (
  user_id      TEXT PRIMARY KEY,
  yaml_text    TEXT NOT NULL,
  sessions     JSONB NOT NULL,
  filename     TEXT,
  imported_at  TEXT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
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
    # The thumbnail itself, not a reference to it: every route here requires a bearer
    # token (see `api/auth.py`), which a plain `<img src>` cannot attach, so there is no
    # authenticated-by-id endpoint to point at. The bytes travel inside the same JSON
    # response the client already fetches with `Authorization` set, and become a
    # `data:` URI at the schema layer (`schemas.FoodEntryOut.from_model`).
    thumbnail: bytes | None

    @classmethod
    def from_row(cls, row: DictRow) -> "FoodEntry":
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
            thumbnail=bytes(row["thumbnail"]) if row["thumbnail"] is not None else None,
        )


def _database_url() -> str:
    """Read from the environment on every call, not captured at import: tests point it
    at a throwaway database per run, and a module-level constant would freeze the
    first one."""
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not configured (Supabase Postgres connection string)")
    return url


_pool: ConnectionPool | None = None


def _get_pool() -> ConnectionPool:
    """A lazily-opened, process-wide connection pool.

    Unlike the local SQLite file this replaced, every query here is a network
    round-trip to Supabase -- opening a fresh TLS connection per call (the old "cheap
    against a local file" reasoning) would make every request pay a full handshake.
    The pool is safe to share across FastAPI's threadpool threads; `psycopg_pool`
    hands out one physical connection per checkout and returns it on release.
    """
    global _pool
    if _pool is None:
        _pool = ConnectionPool(conninfo=_database_url(), min_size=1, max_size=5, open=True)
    return _pool


def connect() -> psycopg.Connection:
    """A pooled, initialised connection, checked out as a context manager by callers.

    Schema creation runs once per process (`ensure_schema`, called from the API
    startup), not on every call the way the SQLite version did -- a `CREATE TABLE IF
    NOT EXISTS` is cheap locally but is now a network round-trip too, and this table's
    shape only ever changes at deploy time.
    """
    return _get_pool().connection()


def ensure_schema() -> None:
    with connect() as conn:
        conn.execute(SCHEMA)


def add_entry(
    *,
    user_id: str,
    date: str,
    source: Source,
    description: str | None = None,
    kcal: float | None = None,
    carb_g: float | None = None,
    protein_g: float | None = None,
    fat_g: float | None = None,
    confidence: Confidence | None = None,
    corrected: bool = False,
    thumbnail: bytes | None = None,
) -> FoodEntry:
    logged_at = datetime.now(timezone.utc).isoformat()
    with connect() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """INSERT INTO food_entry
                   (user_id, date, logged_at, source, description, kcal, carb_g, protein_g, fat_g,
                    confidence, corrected, thumbnail)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   RETURNING *""",
                (
                    user_id,
                    date,
                    logged_at,
                    source,
                    description,
                    kcal,
                    carb_g,
                    protein_g,
                    fat_g,
                    confidence,
                    corrected,
                    thumbnail,
                ),
            )
            row = cur.fetchone()
    return FoodEntry.from_row(row)


def get_entry(user_id: str, entry_id: int) -> FoodEntry | None:
    with connect() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                "SELECT * FROM food_entry WHERE id = %s AND user_id = %s", (entry_id, user_id)
            )
            row = cur.fetchone()
    return FoodEntry.from_row(row) if row else None


def entries_for_date(user_id: str, date: str) -> list[FoodEntry]:
    with connect() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                "SELECT * FROM food_entry WHERE user_id = %s AND date = %s ORDER BY logged_at",
                (user_id, date),
            )
            rows = cur.fetchall()
    return [FoodEntry.from_row(row) for row in rows]


# The fields a correction may touch. `source`, `date` and `logged_at` are not among them:
# an edit changes what was eaten, never when it was logged or how it got here.
EDITABLE_FIELDS = ("description", "kcal", "carb_g", "protein_g", "fat_g")


def update_entry(user_id: str, entry_id: int, **fields: Any) -> FoodEntry | None:
    """Apply a correction. Any touched entry is marked `corrected`, permanently.

    That flag is the point of the operation as much as the new numbers are: it records
    that a human looked at this row, which is the only thing that separates a measured
    figure from a guessed one once both are sitting in the same table.
    """
    updates = {k: v for k, v in fields.items() if k in EDITABLE_FIELDS}
    if not updates:
        return get_entry(user_id, entry_id)

    assignments = ", ".join(f"{key} = %s" for key in updates)
    with connect() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                f"UPDATE food_entry SET {assignments}, corrected = TRUE "
                "WHERE id = %s AND user_id = %s RETURNING *",
                (*updates.values(), entry_id, user_id),
            )
            row = cur.fetchone()
    return FoodEntry.from_row(row) if row else None


def delete_entry(user_id: str, entry_id: int) -> bool:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM food_entry WHERE id = %s AND user_id = %s", (entry_id, user_id))
            deleted = cur.rowcount > 0
    return deleted


def totals_for_date(user_id: str, date: str) -> dict[str, float]:
    """Summed macros for a day. Missing values count as zero -- a manual entry with only
    carbohydrates filled in is still a real entry."""
    with connect() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """SELECT COALESCE(SUM(kcal), 0)      AS kcal,
                          COALESCE(SUM(carb_g), 0)    AS carb_g,
                          COALESCE(SUM(protein_g), 0) AS protein_g,
                          COALESCE(SUM(fat_g), 0)     AS fat_g,
                          COUNT(*)                    AS entries
                   FROM food_entry WHERE user_id = %s AND date = %s""",
                (user_id, date),
            )
            row = cur.fetchone()
    return {
        "kcal": round(row["kcal"], 1),
        "carb_g": round(row["carb_g"], 1),
        "protein_g": round(row["protein_g"], 1),
        "fat_g": round(row["fat_g"], 1),
        "entries": row["entries"],
    }


def totals_between(user_id: str, start: date_type, end: date_type) -> list[dict[str, Any]]:
    """Per-day totals across a range, including the days with nothing logged.

    The empty days are returned on purpose: the history strip is a picture of
    consistency, and a chart that silently skips the days you forgot to log would be a
    flattering lie about exactly the thing it exists to show.
    """
    with connect() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """SELECT date,
                          COALESCE(SUM(kcal), 0)      AS kcal,
                          COALESCE(SUM(carb_g), 0)    AS carb_g,
                          COALESCE(SUM(protein_g), 0) AS protein_g,
                          COALESCE(SUM(fat_g), 0)     AS fat_g,
                          COUNT(*)                    AS entries
                   FROM food_entry
                   WHERE user_id = %s AND date BETWEEN %s AND %s
                   GROUP BY date""",
                (user_id, start.isoformat(), end.isoformat()),
            )
            rows = cur.fetchall()

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


# ---- the active training plan ----------------------------------------------------------------


@dataclass
class UserPlan:
    yaml_text: str
    # A list of plain dicts shaped like the frontend's `TrainingSession` (date/sport/
    # title/description/steps) -- stored as opaque JSON rather than modeled with
    # `models.TrainingSession`, the same way `thumbnail` stores bytes instead of a
    # decoded image: nothing server-side reads into a session's structure, it is only
    # ever round-tripped back to the one client that does.
    sessions: list[dict[str, Any]]
    filename: str | None
    imported_at: str

    @classmethod
    def from_row(cls, row: DictRow) -> "UserPlan":
        return cls(
            yaml_text=row["yaml_text"],
            sessions=row["sessions"],
            filename=row["filename"],
            imported_at=row["imported_at"],
        )


def get_plan(user_id: str) -> UserPlan | None:
    with connect() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute("SELECT * FROM user_plan WHERE user_id = %s", (user_id,))
            row = cur.fetchone()
    return UserPlan.from_row(row) if row else None


def save_plan(
    *, user_id: str, yaml_text: str, sessions: list[dict[str, Any]], filename: str | None, imported_at: str
) -> UserPlan:
    with connect() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """INSERT INTO user_plan (user_id, yaml_text, sessions, filename, imported_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s, now())
                   ON CONFLICT (user_id) DO UPDATE SET
                     yaml_text = EXCLUDED.yaml_text,
                     sessions = EXCLUDED.sessions,
                     filename = EXCLUDED.filename,
                     imported_at = EXCLUDED.imported_at,
                     updated_at = now()
                   RETURNING *""",
                (user_id, yaml_text, Jsonb(sessions), filename, imported_at),
            )
            row = cur.fetchone()
    return UserPlan.from_row(row)


def delete_plan(user_id: str) -> None:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM user_plan WHERE user_id = %s", (user_id,))
