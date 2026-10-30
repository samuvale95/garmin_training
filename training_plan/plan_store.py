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
    plan_id      TEXT NOT NULL DEFAULT 'default',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS plan_session_day_idx ON plan_session (user_id, date, position);
ALTER TABLE plan_session ADD COLUMN IF NOT EXISTS plan_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE plan_session ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'flexible';
ALTER TABLE plan_session ADD COLUMN IF NOT EXISTS min_duration_minutes REAL DEFAULT NULL;
ALTER TABLE plan_session ADD COLUMN IF NOT EXISTS short_variant JSONB DEFAULT NULL;
ALTER TABLE plan_session ADD COLUMN IF NOT EXISTS is_short_active BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS plan_session_plan_idx ON plan_session (user_id, plan_id);

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

_COLUMNS = (
    "id, date, position, sport, title, description, steps, origin, locked, plan_id, "
    "priority, min_duration_minutes, short_variant, is_short_active"
)


class SessionNotFound(Exception):
    pass


class SessionLocked(Exception):
    """A non-user writer tried to change a session the user has claimed."""


class PlanChanged(Exception):
    """The sessions a writer planned around changed before it wrote (see `snapshot`)."""


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
            conn.execute("SELECT pg_advisory_xact_lock(730297432560)")
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
        "plan_id": row.get("plan_id") or "default",
        "priority": row.get("priority") or "flexible",
        "min_duration_minutes": row.get("min_duration_minutes"),
        "short_variant": row.get("short_variant"),
        "is_short_active": bool(row.get("is_short_active", False)),
    }


def list_sessions(user_id: str, plan_id: str | None = None, only_active: bool = False) -> list[dict]:
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        if plan_id is not None:
            cur.execute(
                f"SELECT {_COLUMNS} FROM plan_session WHERE user_id = %s AND plan_id = %s ORDER BY date, position, created_at",
                [user_id, plan_id],
            )
        elif only_active:
            cur.execute(
                f"""SELECT ps.id, ps.date, ps.position, ps.sport, ps.title, ps.description, ps.steps, ps.origin, ps.locked, ps.plan_id
                    FROM plan_session ps
                    JOIN user_training_plan utp ON utp.user_id = ps.user_id AND utp.id = ps.plan_id
                    WHERE ps.user_id = %s AND utp.is_active = TRUE
                    ORDER BY ps.date, ps.position, ps.created_at""",
                [user_id],
            )
        else:
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


