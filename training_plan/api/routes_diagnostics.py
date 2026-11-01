"""Read-only diagnostics for whoever maintains the app, behind a shared token.

The question these answer is the one a screenshot used to: "this screen shows an error
-- is the data missing, or is something broken?". Each check runs one service the app's
screens are built on and says `ok`, `vuoto` (ran fine, nothing to show: a message is
missing on screen) or `errore` (with the exception: a bug or an outage).

Deliberately narrow. These are fixed summaries, not the app's own routes served as a
user: the token reads diagnoses, never a user's screens, and cannot write. Not mounted
behind the JWT gate (the caller has no user session); `PASSO_DIAGNOSTICS_TOKEN` unset
or shorter than 32 characters turns every endpoint off.
"""

from __future__ import annotations

import hmac
import logging
import os
import time
import traceback
from collections.abc import Callable
from dataclasses import asdict, is_dataclass
from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.concurrency import run_in_threadpool

from .. import db, history, hr_sensor_report, workout_analysis

logger = logging.getLogger(__name__)

TOKEN_ENV = "PASSO_DIAGNOSTICS_TOKEN"
MIN_TOKEN_LENGTH = 32

router = APIRouter(prefix="/diagnostics")


def require_token(x_diagnostics_token: str | None = Header(default=None)) -> None:
    expected = os.getenv(TOKEN_ENV)
    if (
        not expected
        or len(expected) < MIN_TOKEN_LENGTH
        or not x_diagnostics_token
        or not hmac.compare_digest(expected, x_diagnostics_token)
    ):
        # 404, not 401: with the token unset the endpoints should look absent.
        raise HTTPException(status_code=404, detail="Not Found")


def _is_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, (list, tuple, dict, set, str)):
        return len(value) == 0
    if is_dataclass(value):
        fields = asdict(value)
        lists = [v for v in fields.values() if isinstance(v, list)]
        return bool(lists) and all(len(v) == 0 for v in lists)
    return False


def _check(name: str, call: Callable[[], Any]) -> dict[str, Any]:
    started = time.monotonic()
    try:
        value = call()
    except Exception as error:  # noqa: BLE001 - reporting it is the whole point
        frame = traceback.extract_tb(error.__traceback__)[-1]
        return {
            "check": name,
            "status": "errore",
            "error": type(error).__name__,
            "message": str(error)[:300],
            "where": f"{os.path.basename(frame.filename)}:{frame.lineno}",
            "ms": round((time.monotonic() - started) * 1000),
        }
    return {
        "check": name,
        "status": "vuoto" if _is_empty(value) else "ok",
        "ms": round((time.monotonic() - started) * 1000),
    }


def _checks(user_id: str) -> list[tuple[str, Callable[[], Any]]]:
    # Imported here: the route modules import much of the app, and this module is
    # mounted by `app.py` alongside them.
    from . import routes_body, routes_coach, routes_progress, routes_summary

    today = date.today()
    return [
        ("profilo", lambda: history.load_profile(user_id)),
        ("attivita_30_giorni", lambda: history.activities_between(user_id, today - timedelta(days=30), today)),
        ("benessere_7_giorni", lambda: history.wellness_between(user_id, today - timedelta(days=7), today)),
        ("zone_cardio", lambda: routes_coach._zones(user_id)),
        ("riepilogo_settimana", lambda: routes_summary._summary(user_id, None)),
        ("progressi", lambda: routes_progress._progress(user_id)),
        ("corpo_oggi", lambda: routes_body._body_snapshot(user_id)),
        ("obiettivo_gara", lambda: routes_body._load_user_goal(user_id)),
    ]


@router.get("/users", dependencies=[Depends(require_token)])
async def users() -> list[dict[str, Any]]:
    """Users by activity, ids only: enough to pick whom to diagnose, no personal data."""

    def read() -> list[dict[str, Any]]:
        with db.connect() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT user_id, count(*), max(day) FROM activity GROUP BY user_id ORDER BY max(day) DESC"
            )
            return [{"user_id": r[0], "activities": r[1], "last_activity": str(r[2])} for r in cur.fetchall()]

    return await run_in_threadpool(read)


@router.get("/users/{user_id}/services", dependencies=[Depends(require_token)])
async def services(user_id: str) -> dict[str, Any]:
    """Each service behind the main screens, run for this user: ok, empty or failing."""
    logger.warning("diagnostics: services for %s", user_id)
    results = await run_in_threadpool(lambda: [_check(name, call) for name, call in _checks(user_id)])
    return {
        "user_id": user_id,
        "summary": {s: sum(1 for r in results if r["status"] == s) for s in ("ok", "vuoto", "errore")},
        "checks": results,
    }


@router.get("/users/{user_id}/hr-sensors", dependencies=[Depends(require_token)])
async def hr_sensors(user_id: str, days: int = 365) -> dict[str, Any]:
    """Chest strap against wrist over the history (see `hr_sensor_report`)."""
    logger.warning("diagnostics: hr sensors for %s", user_id)
    report = await run_in_threadpool(hr_sensor_report.build, user_id, days=min(max(days, 7), 1095))
    return {
        "by_source": {
            k: {**asdict(v), "problem_share": round(v.problem_share, 3)} for k, v in report.by_source.items()
        },
        "conclusion": report.conclusion,
    }


@router.get("/users/{user_id}/activities/{activity_id}/analysis", dependencies=[Depends(require_token)])
async def analysis(user_id: str, activity_id: int) -> dict[str, Any]:
    """The workout analysis of one stored activity, as the analysis screen computes it."""
    logger.warning("diagnostics: analysis of %s for %s", activity_id, user_id)
    result = await run_in_threadpool(workout_analysis.compute_workout_analysis, user_id, activity_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Attività o stream non trovati")
    return asdict(result)
