"""The one-time job that gives this app a past.

Everything interesting the app could say -- am I getting fitter, do my easy days stay
easy, what did I eat before the sessions that went well -- is a question about a series,
and the series has to be fetched once before it exists. That is what this does.

It is written around one constraint, which dominates every other design decision here:
**Garmin rate-limits by IP, undocumented, and this codebase already carries cooldown
machinery because that limit has been met.** The wellness endpoints are per-day -- one
call per metric per date -- so two years is several thousand requests, and the difference
between a job that finishes and an account in timeout is entirely how politely it asks.

So:

- **Slow on purpose.** A pause between days, configurable, defaulting to something no
  reasonable rate limiter would object to. The job is meant to run in the background for
  an hour, not to finish in five minutes.
- **Resumable, always.** Every day is written as it is fetched and the cursor is stored
  in Postgres, so an interruption -- a laptop lid, a timeout, a rate limit -- costs the
  day in flight and nothing else. Re-running skips what is already stored.
- **Newest first.** If it only ever gets through part of the history, the part it got is
  the part worth having: recent data answers more questions than 2023 does.
- **One bad day never stops the run.** A single missing endpoint is logged and left null;
  the row still lands with whatever else came back.

The Strava half is cheaper -- activities come back in one ranged call, and only the
streams cost one request each -- but the same rules apply for the same reasons.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date as date_type
from datetime import timedelta

from . import history
from .api import user_tokenstore
from .garmin_sync import GarminRateLimitError, GarminSync
from .strava_sync import StravaSync

logger = logging.getLogger(__name__)

# Seconds between two days' worth of Garmin calls. Five requests go out per day, so this
# works out well under one request per second averaged -- deliberately unhurried.
GARMIN_DAY_PAUSE_S = 1.5

# Seconds between two Strava stream fetches. Strava publishes its limits (roughly a
# hundred requests per fifteen minutes on the standard tier, though the figure has moved
# more than once) -- one every two seconds sits comfortably inside any of them.
STRAVA_STREAM_PAUSE_S = 2.0

# After a rate limit, how long to wait before trying the next day, and how many times to
# accept one before giving up on the run entirely. Backing off and continuing is right
# for a transient limit; hammering through ten of them is how a temporary throttle
# becomes a locked account.
RATE_LIMIT_BACKOFF_S = 120.0
MAX_RATE_LIMITS = 3


@dataclass
class BackfillReport:
    days_written: int = 0
    days_skipped: int = 0
    days_failed: int = 0
    activities_written: int = 0
    streams_written: int = 0
    stream_packed_bytes: int = 0
    stream_raw_bytes: int = 0
    stopped_early: str | None = None
    errors: list[str] = field(default_factory=list)

    def merge(self, other: "BackfillReport") -> "BackfillReport":
        self.days_written += other.days_written
        self.days_skipped += other.days_skipped
        self.days_failed += other.days_failed
        self.activities_written += other.activities_written
        self.streams_written += other.streams_written
        self.stream_packed_bytes += other.stream_packed_bytes
        self.stream_raw_bytes += other.stream_raw_bytes
        self.stopped_early = self.stopped_early or other.stopped_early
        self.errors.extend(other.errors)
        return self


def _get(d, *keys, default=None):
    if not isinstance(d, dict):
        return default
    for key in keys:
        value = d.get(key)
        if value is not None:
            return value
    return default


def _minutes(seconds) -> int | None:
    return None if seconds is None else round(int(seconds) / 60)


def _int(value) -> int | None:
    return round(value) if isinstance(value, (int, float)) else None


def _float(value) -> float | None:
    return float(value) if isinstance(value, (int, float)) else None


# The failures that are worth a second try: the network dropped, not "this endpoint has
# nothing for that date". Over several hundred days a transient reset is a certainty, and
# treating one as no-data would leave a hole no later run would ever fill.
TRANSIENT_ERRORS = (ConnectionError, TimeoutError, OSError)
TRANSIENT_ATTEMPTS = 3
TRANSIENT_PAUSE_S = 3.0

# How many times a database write is retried, and how long it waits between attempts.
# A pooled connection that has gone stale fails once and succeeds immediately after
# (the pool replaces it), so a short ladder covers the case that actually happens.
DB_WRITE_ATTEMPTS = 3
DB_RETRY_PAUSE_S = 2.0


def _with_retry(call: Callable[[], object], what: str):
    """A network read, retried for the failures worth retrying.

    The Strava half needs this as much as the Garmin half does -- more, arguably, since
    one dropped call to `list_activities` used to take down the activities phase *and*
    the streams phase behind it, which depends on the ids it writes.
    """
    for attempt_index in range(TRANSIENT_ATTEMPTS):
        try:
            return call()
        except TRANSIENT_ERRORS:
            logger.warning(
                "%s: connessione caduta (tentativo %s/%s)", what, attempt_index + 1, TRANSIENT_ATTEMPTS
            )
            if attempt_index + 1 < TRANSIENT_ATTEMPTS:
                time.sleep(TRANSIENT_PAUSE_S)
    raise ConnectionError(f"{what}: connessione caduta {TRANSIENT_ATTEMPTS} volte")


def _write_with_retry(write: Callable[[], None]) -> bool:
    """True when the write landed. The database is as fallible as the API over a run
    this long, and one dropped connection must not cost an hour of fetching."""
    for attempt in range(DB_WRITE_ATTEMPTS):
        try:
            write()
            return True
        except Exception:  # noqa: BLE001 - a transient database error is not a failed run
            logger.warning("database write failed (attempt %s/%s)", attempt + 1, DB_WRITE_ATTEMPTS, exc_info=True)
            if attempt + 1 < DB_WRITE_ATTEMPTS:
                time.sleep(DB_RETRY_PAUSE_S)
    return False


# ---- one day of wellness ---------------------------------------------------------------


def fetch_day(client, day: date_type) -> dict:
    """The five per-day Garmin reads, flattened into one `wellness_day` row.

    Sequential rather than fanned out: the whole point of this job is to be gentle, and
    five concurrent requests per day multiplied across a year is exactly the shape that
    trips a rate limiter. Each call is individually wrapped -- a missing endpoint on one
    day costs that column, not the row and not the run.
    """
    day_str = day.isoformat()
    values: dict = {}

    def attempt(name: str, call: Callable[[], object]):
        """One endpoint, retried only for the failures worth retrying.

        The distinction matters more than it looks. An endpoint that has no data for a
        date -- an old watch, a feature not yet owned in 2024 -- fails the same way every
        time, and retrying it just triples the request count for a null that was always
        going to be null. A *connection reset* is the opposite: the data is there, the
        socket died, and accepting the null would punch a permanent hole in the history
        -- permanent because the day gets stored anyway and a later run skips it as
        already fetched.
        """
        for attempt_index in range(TRANSIENT_ATTEMPTS):
            try:
                return call()
            except GarminRateLimitError:
                raise
            except TRANSIENT_ERRORS:
                logger.warning(
                    "%s: connessione caduta su %s (tentativo %s/%s)",
                    day_str, name, attempt_index + 1, TRANSIENT_ATTEMPTS,
                )
                if attempt_index + 1 < TRANSIENT_ATTEMPTS:
                    time.sleep(TRANSIENT_PAUSE_S)
            except Exception:  # noqa: BLE001 - no data for this date is one null column
                logger.debug("%s unavailable for %s", name, day_str, exc_info=True)
                return None
        return None

    readiness = attempt("readiness", lambda: client.get_training_readiness(day_str))
    if isinstance(readiness, list):
        readiness = readiness[0] if readiness else None
    if isinstance(readiness, dict):
        values["readiness_score"] = _int(readiness.get("score"))
        values["readiness_level"] = readiness.get("level")

    sleep = attempt("sleep", lambda: client.get_sleep_data(day_str))
    sleep_dto = _get(sleep, "dailySleepDTO", default=sleep)
    if isinstance(sleep_dto, dict):
        values["sleep_total_min"] = _minutes(sleep_dto.get("sleepTimeSeconds"))
        values["sleep_deep_min"] = _minutes(sleep_dto.get("deepSleepSeconds"))
        values["sleep_light_min"] = _minutes(sleep_dto.get("lightSleepSeconds"))
        values["sleep_rem_min"] = _minutes(sleep_dto.get("remSleepSeconds"))
        values["sleep_awake_min"] = _minutes(sleep_dto.get("awakeSleepSeconds"))
        overall = _get(_get(sleep_dto, "sleepScores"), "overall")
        values["sleep_score"] = _int(overall.get("value")) if isinstance(overall, dict) else None

    hrv = attempt("hrv", lambda: client.get_hrv_data(day_str))
    summary = _get(hrv, "hrvSummary", default=hrv)
    values["hrv_ms"] = _int(_get(summary, "lastNightAvg", "lastNight5MinHigh"))

    stats = attempt("stats", lambda: client.get_stats(day_str))
    if isinstance(stats, dict):
        values["resting_hr"] = _int(stats.get("restingHeartRate"))
        values["body_battery"] = _int(stats.get("bodyBatteryMostRecentValue"))
        values["steps"] = _int(stats.get("totalSteps"))

    stress = attempt("stress", lambda: client.get_stress_data(day_str))
    values["stress_avg"] = _int(_get(stress, "avgStressLevel", "overallStressLevel"))

    return values


def backfill_wellness(
    user_id: str,
    *,
    days: int,
    end: date_type | None = None,
    pause_s: float = GARMIN_DAY_PAUSE_S,
    sync: GarminSync,
    on_progress: Callable[[int, int, date_type], None] | None = None,
) -> BackfillReport:
    """`days` days of wellness, newest first, skipping whatever is already stored."""
    report = BackfillReport()
    last = end or date_type.today()
    wanted = [last - timedelta(days=offset) for offset in range(days)]
    already = history.stored_days(user_id)
    todo = [day for day in wanted if day not in already]
    report.days_skipped = len(wanted) - len(todo)

    if not todo:
        history.set_progress(user_id, "wellness", done=True, note="niente da fare")
        return report

    client = sync.client
    rate_limits = 0

    for index, day in enumerate(todo, start=1):
        try:
            values = fetch_day(client, day)
        except GarminRateLimitError as error:
            rate_limits += 1
            logger.warning("rate limited on %s (%s/%s), backing off", day, rate_limits, MAX_RATE_LIMITS)
            report.errors.append(f"{day}: rate limit")
            if rate_limits >= MAX_RATE_LIMITS:
                report.stopped_early = f"rate limit di Garmin, fermato a {day}"
                history.set_progress(user_id, "wellness", cursor=day.isoformat(), note=str(error))
                break
            time.sleep(RATE_LIMIT_BACKOFF_S)
            continue
        except Exception as error:  # noqa: BLE001 - one bad day never stops the run
            logger.warning("day %s failed entirely", day, exc_info=True)
            report.days_failed += 1
            report.errors.append(f"{day}: {type(error).__name__}")
            continue

        # A day with nothing in it at all is a day the watch was in a drawer. Storing the
        # empty row is still right: it is the difference between "not fetched" and
        # "fetched, nothing there", and only the second one stops the job re-reading it.
        #
        # The write is retried because the database is as fallible as the API over a run
        # this long: a dropped Supabase connection used to take the whole job down and
        # throw away everything still in flight. A day that cannot be written after the
        # retries is simply left unstored, and the next run picks it up.
        if not _write_with_retry(lambda: history.save_wellness_day(user_id, day, values)):
            report.days_failed += 1
            report.errors.append(f"{day}: scrittura fallita")
            continue

        report.days_written += 1
        _write_with_retry(lambda: history.set_progress(user_id, "wellness", cursor=day.isoformat()))
        if on_progress:
            on_progress(index, len(todo), day)
        time.sleep(pause_s)

    if report.stopped_early is None:
        history.set_progress(user_id, "wellness", done=True, note=f"{report.days_written} giorni")
    return report


# ---- activities and their streams --------------------------------------------------------


def backfill_activities(
    user_id: str, *, days: int, end: date_type | None = None, strava: StravaSync
) -> BackfillReport:
    """Every Strava activity in the window, as summary rows.

    One ranged call, so this is the cheap half -- and it has to run before the streams,
    which need the ids it writes.
    """
    report = BackfillReport()
    last = end or date_type.today()
    first = last - timedelta(days=days)

    activities = _with_retry(lambda: strava.list_activities(first, last), "elenco attività Strava")
    for activity in activities:
        activity_id = activity.get("id")
        start = activity.get("start_date_local") or activity.get("start_date")
        if not activity_id or not start:
            continue
        try:
            day = date_type.fromisoformat(str(start)[:10])
        except ValueError:
            continue

        distance = activity.get("distance")
        moving = activity.get("moving_time")
        history.save_activity(
            user_id,
            "strava",
            int(activity_id),
            day,
            {
                "sport": activity.get("sport_type") or activity.get("type"),
                "title": activity.get("name"),
                "distance_km": round(distance / 1000, 2) if isinstance(distance, (int, float)) else None,
                "duration_min": round(moving / 60, 1) if isinstance(moving, (int, float)) else None,
                "avg_hr": _int(activity.get("average_heartrate")),
                "max_hr": _int(activity.get("max_heartrate")),
                "avg_cadence": _float(activity.get("average_cadence")),
                "avg_power": _float(activity.get("average_watts")),
                "elevation_gain": _float(activity.get("total_elevation_gain")),
                "summary": {
                    "has_heartrate": activity.get("has_heartrate"),
                    "elapsed_time": activity.get("elapsed_time"),
                    "type": activity.get("type"),
                },
            },
        )
        report.activities_written += 1

    history.set_progress(user_id, "activities", done=True, note=f"{report.activities_written} attività")
    return report


def backfill_streams(
    user_id: str,
    *,
    activity_ids: list[int],
    strava: StravaSync,
    pause_s: float = STRAVA_STREAM_PAUSE_S,
    on_progress: Callable[[int, int, int], None] | None = None,
) -> BackfillReport:
    """One stream fetch per activity, packed on the way in.

    The packing happens here rather than at read time so the uncompressed JSON never
    touches the database at all -- which is the whole reason the history fits in
    megabytes instead of gigabytes.
    """
    report = BackfillReport()
    already = history.stored_stream_ids(user_id)
    todo = [activity_id for activity_id in activity_ids if activity_id not in already]

    for index, activity_id in enumerate(todo, start=1):
        try:
            streams = _with_retry(
                lambda: strava.get_activity_streams(activity_id), f"stream {activity_id}"
            )
        except Exception as error:  # noqa: BLE001 - one unreadable activity is not a failed run
            logger.warning("streams failed for %s", activity_id, exc_info=True)
            report.errors.append(f"{activity_id}: {type(error).__name__}")
            time.sleep(pause_s)
            continue

        packed = history.pack_streams(streams)
        if packed is not None:
            history.save_stream(user_id, activity_id, packed)
            report.streams_written += 1
            report.stream_packed_bytes += packed.packed_bytes
            report.stream_raw_bytes += packed.raw_bytes
        if on_progress:
            on_progress(index, len(todo), activity_id)
        time.sleep(pause_s)

    history.set_progress(user_id, "streams", done=True, note=f"{report.streams_written} stream")
    return report


# ---- the whole thing ----------------------------------------------------------------------


def run(
    user_id: str,
    *,
    days: int = 730,
    wellness: bool = True,
    activities: bool = True,
    streams: bool = True,
    pause_s: float = GARMIN_DAY_PAUSE_S,
    on_progress: Callable[[str, int, int, object], None] | None = None,
) -> BackfillReport:
    """Everything, for one user, against their stored sessions.

    Opens each provider's tokenstore once for the life of the run rather than per call:
    materializing an encrypted tokenstore out of Postgres is a round trip and a temp
    directory, and doing that seven hundred times would cost more than the fetching.
    """
    history.ensure_schema()
    report = BackfillReport()

    if wellness:
        with user_tokenstore.materialized_garmin_tokenstore(user_id) as tokenstore:
            sync = GarminSync(tokenstore=str(tokenstore))
            sync.login()
            report.merge(
                backfill_wellness(
                    user_id,
                    days=days,
                    pause_s=pause_s,
                    sync=sync,
                    on_progress=(lambda i, n, day: on_progress("wellness", i, n, day)) if on_progress else None,
                )
            )

    if activities or streams:
        with user_tokenstore.materialized_strava_paths(user_id) as (tokenstore, shoestore):
            strava = StravaSync(tokenstore=str(tokenstore), shoestore=str(shoestore))
            if activities:
                report.merge(backfill_activities(user_id, days=days, strava=strava))
            if streams:
                stored = history.activities_between(
                    user_id, date_type.today() - timedelta(days=days), date_type.today()
                )
                ids = [int(row["activity_id"]) for row in stored if row["source"] == "strava"]
                report.merge(
                    backfill_streams(
                        user_id,
                        activity_ids=ids,
                        strava=strava,
                        on_progress=(lambda i, n, a: on_progress("streams", i, n, a)) if on_progress else None,
                    )
                )

    return report