def create_session(user_id: str, session: dict, *, origin: Origin, plan_id: str | None = None) -> dict:
    """User-created (`manual`) sessions are locked from the start: the user made them."""
    actual_plan_id = plan_id or session.get("plan_id") or "default"
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        position = _next_position(cur, user_id, session["date"])
        cur.execute(
            f"""INSERT INTO plan_session (user_id, id, date, position, sport, title, description, steps, origin, locked, plan_id, priority, min_duration_minutes, short_variant, is_short_active)
                VALUES (%s, coalesce(%s::uuid, gen_random_uuid()), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                actual_plan_id,
                session.get("priority") or "flexible",
                session.get("min_duration_minutes"),
                Jsonb(session.get("short_variant")) if session.get("short_variant") else None,
                bool(session.get("is_short_active", False)),
            ],
        )
        return _out(cur.fetchone())


_EDITABLE = (
    "date",
    "sport",
    "title",
    "description",
    "steps",
    "plan_id",
    "priority",
    "min_duration_minutes",
    "short_variant",
    "is_short_active",
)


def update_session(user_id: str, session_id: str, changes: dict, *, by_user: bool) -> dict:
    """Change some fields of one session.

    A user write locks the session -- editing or moving it is the user claiming it --
    unless the change *is* the user unlocking it (`locked: False`). A non-user write to
    a locked session raises `SessionLocked`.
    """
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT pg_advisory_xact_lock(730297432560)")
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
                if key in ("steps", "short_variant"):
                    values.append(Jsonb(changes[key]) if changes[key] is not None else None)
                else:
                    values.append(changes[key])
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
        cur.execute("SELECT pg_advisory_xact_lock(730297432560)")
        cur.execute(
            "SELECT locked FROM plan_session WHERE user_id = %s AND id = %s FOR UPDATE", [user_id, session_id]
        )
        current = cur.fetchone()
        if current is None:
            raise SessionNotFound(session_id)
        if current["locked"] and not by_user:
            raise SessionLocked(session_id)
        cur.execute("DELETE FROM plan_session WHERE user_id = %s AND id = %s", [user_id, session_id])


def _snapshot(cur, user_id: str, start: date_type, end: date_type) -> dict[str, str]:
    cur.execute("SELECT pg_advisory_xact_lock(730297432560)")
    # A hash of the content, not `updated_at`: two writes in one transaction share a
    # `now()`, and what matters is whether the session is different, not when it changed.
    cur.execute(
        "SELECT id, md5(row(date, position, sport, title, description, steps, locked)::text) AS content "
        "FROM plan_session WHERE user_id = %s AND date BETWEEN %s AND %s FOR UPDATE",
        [user_id, start, end],
    )
    return {str(row["id"]): row["content"] for row in cur.fetchall()}


def snapshot(user_id: str, start: date_type, end: date_type) -> dict[str, str]:
    """Every session in `[start, end]` by id, with a fingerprint of its content.

    Taken by a slow writer (the plan generator waits on a model for up to minutes) before
    it reads the plan, and handed back to `replace_unlocked`: if the user edited, moved,
    added or deleted a session in the range meanwhile, the write is refused instead of
    landing on a plan it was not checked against.
    """
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        return _snapshot(cur, user_id, start, end)


def replace_unlocked(
    user_id: str,
    start: date_type,
    end: date_type,
    sessions: Iterable[dict],
    *,
    origin: Origin = "ai",
    expected: tuple[date_type, date_type, dict[str, str]] | None = None,
    plan_id: str = "default",
) -> ReplaceResult:
    """The one path for non-user writers: swap the unlocked sessions of `[start, end]`.

    One transaction. Locked sessions in the range stay exactly as they are; a proposed
    session on the same day and sport as a locked one is not written and is returned as
    a conflict, so the caller can say what it wanted and why it did not happen.

    With `expected` (`(from, to, snapshot(user_id, from, to))`), raises `PlanChanged`
    and writes nothing when the sessions of that range are no longer what the snapshot
    saw. The rows are locked while comparing, so no user write can slip in between the
    check and the replace.
    """
    result = ReplaceResult()
    with db.connect() as conn, conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT pg_advisory_xact_lock(730297432560)")
        if expected is not None:
            since, until, seen = expected
            if _snapshot(cur, user_id, since, until) != seen:
                raise PlanChanged(user_id)
        cur.execute(
            "SELECT date, sport FROM plan_session "
            "WHERE user_id = %s AND plan_id = %s AND date BETWEEN %s AND %s AND locked FOR UPDATE",
            [user_id, plan_id, start, end],
        )
        claimed = {(row["date"].isoformat(), row["sport"]) for row in cur.fetchall()}
        cur.execute(
            "DELETE FROM plan_session WHERE user_id = %s AND plan_id = %s AND date BETWEEN %s AND %s AND NOT locked",
            [user_id, plan_id, start, end],
        )
        for session in sessions:
            day = session["date"]
            if not start.isoformat() <= day <= end.isoformat():
                raise ValueError(f"session on {day} is outside {start}..{end}")
            if (day, session["sport"]) in claimed:
                result.conflicts.append(session)
                continue
            sess_plan_id = session.get("plan_id") or plan_id
            cur.execute(
                f"""INSERT INTO plan_session (user_id, date, position, sport, title, description, steps, origin, locked, plan_id, priority, min_duration_minutes, short_variant, is_short_active)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, FALSE, %s, %s, %s, %s, %s) RETURNING {_COLUMNS}""",
                [
                    user_id,
                    day,
                    _next_position(cur, user_id, day),
                    session["sport"],
                    session["title"],
                    session.get("description"),
                    Jsonb(session.get("steps") or []),
                    origin,
                    sess_plan_id,
                    session.get("priority") or "flexible",
                    session.get("min_duration_minutes"),
                    Jsonb(session.get("short_variant")) if session.get("short_variant") else None,
                    bool(session.get("is_short_active", False)),
                ],
            )
            result.written.append(_out(cur.fetchone()))
    return result


def delete_plan_sessions(user_id: str, plan_id: str) -> None:
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM plan_session WHERE user_id = %s AND plan_id = %s", [user_id, plan_id])


def toggle_short_variant(user_id: str, session_id: str) -> dict:
    """Toggle is_short_active on a specific session."""
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"""UPDATE plan_session
                SET is_short_active = NOT is_short_active, updated_at = now()
                WHERE user_id = %s AND id = %s
                RETURNING {_COLUMNS}""",
            [user_id, session_id],
        )
        row = cur.fetchone()
        if not row:
            raise SessionNotFound(session_id)
        return _out(row)


def import_sessions(
    user_id: str,
    sessions: Iterable[dict],
    plan_id: str = "default",
    mode: str = "replace",  # "replace" | "merge" | "new_plan"
) -> list[dict]:
    """Import sessions into the plan:
    - 'replace': wipes existing sessions for this plan_id and inserts the new ones.
    - 'merge': keeps non-overlapping or locked sessions, replacing only unlocked matching (date, sport).
    - 'new_plan': inserts all sessions under the specified plan_id.
    """
    with db.connect() as conn, conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        if mode in ("replace", "new_plan"):
            cur.execute("DELETE FROM plan_session WHERE user_id = %s AND plan_id = %s", [user_id, plan_id])
        elif mode == "merge":
            incoming_keys = {(s["date"], s["sport"]) for s in sessions}
            for day, sport in incoming_keys:
                cur.execute(
                    "DELETE FROM plan_session WHERE user_id = %s AND plan_id = %s AND date = %s AND sport = %s AND NOT locked",
                    [user_id, plan_id, day, sport],
                )

        written = []
        for position, session in enumerate(sessions, start=1):
            sess_plan_id = session.get("plan_id") or plan_id
            is_locked = bool(session.get("locked", False))
            cur.execute(
                f"""INSERT INTO plan_session (user_id, date, position, sport, title, description, steps, origin, locked, plan_id, priority, min_duration_minutes, short_variant, is_short_active)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, 'import', %s, %s, %s, %s, %s, %s) RETURNING {_COLUMNS}""",
                [
                    user_id,
                    session["date"],
                    position,
                    session["sport"],
                    session["title"],
                    session.get("description"),
                    Jsonb(session.get("steps") or []),
                    is_locked,
                    sess_plan_id,
                    session.get("priority") or "flexible",
                    session.get("min_duration_minutes"),
                    Jsonb(session.get("short_variant")) if session.get("short_variant") else None,
                    bool(session.get("is_short_active", False)),
                ],
            )
            written.append(_out(cur.fetchone()))
        cur.execute("UPDATE user_plan SET sessions_migrated = TRUE WHERE user_id = %s", [user_id])
    return written
