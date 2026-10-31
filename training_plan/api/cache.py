"""A small in-process TTL cache for the read-only endpoints.

Every read this app serves comes from Garmin or Strava over the network -- there is no
local database to fall back on (design.md: the plan itself is device-only). So a screen
that mounts six queries, or a user bouncing between Oggi and Settimana, used to re-pay
the full upstream cost every time even though the answers cannot meaningfully change
second to second.

Values are cached per (namespace, user_id, key) with a per-call TTL, and namespaces are
the unit of invalidation: a write that changes the Garmin calendar drops
`garmin:workouts` and `plan:diff` wholesale rather than trying to patch individual
entries. `user_id` is mandatory, not an extra key component tacked on by convention:
this cache is shared by every request the process serves, so a lookup that forgot it
would hand one person's Garmin/Strava reads to whoever asks next -- see the incident
this was written to prevent, `garmin_session.py`'s docstring on why the old singleton
had to go.

Concurrent misses on the *same* key share one factory call (single flight): the
followers wait on the leader's result -- or its exception -- instead of each calling
upstream. Different keys never wait on each other, and the global lock is never held
across a factory call, only around the store and the in-flight table.
"""

from __future__ import annotations

import json
import logging
import pickle
import threading
import time
from concurrent.futures import Future
from collections.abc import Callable, Hashable, Iterable
from datetime import date, timedelta
from typing import Any, TypeVar

from .. import db

T = TypeVar("T")

logger = logging.getLogger(__name__)

# Stale-while-revalidate. For these namespaces an expired answer is still served -- at
# once -- while a fresh one is fetched in the background, and the answer is also kept in
# Postgres so a server that was asleep (Render's free tier sleeps after 15 idle minutes,
# and loses this whole in-memory cache) answers from the last copy instead of making the
# user wait for eleven Garmin calls. All are read-only snapshots of things that change
# slowly (overnight wellness, the activity list, device, shoes); the calendar namespaces
# are deliberately not here: after an edit the calendar must be exactly right, and those
# entries are dropped outright (`invalidate_calendar`).
SWR_NAMESPACES = frozenset({
    "body:today", "body:load", "garmin:body_metrics", "garmin:activities", "garmin:device",
    "garmin:profile", "garmin:day-energy", "strava:shoes", "strava:athlete", "strava:matches",
    "strava:match", "coach:zones", "coach:technique", "coach:workout_analysis", "coach:trend",
    "coach:execution", "profile:level", "nutrition:targets",
})
# Older than this an answer is not shown even as a placeholder: it would mislead.
MAX_STALE_S = 24 * 60 * 60

SNAPSHOT_SCHEMA = """
CREATE TABLE IF NOT EXISTS api_cache_snapshot (
    namespace  TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    cache_key  TEXT NOT NULL,
    value      BYTEA NOT NULL,
    stored_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (namespace, user_id, cache_key)
);
"""


def ensure_schema() -> None:
    with db.connect() as conn:
        conn.execute(SNAPSHOT_SCHEMA)


def _key_text(key: Hashable) -> str:
    return json.dumps(key, default=str, sort_keys=True)


def _load_snapshot(namespace: str, user_id: str, key: Hashable) -> tuple[Any, float] | None:
    """(value, age in seconds) from Postgres, or None. Any failure is just a miss."""
    try:
        with db.connect() as conn:
            row = conn.execute(
                "SELECT value, extract(epoch FROM now() - stored_at) FROM api_cache_snapshot "
                "WHERE namespace = %s AND user_id = %s AND cache_key = %s",
                [namespace, user_id, _key_text(key)],
            ).fetchone()
        if row is None or float(row[1]) > MAX_STALE_S:
            return None
        return pickle.loads(bytes(row[0])), float(row[1])  # noqa: S301 - our own rows only
    except Exception:  # noqa: BLE001
        logger.debug("cache snapshot read failed", exc_info=True)
        return None


def _save_snapshot(namespace: str, user_id: str, key: Hashable, value: Any) -> None:
    try:
        blob = pickle.dumps(value)
        with db.connect() as conn:
            conn.execute(
                "INSERT INTO api_cache_snapshot (namespace, user_id, cache_key, value, stored_at) "
                "VALUES (%s, %s, %s, %s, now()) ON CONFLICT (namespace, user_id, cache_key) "
                "DO UPDATE SET value = EXCLUDED.value, stored_at = now()",
                [namespace, user_id, _key_text(key), blob],
            )
    except Exception:  # noqa: BLE001 - the snapshot is a speed-up, never a requirement
        logger.debug("cache snapshot write failed", exc_info=True)


