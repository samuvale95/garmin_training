"""One authenticated `GarminSync` per server process, shared across requests.

Without this, every HTTP request built its own `GarminSync` and called `login()`.
That is never free, even with a valid cached token: `garminconnect`'s `login()`
unconditionally fetches the social profile *and* the user settings before returning
(see `garminconnect/__init__.py`, "Ensure profile is loaded"), each with its own
`time.sleep(1)` retry ladder. So a page that fires six queries paid twelve extra
Garmin round-trips purely to re-establish a session it already had.

The instance is created under a lock, so a burst of concurrent first requests
performs exactly one login instead of N -- which also matters for Garmin's IP-based
rate limiter, the thing `GarminSync`'s cooldown state machine exists to protect.

Cache invalidation is deliberately narrow: `reset()` on connect/disconnect (the token
store changed underneath us) and on a `GarminSyncError` that isn't a rate limit (the
session may have gone stale server-side). Everything else keeps the session.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from typing import TypeVar

from ..garmin_sync import GarminRateLimitError, GarminSync, GarminSyncError

logger = logging.getLogger(__name__)

T = TypeVar("T")

_lock = threading.Lock()
_sync: GarminSync | None = None


def get_sync() -> GarminSync:
    """The shared authenticated session, logging in on first use.

    Raises whatever `GarminSync.login()` raises (`GarminSyncError` /
    `GarminRateLimitError`) and leaves the cache empty, so a failed login is retried
    by the next request rather than being remembered as a broken session.
    """
    return _acquire()[0]


def adopt(sync: GarminSync) -> None:
    """Install an already-authenticated session as the shared one.

    `/garmin/connect` has just logged in with real credentials; throwing that session
    away only to log in again on the next request would waste the expensive part.
    """
    global _sync
    with _lock:
        _sync = sync


def reset() -> None:
    """Forget the shared session; the next `get_sync()` logs in again."""
    global _sync
    with _lock:
        _sync = None


def run(work: Callable[[GarminSync], T]) -> T:
    """Run `work` against the shared session, healing a stale one exactly once.

    A cached Garmin session can expire or be invalidated server-side, in which case
    the *first* call using it fails. Rather than surfacing that as an error the user
    has to retry by hand, the session is dropped and `work` is re-run against a fresh
    login -- but only when the failed session was a reused one (a session this call
    just created failing again would only repeat the same failure) and never for a
    rate limit, where retrying is precisely the wrong move.

    Only for reads and idempotent work. A partially-applied write must not be
    replayed: `jobs.py` and the deletion endpoint take the session directly instead.
    """
    sync, reused = _acquire()
    try:
        return work(sync)
    except GarminRateLimitError:
        raise
    except GarminSyncError:
        reset()
        if not reused:
            raise
        logger.info("Shared Garmin session looked stale; retrying once with a fresh login")
        fresh, _ = _acquire()
        return work(fresh)


def _acquire() -> tuple[GarminSync, bool]:
    """The shared session plus whether it was already there (vs. just logged in)."""
    global _sync
    with _lock:
        if _sync is not None:
            return _sync, True
        sync = GarminSync()
        sync.login()  # raises: cache stays empty so the next request retries
        _sync = sync
        return sync, False
