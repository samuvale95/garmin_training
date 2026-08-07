"""Per-user Garmin session, materialized from Postgres for the life of one call.

Replaces the old process-wide singleton (one shared `GarminSync`, adopted on connect,
reused by every request) now that the backend serves more than one person: a session
belongs to whoever authenticated it, not to the process. `garmin_sync.py` itself is
unchanged -- this module only decides *where* its tokenstore lives at rest, via
`user_tokenstore.materialized_garmin_tokenstore`.

There is no "retry with a fresh login" healing here, unlike the old single-account
design: a per-user session has no server-held email/password to fall back to (only a
`/garmin/connect` request carries those, from the browser, once, and this process never
sees them again). A session that turns out to be stale surfaces as `GarminSyncError` --
the same error the frontend already turns into "reconnect from Settings."
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import TypeVar

from ..garmin_sync import GarminSync, GarminSyncError
from .user_tokenstore import materialized_garmin_tokenstore

logger = logging.getLogger(__name__)

T = TypeVar("T")


def connect(user_id: str, email: str, password: str, prompt_mfa: Callable[[], str] | None = None) -> None:
    """Log in with real credentials and persist the resulting session for `user_id`.

    The browser sends `email`/`password` for this one request and this process never
    stores them anywhere -- only the tokenstore `login()` produces gets persisted, by
    `materialized_garmin_tokenstore` on the way out of the `with` block.
    """
    with materialized_garmin_tokenstore(user_id) as tmp_dir:
        sync = GarminSync(email=email, password=password, tokenstore=str(tmp_dir), prompt_mfa=prompt_mfa)
        sync.login()  # raises GarminSyncError/GarminRateLimitError on failure


def disconnect(user_id: str) -> None:
    with materialized_garmin_tokenstore(user_id) as tmp_dir:
        GarminSync(tokenstore=str(tmp_dir)).disconnect()


def status(user_id: str) -> dict:
    """Cached-session/cooldown state, no network call -- see `GarminSync.connection_status`."""
    with materialized_garmin_tokenstore(user_id) as tmp_dir:
        return GarminSync(tokenstore=str(tmp_dir)).connection_status()


def run(user_id: str, work: Callable[[GarminSync], T]) -> T:
    """Run `work` against `user_id`'s Garmin session, materialized from Postgres.

    On a `GarminSyncError` (not a rate limit), the stale tokenstore is dropped so the
    next status check correctly reports "not connected" instead of a zombie session
    that would only ever fail the same way again.
    """
    with materialized_garmin_tokenstore(user_id) as tmp_dir:
        sync = GarminSync(tokenstore=str(tmp_dir))
        sync.login()  # cheap: cached tokens only, raises if there are none
        try:
            return work(sync)
        except GarminSyncError:
            logger.info("Garmin session for user looked stale; dropping the cached tokenstore")
            sync.disconnect()
            raise
