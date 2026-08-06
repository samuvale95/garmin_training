"""A small in-process TTL cache for the read-only endpoints.

Every read this app serves comes from Garmin or Strava over the network -- there is no
local database to fall back on (design.md: the plan itself is device-only). So a screen
that mounts six queries, or a user bouncing between Oggi and Settimana, used to re-pay
the full upstream cost every time even though the answers cannot meaningfully change
second to second.

Values are cached per (namespace, key) with a per-call TTL, and namespaces are the unit
of invalidation: a write that changes the Garmin calendar drops `garmin:workouts` and
`plan:diff` wholesale rather than trying to patch individual entries.

Deliberately not thread-locked around the *factory*: two concurrent misses may both
call upstream and the last one wins. Serializing them would mean holding a lock across
a multi-second network call, and these are idempotent reads where a duplicate costs a
request, not correctness. The store itself is lock-protected.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable, Hashable, Iterable
from typing import Any, TypeVar

T = TypeVar("T")

# How long each kind of answer stays good. Chosen from how fast the underlying thing
# actually changes: the calendar only changes when this app writes to it, a workout's
# step structure only changes when it is edited here (which drops the entry outright,
# see CALENDAR_NAMESPACES), and overnight wellness figures are computed once a day by
# Garmin itself.
TTL_GARMIN_WORKOUTS = 60
TTL_GARMIN_ACTIVITIES = 5 * 60
TTL_GARMIN_WORKOUT_SESSION = 60 * 60
TTL_GARMIN_DEVICE = 5 * 60
TTL_BODY_TODAY = 10 * 60
TTL_BODY_LOAD = 30 * 60
TTL_STRAVA_MATCH = 5 * 60
TTL_STRAVA_SHOES = 5 * 60
# Who the user is (name + avatar) changes about never, and both endpoints are read on
# every screen that shows the avatar -- so they get the longest TTL here. Connect and
# disconnect invalidate them anyway, which covers the only case that matters: a
# different account behind the token.
TTL_STRAVA_ATHLETE = 60 * 60
TTL_GARMIN_PROFILE = 60 * 60
# Weight/height/age. Two Garmin calls, and a body weight moves by amounts that matter to
# a gram-per-kilo target roughly never within a day -- but shorter than the profile TTLs
# above, because a user who steps on the scale to fix their fuelling targets should not
# have to wait an hour to see it land.
TTL_BODY_METRICS = 30 * 60
# Matched to the client's own staleTime for this query: the diff can only go stale if the
# plan changes (a different cache key) or the calendar changes (invalidated on write).
TTL_PLAN_DIFF = 5 * 60


class TTLCache:
    def __init__(self) -> None:
        self._entries: dict[tuple[str, Hashable], tuple[float, Any]] = {}
        self._lock = threading.Lock()

    def get_or_call(
        self,
        namespace: str,
        key: Hashable,
        ttl: float,
        factory: Callable[[], T],
        *,
        refresh: bool = False,
    ) -> T:
        """The cached value for (namespace, key), or `factory()`'s result, stored.

        `refresh=True` skips the read but still writes -- that's the manual
        pull-to-refresh path: it must actually reach upstream, and everything after it
        should see the new answer.
        """
        if not refresh:
            hit = self._lookup(namespace, key)
            if hit is not None:
                return hit[0]

        value = factory()
        with self._lock:
            self._entries[(namespace, key)] = (time.monotonic() + ttl, value)
        return value

    def invalidate(self, namespaces: Iterable[str]) -> None:
        """Drop every entry in these namespaces (used after a write)."""
        targets = set(namespaces)
        with self._lock:
            for entry_key in [k for k in self._entries if k[0] in targets]:
                del self._entries[entry_key]

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    def _lookup(self, namespace: str, key: Hashable) -> tuple[Any] | None:
        """`(value,)` on a live hit, `None` on a miss -- wrapped in a tuple so a cached
        `None`/falsy value is still a hit."""
        with self._lock:
            entry = self._entries.get((namespace, key))
            if entry is None:
                return None
            expires_at, value = entry
            if expires_at <= time.monotonic():
                del self._entries[(namespace, key)]
                return None
            return (value,)


cache = TTLCache()

# Namespaces holding anything derived from the Garmin *calendar*, i.e. everything a
# create/replace/delete makes stale. `garmin:workout-session` is in here because a
# workout's step structure stopped being immutable the moment the app could edit one:
# an edit replaces the workout, and its cached structure describes the version that no
# longer exists.
CALENDAR_NAMESPACES = ("garmin:workouts", "garmin:workout-session", "plan:diff")


def invalidate_calendar() -> None:
    cache.invalidate(CALENDAR_NAMESPACES)