def _drop_snapshots(namespaces: Iterable[str] | None, user_id: str) -> None:
    try:
        with db.connect() as conn:
            if namespaces is None:
                conn.execute("DELETE FROM api_cache_snapshot WHERE user_id = %s", [user_id])
            else:
                conn.execute(
                    "DELETE FROM api_cache_snapshot WHERE user_id = %s AND namespace = ANY(%s)",
                    [user_id, list(namespaces)],
                )
    except Exception:  # noqa: BLE001
        logger.debug("cache snapshot invalidation failed", exc_info=True)

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
# Garmin's calories and steps for today: they grow through the day.
TTL_GARMIN_DAY_ENERGY = 10 * 60
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

# The fuelling screen's two slow answers. Targets are arithmetic over a Garmin weight
# read; the narrative is a language-model call on top of that, and it is the one thing
# on the screen a user actually waits for. Both are keyed by everything they depend on
# (day, plan, weight -- and, for the narrative, what has been eaten so far), so the TTL
# only has to cover "the same screen, opened again".
TTL_NUTRITION_TARGETS = 30 * 60
TTL_NUTRITION_NARRATIVE = 30 * 60

# The day's verdict is arithmetic over an already-cached snapshot, so it is not cached
# itself -- only the sentence the model writes about it, which is the slow part. Keyed
# by the verdict it describes, so it changes exactly when the verdict does.
TTL_READINESS_NARRATIVE = 30 * 60

# How the plan lines up with the race: arithmetic, so not cached -- but the sentence
# written about it is a model call, keyed on the conclusion it describes.
TTL_GOAL_FIT_NARRATIVE = 30 * 60
# The week summary's sentence: keyed on the facts it phrases, so it changes when they do.
TTL_SUMMARY_NARRATIVE = 24 * 60 * 60

# A finished activity is a fact and its form metrics never change again, so the only
# thing bounding this TTL is how long the process should hold the answer at all. The
# coach narrative on top of it is a model call, keyed by the same activity.
TTL_COACH_TECHNIQUE = 24 * 60 * 60
TTL_COACH_NARRATIVE = 24 * 60 * 60
TTL_COACH_WORKOUT_ANALYSIS = 24 * 60 * 60
# The trend is keyed by the exact activity list it covers, and that list changes the
# moment a new session syncs -- so a shorter TTL buys nothing the key does not already.
TTL_COACH_TREND = 24 * 60 * 60
# The execution read is the most expensive answer this app produces -- a Strava match
# plus one stream fetch per session in the block. It describes finished sessions, so the
# only thing that can change it is a new activity syncing, which changes the key.
TTL_COACH_EXECUTION = 24 * 60 * 60
# The diagnosis reads a year of stored streams, so it is the heaviest computation here --
# but it is all local, and what it describes only changes when a new session syncs.
TTL_COACH_PLAN = 6 * 60 * 60
# Garmin's threshold estimate moves after a hard session at most: hours are fine.
TTL_COACH_ZONES = 6 * 60 * 60
# The level is keyed on the stored activities, so a new session recomputes it on the next
# read; the TTL only bounds how stale the Garmin threshold part can get. The day matters
# too -- weeks complete and pauses begin without any new activity -- so it is in the key.
TTL_PROFILE_LEVEL = 6 * 60 * 60

# A date range that has already ended has nothing left to say: a completed activity is a
# fact, and the calendar for a past week only changes when this app writes to it -- which
# drops CALENDAR_NAMESPACES wholesale, so a long TTL here can never serve a stale answer
# after a write. This is what makes paging back through past weeks free instead of a
# Garmin round-trip per minute (TTL_GARMIN_WORKOUTS above is deliberately short, because
# the *current* week is what a second device might be changing underneath us).
TTL_PAST_RANGE = 24 * 60 * 60
# The client sends dates in its own local calendar and this process may be running in a
# different timezone, so "ended" means ended the day before yesterday -- never a range
# that is still today for whoever asked.
PAST_RANGE_MARGIN = timedelta(days=1)


def range_ttl(end: date, live_ttl: float, *, today: date | None = None) -> float:
    """`TTL_PAST_RANGE` for a range that ended before yesterday, `live_ttl` otherwise."""
    return TTL_PAST_RANGE if end < (today or date.today()) - PAST_RANGE_MARGIN else live_ttl


