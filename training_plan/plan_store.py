"""The plan's sessions, owned by the server.

Before this, the plan was one JSON array inside `user_plan` that the web client rewrote
whole on every edit, with sessions known only by their position in the list. That was
fine with one writer. Phase 2 adds a second -- an AI that generates and adapts the plan
from the server -- and with two writers a whole-list rewrite from either side silently
undoes the other, while an index stops meaning the same session the moment anything is
inserted or removed.

So each session is a row with a stable id, and two facts about its history:

- **origin** -- `import` (from a YAML file), `manual` (created in the app), `ai`.
- **locked** -- set as soon as the user creates, edits or moves a session.

The rule the product rests on -- *manual edits always win* -- is enforced here, not in
the routes: `by_user=False` writes to a locked session raise, and the only bulk path for
non-user writers, `replace_unlocked`, leaves locked sessions alone and reports what it
could not write. Whatever writes the plan next cannot forget the rule, because there is
no way around it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date as date_type
from typing import Any, Iterable, Literal

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from . import db

Origin = Literal["import", "manual", "ai"]
ORIGINS: tuple[str, ...] = ("import", "manual", "ai")

SCHEMA = """
CREATE TABLE IF NOT EXISTS plan_session (
    user_id      TEXT NOT NULL,
    id           UUID NOT NULL DEFAULT gen_random_uuid(),
    date         DATE NOT NULL,
    position     INTEGER NOT NULL DEFAULT 0,
    sport        TEXT NOT NULL,
    title        TEXT NOT NULL,
    description  TEXT,
    steps        JSONB NOT NULL,
    origin       TEXT NOT NULL,
    locked       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS plan_session_day_idx ON plan_session (user_id, date, position);

ALTER TABLE user_plan ADD COLUMN IF NOT EXISTS sessions_migrated BOOLEAN NOT NULL DEFAULT FALSE;
"""

# One-time copy of the old JSON array into rows, one transaction per user (see
# `ensure_schema`). Everything that was in a plan before this change came from a YAML
# import or was edited in the app with no record of it, so it all lands as `import`,
# unlocked: the AI may adapt it, which is what the user asked for of the old plan.
_MIGRATE_ONE = """
INSERT INTO plan_session (user_id, date, position, sport, title, description, steps, origin, locked)
SELECT %(user_id)s,
       (element->>'date')::date,
       ordinality::int,
       element->>'sport',
       element->>'title',
       element->>'description',
       coalesce(element->'steps', '[]'::jsonb),
       'import',
       FALSE
FROM user_plan, jsonb_array_elements(user_plan.sessions) WITH ORDINALITY AS t(element, ordinality)
WHERE user_plan.user_id = %(user_id)s
"""

_COLUMNS = "id, date, position, sport, title, description, steps, origin, locked"


class SessionNotFound(Exception):
    pass


class SessionLocked(Exception):
    """A non-user writer tried to change a session the user has claimed."""


@dataclass
class ReplaceResult:
    written: list[dict] = field(default_factory=list)
    # Proposed sessions not written because a locked session holds that day and sport.
    conflicts: list[dict] = field(default_factory=list)


def ensure_schema() -> None:
    with db.connect() as conn:
        conn.execute(SCHEMA)
        users = [row[0] for row in conn.execute("SELECT user_id FROM user_plan WHERE NOT sessions_migrated")]
    for user_id in users:
        with db.connect() as conn, conn.transaction():
            # Re-checked inside the transaction: two processes starting at once must not
            # both copy the same plan.
            pending = conn.execute(
                "SELECT 1 FROM user_plan WHERE user_id = %s AND NOT sessions_migrated FOR UPDATE", [user_id]
            ).fetchone()
            if pending:
                conn.execute(_MIGRATE_ONE, {"user_id": user_id})
                conn.execute("UPDATE user_plan SET sessions_migrated = TRUE WHERE user_id = %s", [user_id])


def _out(row: dict) -> dict:
    """A row as the `TrainingSession`-shaped dict the API and the web client use."""
    return {
        "id": str(row["id"]),
        "date": row["date"].isoformat(),
        "sport": row["sport"],
        "title": row["title"],
        "description": row["description"],
        "steps": row["steps"],
        "origin": row["origin"],
        "locked": row["locked"],
    }


def list_sessions(user_id: str) -> list[dict]:
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"SELECT {_COLUMNS} FROM plan_session WHERE user_id = %s ORDER BY date, position, created_at",
            [user_id],
        )
        return [_out(row) for row in cur.fetchall()]


def _next_position(cur, user_id: str, day: str) -> int:
    cur.execute(
        "SELECT coalesce(max(position), 0) + 1 AS next FROM plan_session WHERE user_id = %s AND date = %s",
        [user_id, day],
    )
    return cur.fetchone()["next"]


def create_session(user_id: str, session: dict, *, origin: Origin) -> dict:
    """User-created (`manual`) sessions are locked from the start: the user made them."""
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        position = _next_position(cur, user_id, session["date"])
        cur.execute(
            f"""INSERT INTO plan_session (user_id, id, date, position, sport, title, description, steps, origin, locked)
                VALUES (%s, coalesce(%s::uuid, gen_random_uuid()), %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING {_COLUMNS}""",
            [
                user_id,
                session.get("id"),
                session["date"],
                position,
                session["sport"],
                session["title"],
                session.get("description"),
                Jsonb(session.get("steps") or []),
                origin,
                origin == "manual",
            ],
        )
        return _out(cur.fetchone())


_EDITABLE = ("date", "sport", "title", "description", "steps")


def update_session(user_id: str, session_id: str, changes: dict, *, by_user: bool) -> dict:
    """Change some fields of one session.

    A user write locks the session -- editing or moving it is the user claiming it --
    unless the change *is* the user unlocking it (`locked: False`). A non-user write to
    a locked session raises `SessionLocked`.
    """
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT locked FROM plan_session WHERE user_id = %s AND id = %s FOR UPDATE", [user_id, session_id]
        )
        current = cur.fetchone()
        if current is None:
            raise SessionNotFound(session_id)
        if current["locked"] and not by_user:
            raise SessionLocked(session_id)

        assignments: list[str] = []
        values: list[Any] = []
        for key in _EDITABLE:
            if key in changes:
                assignments.append(f"{key} = %s")
                values.append(Jsonb(changes[key] or []) if key == "steps" else changes[key])
        if "date" in changes:
            assignments.append("position = %s")
            values.append(_next_position(cur, user_id, changes["date"]))

        if by_user:
            unlocking = changes.get("locked") is False and not any(key in changes for key in _EDITABLE)
            assignments.append("locked = %s")
            values.append(not unlocking)

        assignments.append("updated_at = now()")
        cur.execute(
            f"UPDATE plan_session SET {', '.join(assignments)} WHERE user_id = %s AND id = %s RETURNING {_COLUMNS}",
            [*values, user_id, session_id],
        )
        return _out(cur.fetchone())


def delete_session(user_id: str, session_id: str, *, by_user: bool) -> None:
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT locked FROM plan_session WHERE user_id = %s AND id = %s FOR UPDATE", [user_id, session_id]
        )
        current = cur.fetchone()
        if current is None:
            raise SessionNotFound(session_id)
        if current["locked"] and not by_user:
            raise SessionLocked(session_id)
        cur.execute("DELETE FROM plan_session WHERE user_id = %s AND id = %s", [user_id, session_id])


def replace_unlocked(
    user_id: str, start: date_type, end: date_type, sessions: Iterable[dict], *, origin: Origin = "ai"
) -> ReplaceResult:
    """The one path for non-user writers: swap the unlocked sessions of `[start, end]`.

    One transaction. Locked sessions in the range stay exactly as they are; a proposed
    session on the same day and sport as a locked one is not written and is returned as
    a conflict, so the caller can say what it wanted and why it did not happen.
    """
    result = ReplaceResult()
    with db.connect() as conn, conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT date, sport FROM plan_session "
            "WHERE user_id = %s AND date BETWEEN %s AND %s AND locked FOR UPDATE",
            [user_id, start, end],
        )
        claimed = {(row["date"].isoformat(), row["sport"]) for row in cur.fetchall()}
        cur.execute(
            "DELETE FROM plan_session WHERE user_id = %s AND date BETWEEN %s AND %s AND NOT locked",
            [user_id, start, end],
        )
        for session in sessions:
            day = session["date"]
            if not start.isoformat() <= day <= end.isoformat():
                raise ValueError(f"session on {day} is outside {start}..{end}")
            if (day, session["sport"]) in claimed:
                result.conflicts.append(session)
                continue
            cur.execute(
                f"""INSERT INTO plan_session (user_id, date, position, sport, title, description, steps, origin, locked)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, FALSE) RETURNING {_COLUMNS}""",
                [
                    user_id,
                    day,
                    _next_position(cur, user_id, day),
                    session["sport"],
                    session["title"],
                    session.get("description"),
                    Jsonb(session.get("steps") or []),
                    origin,
                ],
            )
            result.written.append(_out(cur.fetchone()))
    return result


def import_sessions(user_id: str, sessions: Iterable[dict]) -> list[dict]:
    """Replace every session with an imported set: origin `import`, unlocked.

    Importing a file is the user saying "this is my plan now", so locks go too -- the
    one place where a bulk write is allowed to remove locked sessions, and only because
    the user asked for exactly that.
    """
    with db.connect() as conn, conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        cur.execute("DELETE FROM plan_session WHERE user_id = %s", [user_id])
        written = []
        for position, session in enumerate(sessions, start=1):
            cur.execute(
                f"""INSERT INTO plan_session (user_id, date, position, sport, title, description, steps, origin, locked)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, 'import', FALSE) RETURNING {_COLUMNS}""",
                [
                    user_id,
                    session["date"],
                    position,
                    session["sport"],
                    session["title"],
                    session.get("description"),
                    Jsonb(session.get("steps") or []),
                ],
            )
            written.append(_out(cur.fetchone()))
        cur.execute("UPDATE user_plan SET sessions_migrated = TRUE WHERE user_id = %s", [user_id])
    return written
