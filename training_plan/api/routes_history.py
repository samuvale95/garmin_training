"""Keeping the stored history current.

Before this, the history only grew when someone ran the backfill by hand, so every
screen built on it -- `/coach/plan` above all -- described the athlete as of the last
manual run. Now the web app asks for a sync when it opens, and this decides whether one
is due: a full backfill the first time, a short incremental one after, never more than
one at a time and never more often than the throttle allows.
"""

from __future__ import annotations

import logging
import threading

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool

from .. import backfill, history
from . import schemas
from .auth import current_user_id
from .cache import cache

logger = logging.getLogger(__name__)

router = APIRouter()

# The screens whose answers a new activity can change. `/coach/plan` would notice on its
# own through `streams_version`; `/coach/execution` keys on the plan, not the history.
_HISTORY_CACHES = ("coach:plan", "coach:execution")


def _run_in_background(user_id: str, mode: str) -> None:
    try:
        backfill.sync_user(user_id, mode)
    except Exception:  # noqa: BLE001 - already logged and released; nobody is waiting
        return
    finally:
        cache.invalidate(_HISTORY_CACHES, user_id)


@router.post("/history/sync", response_model=schemas.HistorySyncResponse)
async def history_sync(user_id: str = Depends(current_user_id)) -> schemas.HistorySyncResponse:
    """Start a sync if one is due, and return at once.

    The work runs on its own thread: a first backfill takes the better part of an hour,
    and nothing about opening the app should wait for it.
    """

    def claim() -> str | None:
        if not history.claim_sync(user_id, throttle_s=backfill.SYNC_THROTTLE_S, stale_s=backfill.SYNC_STALE_S):
            return None
        try:
            return backfill.sync_mode(user_id)
        except Exception:
            history.release_sync(user_id, note="failed before starting")
            raise

    mode = await run_in_threadpool(claim)
    if mode is not None:
        threading.Thread(
            target=_run_in_background, args=(user_id, mode), name=f"history-sync-{mode}", daemon=True
        ).start()
    return schemas.HistorySyncResponse(started=mode is not None, mode=mode)