class TTLCache:
    def __init__(self) -> None:
        self._entries: dict[tuple[str, str, Hashable], tuple[float, Any]] = {}
        self._lock = threading.Lock()
        self._inflight: dict[tuple[str, str, Hashable], Future] = {}
        # When each entry was stored, for the stale-while-revalidate age limit.
        self._stored: dict[tuple[str, str, Hashable], float] = {}

    def get_or_call(
        self,
        namespace: str,
        user_id: str,
        key: Hashable,
        ttl: float,
        factory: Callable[[], T],
        *,
        refresh: bool = False,
    ) -> T:
        """The cached value for (namespace, user_id, key), or `factory()`'s result,
        stored. `user_id` is not optional: see the module docstring for why.

        `refresh=True` skips the read but still writes -- that's the manual
        pull-to-refresh path: it must actually reach upstream, and everything after it
        should see the new answer.
        """
        is_narrative_ns = namespace in (
            "body:readiness-narrative",
            "nutrition:narrative",
            "coach:narrative",
            "coach:workout_narrative",
            "goal:fit-narrative",
            "summary:narrative",
        )

        if not refresh:
            hit = self._lookup(namespace, user_id, key)
            if hit is not None:
                return hit[0]
            if namespace in SWR_NAMESPACES:
                stale = self._stale(namespace, user_id, key)
                if stale is not None:
                    self._refresh_in_background(namespace, user_id, key, ttl, factory)
                    return stale[0]

            # Cross-process persistent check for expensive AI narratives
            if is_narrative_ns:
                cache_key_str = json.dumps(key, default=str, sort_keys=True)
                persisted = db.get_narrative_cache(namespace, user_id, cache_key_str)
                if persisted is not None and isinstance(persisted, dict) and "text" in persisted:
                    from . import schemas
                    val = schemas.NarrativeResponse(**persisted)  # type: ignore[assignment]
                    with self._lock:
                        self._entries[(namespace, user_id, key)] = (time.monotonic() + ttl, val)
                    return val  # type: ignore[return-value]

        if refresh:
            return self._compute(namespace, user_id, key, ttl, factory, is_narrative_ns)

        # Single flight: a concurrent miss on the same key waits for the call already in
        # progress instead of starting its own. The fuel screen alone asks for the same
        # Garmin weight from ten requests at once, and on a 0.1-CPU host the duplicates
        # were what pushed every request past the client's timeout.
        entry_key = (namespace, user_id, key)
        with self._lock:
            flight = self._inflight.get(entry_key)
            leader = flight is None
            if leader:
                flight = self._inflight[entry_key] = Future()
        if not leader:
            return flight.result()
        try:
            value = self._compute(namespace, user_id, key, ttl, factory, is_narrative_ns)
        except BaseException as exc:
            flight.set_exception(exc)
            raise
        else:
            flight.set_result(value)
            return value
        finally:
            with self._lock:
                self._inflight.pop(entry_key, None)

    def _compute(
        self,
        namespace: str,
        user_id: str,
        key: Hashable,
        ttl: float,
        factory: Callable[[], T],
        is_narrative_ns: bool,
    ) -> T:
        value = factory()
        with self._lock:
            self._entries[(namespace, user_id, key)] = (time.monotonic() + ttl, value)
            self._stored[(namespace, user_id, key)] = time.monotonic()
        if namespace in SWR_NAMESPACES:
            threading.Thread(target=_save_snapshot, args=(namespace, user_id, key, value), daemon=True).start()

        # Cross-process persistent write for expensive AI narratives
        if is_narrative_ns and hasattr(value, "model_dump"):
            try:
                cache_key_str = json.dumps(key, default=str, sort_keys=True)
                db.put_narrative_cache(namespace, user_id, cache_key_str, value.model_dump(), ttl)
            except Exception:
                pass

        return value

    def put(self, namespace: str, user_id: str, key: Hashable, ttl: float, value: Any) -> None:
        """Store a value someone else already paid for.

        The one caller is `/coach/trend`, which reads several activities in one fan-out
        and seeds each one into the per-activity namespace `/coach/technique/{id}`
        reads from -- without this, the two endpoints would fetch the same activity
        twice within a second of each other.
        """
        with self._lock:
            self._entries[(namespace, user_id, key)] = (time.monotonic() + ttl, value)
            self._stored[(namespace, user_id, key)] = time.monotonic()

    def invalidate(self, namespaces: Iterable[str], user_id: str) -> None:
        """Drop this user's entries in these namespaces (used after a write)."""
        targets = set(namespaces)
        with self._lock:
            for entry_key in [k for k in self._entries if k[0] in targets and k[1] == user_id]:
                del self._entries[entry_key]
                self._stored.pop(entry_key, None)
        if targets & SWR_NAMESPACES:
            _drop_snapshots(targets & SWR_NAMESPACES, user_id)
        narrative_targets = [ns for ns in targets if "narrative" in ns]
        if narrative_targets:
            db.invalidate_narrative_cache(narrative_targets, user_id)

    def invalidate_user(self, user_id: str) -> None:
        """Drop every cached entry for one user, across every namespace -- used on
        Garmin/Strava connect/disconnect, where a different account may now be behind
        the token and nothing cached under the old one is still true."""
        with self._lock:
            for entry_key in [k for k in self._entries if k[1] == user_id]:
                del self._entries[entry_key]
                self._stored.pop(entry_key, None)
        _drop_snapshots(None, user_id)
        db.invalidate_narrative_cache(
            [
                "body:readiness-narrative",
                "nutrition:narrative",
                "coach:narrative",
                "coach:workout_narrative",
                "goal:fit-narrative",
                "summary:narrative",
            ],
            user_id,
        )

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    def _lookup(self, namespace: str, user_id: str, key: Hashable) -> tuple[Any] | None:
        """`(value,)` on a live hit, `None` on a miss -- wrapped in a tuple so a cached
        `None`/falsy value is still a hit."""
        with self._lock:
            entry = self._entries.get((namespace, user_id, key))
            if entry is None:
                return None
            expires_at, value = entry
            if expires_at <= time.monotonic():
                # Kept for stale-while-revalidate; `_stale` decides whether it may serve.
                if namespace not in SWR_NAMESPACES:
                    del self._entries[(namespace, user_id, key)]
                    self._stored.pop((namespace, user_id, key), None)
                return None
            return (value,)

    def _stale(self, namespace: str, user_id: str, key: Hashable) -> tuple[Any] | None:
        """An expired-but-recent answer from memory, else from the Postgres snapshot."""
        entry_key = (namespace, user_id, key)
        with self._lock:
            entry = self._entries.get(entry_key)
            stored = self._stored.get(entry_key)
            if entry is not None and stored is not None and time.monotonic() - stored <= MAX_STALE_S:
                return (entry[1],)
        snapshot = _load_snapshot(namespace, user_id, key)
        if snapshot is None:
            return None
        value, age = snapshot
        with self._lock:
            # Expired already (it is a snapshot): the refresh that follows replaces it.
            self._entries[entry_key] = (time.monotonic() - 1, value)
            self._stored[entry_key] = time.monotonic() - age
        return (value,)

    def _refresh_in_background(
        self, namespace: str, user_id: str, key: Hashable, ttl: float, factory: Callable[[], Any]
    ) -> None:
        entry_key = (namespace, user_id, key)
        with self._lock:
            if entry_key in self._inflight:
                return
            flight = self._inflight[entry_key] = Future()

        def work() -> None:
            try:
                flight.set_result(self._compute(namespace, user_id, key, ttl, factory, False))
            except BaseException as exc:  # noqa: BLE001 - the stale answer stays; next read retries
                flight.set_exception(exc)
                logger.info("background refresh of %s failed: %s", namespace, exc)
            finally:
                with self._lock:
                    self._inflight.pop(entry_key, None)

        threading.Thread(target=work, daemon=True).start()


cache = TTLCache()

# Namespaces holding anything derived from the Garmin *calendar*, i.e. everything a
# create/replace/delete makes stale. `garmin:workout-session` is in here because a
# workout's step structure stopped being immutable the moment the app could edit one:
# an edit replaces the workout, and its cached structure describes the version that no
# longer exists.
CALENDAR_NAMESPACES = ("garmin:workouts", "garmin:workout-session", "plan:diff")


def invalidate_calendar(user_id: str) -> None:
    cache.invalidate(CALENDAR_NAMESPACES, user_id)


# Logging, correcting or deleting a meal changes what the narrative is describing (it is
# written over the day's running totals), so the sentence has to go with it. Targets do
# not depend on what was eaten -- but they do depend on the weight, and a user who has
# just changed something is exactly who should not be told a stale number, so both drop
# together.
#
# Targets are deliberately NOT in this list: they are a function of the day, the plan and
# the weight, never of what was eaten. Dropping them here forced a full recompute (and a
# Garmin round-trip) right after every meal, which is exactly when it failed.
NUTRITION_NAMESPACES = ("nutrition:narrative",)


def invalidate_nutrition(user_id: str) -> None:
    cache.invalidate(NUTRITION_NAMESPACES, user_id)
