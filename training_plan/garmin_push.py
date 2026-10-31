"""Keep the Garmin calendar equal to the plan, without the user having to sync by hand.

Before this, an edit in the app only changed the database: Garmin heard about it only if
the user opened the sync screen and confirmed, and even then the calendar was matched by
(date, title), so

- a moved session left the old workout on its old day,
- a renamed one ended up on Garmin twice,
- a deleted one stayed on the watch,
- a session switched to its short variant uploaded the long one,
- and a sync job lived in a thread in memory: a server restart halfway lost it silently.

Here the state lives in Postgres. `garmin_link` remembers, per plan session, which
Garmin workout and schedule entry represent it and the fingerprint of what was pushed.
`reconcile` compares the plan (active plans, from yesterday to `WINDOW_DAYS` ahead) with
those links and does only what differs: push what is new or changed, delete from Garmin
what was moved out, deleted, or belongs to a plan no longer active. A failure is stored
on the session and retried by the next reconcile, which runs after every edit, when the
app asks for the status, and from the daily cron.

Sessions pushed before links existed are adopted by (date, title) the first time, so
switching this on does not duplicate a calendar synced the old way.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, replace
from datetime import date as date_type
from datetime import timedelta
from typing import Any

from psycopg.rows import dict_row

from . import db
from .garmin_sync import (
    GarminRateLimitError,
    GarminSync,
    ScheduledWorkout,
    session_key,
    workout_fingerprint,
)
from .models import TrainingSession

logger = logging.getLogger(__name__)

# How far ahead the calendar is kept in sync. Four weeks covers any plan horizon the
# watch is useful for, and bounds the work of the first reconcile.
WINDOW_DAYS = 28
# Between two Garmin writes: one user's edits must not look like a burst to Garmin.
WRITE_PAUSE_S = 0.5
MAX_ERROR_LENGTH = 300

SCHEMA = """
CREATE TABLE IF NOT EXISTS garmin_link (
    user_id       TEXT NOT NULL,
    session_id    UUID NOT NULL,
    workout_id    BIGINT,
    scheduled_id  BIGINT,
    garmin_date   DATE,
    pushed_hash   TEXT,
    status        TEXT NOT NULL DEFAULT 'pending',
    error         TEXT,
    attempts      INTEGER NOT NULL DEFAULT 0,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, session_id)
);
"""


@dataclass
class ReconcileReport:
    pushed: int = 0
    deleted: int = 0
    adopted: int = 0
    failed: int = 0
    stopped_early: str | None = None


def ensure_schema() -> None:
    with db.connect() as conn:
        conn.execute(SCHEMA)


# ---- what the plan wants ------------------------------------------------------------------------


def _session_model(row: dict) -> TrainingSession:
    from .api import schemas  # the one place a stored session dict becomes a model

    payload = {
        "date": row["date"].isoformat() if isinstance(row["date"], date_type) else row["date"],
        "sport": row["sport"],
        "title": row["title"],
        "description": row.get("description"),
        "steps": row.get("steps") or [],
        "priority": row.get("priority") or "flexible",
        "min_duration_minutes": row.get("min_duration_minutes"),
        "short_variant": row.get("short_variant"),
        "is_short_active": bool(row.get("is_short_active")),
    }
    return schemas.TrainingSessionIn.model_validate(payload).to_model()


def effective(session: TrainingSession) -> TrainingSession:
    """The session as it should appear on the watch: the short variant when it is on."""
    return replace(
        session,
        title=session.effective_title,
        description=session.effective_description,
        steps=session.effective_steps,
        is_short_active=False,
        short_variant=None,
    )


def wanted_sessions(user_id: str, today: date_type) -> dict[str, TrainingSession]:
    """Active-plan sessions in the window, by id, already in their effective form."""
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """SELECT ps.id, ps.date, ps.sport, ps.title, ps.description, ps.steps, ps.priority,
                      ps.min_duration_minutes, ps.short_variant, ps.is_short_active
               FROM plan_session ps
               LEFT JOIN user_training_plan utp ON utp.user_id = ps.user_id AND utp.id = ps.plan_id
               WHERE ps.user_id = %s AND ps.date BETWEEN %s AND %s
                 AND (utp.id IS NULL OR utp.is_active)""",
            [user_id, today - timedelta(days=1), today + timedelta(days=WINDOW_DAYS)],
        )
        return {str(row["id"]): effective(_session_model(row)) for row in cur.fetchall()}


def content_hash(sync: GarminSync, session: TrainingSession) -> str:
    """What decides whether Garmin is out of date: the workout, its name and description
    (the fingerprint ignores presentation fields, but on the watch the name is what the
    user reads) and the day it sits on."""
    payload = sync.build_workout_payload(session)
    return "|".join((
        session.date.isoformat(),
        payload.get("workoutName") or "",
        payload.get("description") or "",
        workout_fingerprint(payload),
    ))


# ---- what Garmin has --------------------------------------------------------------------------


def _links(user_id: str) -> dict[str, dict]:
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT * FROM garmin_link WHERE user_id = %s", [user_id])
        return {str(row["session_id"]): row for row in cur.fetchall()}


def _save_link(user_id: str, session_id: str, **fields: Any) -> None:
    columns = ["user_id", "session_id", *fields]
    values = [user_id, session_id, *fields.values()]
    updates = ", ".join(f"{k} = EXCLUDED.{k}" for k in fields)
    with db.connect() as conn:
        conn.execute(
            f"INSERT INTO garmin_link ({', '.join(columns)}, updated_at) "
            f"VALUES ({', '.join(['%s'] * len(columns))}, now()) "
            f"ON CONFLICT (user_id, session_id) DO UPDATE SET {updates}, updated_at = now()",
            values,
        )


def _drop_link(user_id: str, session_id: str) -> None:
    with db.connect() as conn:
        conn.execute("DELETE FROM garmin_link WHERE user_id = %s AND session_id = %s", [user_id, session_id])


def _fail(user_id: str, session_id: str, error: str, attempts: int) -> None:
    _save_link(user_id, session_id, status="failed", error=error[:MAX_ERROR_LENGTH], attempts=attempts + 1)


# ---- the work -----------------------------------------------------------------------------------


def _remove(sync: GarminSync, link: dict) -> None:
    """Take a pushed session off Garmin. Already gone counts as done."""
    if link.get("scheduled_id"):
        try:
            sync.client.unschedule_workout(link["scheduled_id"])
        except Exception as exc:
            if not _is_not_found(exc):
                raise
    if link.get("workout_id"):
        try:
            sync.client.delete_workout(link["workout_id"])
        except Exception as exc:
            if not _is_not_found(exc):
                raise


def _is_not_found(exc: Exception) -> bool:
    text = str(exc)
    return "404" in text or "Not Found" in text


def _push(sync: GarminSync, session: TrainingSession) -> tuple[int, int | None]:
    """Upload and schedule; on a failed schedule the uploaded workout is removed again,
    so a retry does not leave an orphan in the workout library."""
    created = sync.client.upload_workout(sync.build_workout_payload(session))
    workout_id = int(created["workoutId"])
    try:
        scheduled = sync.client.schedule_workout(workout_id, session.date.isoformat())
    except Exception:
        try:
            sync.client.delete_workout(workout_id)
        except Exception:
            logger.warning("could not remove orphan workout %s", workout_id, exc_info=True)
        raise
    scheduled_id = None
    if isinstance(scheduled, dict):
        raw = scheduled.get("workoutScheduleId") or scheduled.get("scheduleId") or scheduled.get("id")
        scheduled_id = int(raw) if isinstance(raw, (int, str)) and str(raw).isdigit() else None
    return workout_id, scheduled_id


def _adopt(
    user_id: str, sync: GarminSync, wanted: dict[str, TrainingSession], links: dict[str, dict], today: date_type
) -> int:
    """Give unlinked sessions the Garmin workout an old manual sync already created."""
    unlinked = {sid: s for sid, s in wanted.items() if sid not in links}
    if not unlinked:
        return 0
    start = min(s.date for s in unlinked.values())
    end = max(s.date for s in unlinked.values())
    calendar: dict[tuple, ScheduledWorkout] = {
        session_key(w.date, w.title): w for w in sync.list_scheduled_workouts(start, end)
    }
    taken = {(row.get("workout_id")) for row in links.values()}
    adopted = 0
    for sid, session in unlinked.items():
        match = calendar.get(session_key(session.date, session.title))
        if match is None or match.workout_id in taken:
            continue
        # Hash left empty on purpose: the content was never compared, so the next step
        # replaces it once with exactly what the plan says.
        _save_link(
            user_id, sid, workout_id=match.workout_id, scheduled_id=match.scheduled_workout_id,
            garmin_date=match.date, pushed_hash=None, status="pending", error=None, attempts=0,
        )
        links[sid] = {"workout_id": match.workout_id, "scheduled_id": match.scheduled_workout_id,
                      "pushed_hash": None, "attempts": 0}
        taken.add(match.workout_id)
        adopted += 1
    return adopted


def reconcile(user_id: str, sync: GarminSync, *, today: date_type | None = None) -> ReconcileReport:
    today = today or date_type.today()
    report = ReconcileReport()
    wanted = wanted_sessions(user_id, today)
    links = _links(user_id)
    report.adopted = _adopt(user_id, sync, wanted, links, today)

    # Off Garmin first: a session moved to another day must not briefly exist twice.
    for sid, link in list(links.items()):
        if sid in wanted:
            continue
        garmin_date = link.get("garmin_date")
        # A past session that simply left the window stays on the calendar as history.
        past = garmin_date is not None and garmin_date < today - timedelta(days=1)
        if past and _session_exists(user_id, sid):
            continue
        try:
            _remove(sync, link)
            _drop_link(user_id, sid)
            report.deleted += 1
        except GarminRateLimitError as exc:
            report.stopped_early = str(exc)
            return report
        except Exception as exc:  # noqa: BLE001 - kept on the link, retried next time
            _fail(user_id, sid, f"rimozione: {exc}", link.get("attempts") or 0)
            report.failed += 1
        time.sleep(WRITE_PAUSE_S)

    for sid, session in sorted(wanted.items(), key=lambda kv: kv[1].date):
        link = links.get(sid) or {}
        digest = content_hash(sync, session)
        if link.get("pushed_hash") == digest and link.get("status") == "ok":
            continue
        try:
            if link.get("workout_id"):
                _remove(sync, link)
            workout_id, scheduled_id = _push(sync, session)
        except GarminRateLimitError as exc:
            _save_link(user_id, sid, status="pending", error="Garmin ha chiesto di rallentare: riprovo più tardi")
            report.stopped_early = str(exc)
            return report
        except Exception as exc:  # noqa: BLE001 - kept on the link, retried next time
            # The old workout may be gone already: forget it so the retry only creates.
            _save_link(user_id, sid, workout_id=None, scheduled_id=None, garmin_date=None, pushed_hash=None)
            _fail(user_id, sid, str(exc), link.get("attempts") or 0)
            report.failed += 1
        else:
            _save_link(
                user_id, sid, workout_id=workout_id, scheduled_id=scheduled_id, garmin_date=session.date,
                pushed_hash=digest, status="ok", error=None, attempts=0,
            )
            report.pushed += 1
        time.sleep(WRITE_PAUSE_S)
    return report


def _session_exists(user_id: str, session_id: str) -> bool:
    with db.connect() as conn:
        return conn.execute(
            "SELECT 1 FROM plan_session WHERE user_id = %s AND id = %s", [user_id, session_id]
        ).fetchone() is not None


def pull_moves(user_id: str, calendar: list[ScheduledWorkout]) -> int:
    """A workout moved on Garmin Connect (or on the watch) moves its plan session too.

    Matched by the Garmin workout id remembered in `garmin_link`, never by title: the
    old matching (same title and sport within seven days) took this week's "Corsa
    facile" for next week's and moved it there, so a plan with recurring titles slid a
    week forward -- sessions vanished, others doubled up -- every time the calendar was
    read. Returns how many sessions moved.
    """
    from . import plan_store

    links = {row.get("workout_id"): (sid, row) for sid, row in _links(user_id).items() if row.get("workout_id")}
    moved = 0
    for workout in calendar:
        hit = links.get(workout.workout_id)
        if hit is None:
            continue
        sid, link = hit
        if link.get("garmin_date") in (None, workout.date):
            continue
        try:
            plan_store.update_session(user_id, sid, {"date": workout.date.isoformat()}, by_user=True)
        except plan_store.SessionNotFound:
            continue
        digest = link.get("pushed_hash")
        if digest and "|" in digest:
            digest = workout.date.isoformat() + digest[digest.index("|"):]
        _save_link(user_id, sid, garmin_date=workout.date, scheduled_id=workout.scheduled_workout_id,
                   pushed_hash=digest)
        moved += 1
    return moved


def mark_pending(user_id: str, session_ids: list[str]) -> None:
    """An edit just happened: show these as on their way before the push even starts."""
    for sid in session_ids:
        _save_link(user_id, sid, status="pending", error=None)


def status(user_id: str, today: date_type | None = None) -> dict[str, Any]:
    """Per-session push state for the window, for the screens. One query, no Garmin call."""
    today = today or date_type.today()
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """SELECT ps.id, ps.date, ps.title, gl.status, gl.error, gl.updated_at
               FROM plan_session ps
               LEFT JOIN user_training_plan utp ON utp.user_id = ps.user_id AND utp.id = ps.plan_id
               LEFT JOIN garmin_link gl ON gl.user_id = ps.user_id AND gl.session_id = ps.id
               WHERE ps.user_id = %s AND ps.date BETWEEN %s AND %s AND (utp.id IS NULL OR utp.is_active)
               ORDER BY ps.date""",
            [user_id, today - timedelta(days=1), today + timedelta(days=WINDOW_DAYS)],
        )
        rows = cur.fetchall()
    sessions = [
        {
            "session_id": str(r["id"]),
            "date": r["date"].isoformat(),
            "title": r["title"],
            "status": r["status"] or "pending",
            "error": r["error"],
        }
        for r in rows
    ]
    counts = {k: sum(1 for s in sessions if s["status"] == k) for k in ("ok", "pending", "failed")}
    return {"running": is_running(user_id), "counts": counts, "sessions": sessions}


# ---- one reconcile at a time per user -------------------------------------------------------------

_lock = threading.Lock()
_running: set[str] = set()
_again: set[str] = set()


def is_running(user_id: str) -> bool:
    with _lock:
        return user_id in _running


def run_for(user_id: str, open_sync) -> ReconcileReport | None:
    """Reconcile now, unless one is already running for this user: then it is asked to
    run once more when done, so a burst of edits costs one or two passes, not one each.

    `open_sync(work)` runs `work(sync)` against the user's Garmin session.
    """
    with _lock:
        if user_id in _running:
            _again.add(user_id)
            return None
        _running.add(user_id)
    last = None
    try:
        while True:
            try:
                last = open_sync(lambda sync: reconcile(user_id, sync))
            except Exception:
                logger.warning("garmin push for %s did not run", user_id, exc_info=True)
            with _lock:
                if user_id not in _again:
                    return last
                _again.discard(user_id)
    finally:
        with _lock:
            _running.discard(user_id)
