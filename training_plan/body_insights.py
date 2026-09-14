"""Read-only Garmin wellness/body data: readiness, sleep, HRV, load, VO2max, and the
derived body/plan conflict (design screens 11-13).

Nothing here writes to Garmin. Every extraction from a `garminconnect` response is
defensive (`_get(...)` with a `None` fallback): these wellness endpoints are not
officially documented and their exact field names can change without notice (the
same kind of gap `models.py` already flags for `CONDITION_TYPE_PAYLOAD`) -- readiness/
sleep/HRV/stress/battery/RHR field names here were checked against a live account.
A missing/renamed field degrades to "unavailable" rather than raising, which also
happens to be the correct behavior for the "no overnight sync yet" empty state.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date as date_type
from datetime import timedelta

from .garmin_labels import readiness_feedback, readiness_level_label
from .garmin_sync import GarminSync
from .models import TrainingSession

logger = logging.getLogger(__name__)

# Independent Garmin reads are issued concurrently, but only a few at a time: Garmin
# rate-limits per IP, so a wide fan-out trades one kind of slowness for a much worse one.
MAX_PARALLEL_GARMIN_CALLS = 6

READINESS_LOW_THRESHOLD = 60
HRV_DELTA_ALERT_MS = -15  # a drop of this many ms vs. baseline reads as a meaningful signal


def _get(d, *keys, default=None):
    if not isinstance(d, dict):
        return default
    for key in keys:
        value = d.get(key)
        if value is not None:
            return value
    return default


def _seconds_to_minutes(value) -> int | None:
    return None if value is None else round(int(value) / 60)


@dataclass
class SleepPhases:
    deep_minutes: int | None
    light_minutes: int | None
    rem_minutes: int | None
    awake_minutes: int | None
    total_minutes: int | None
    # Garmin's own 0-100 sleep score, and the word it puts next to it. Separate from the
    # phases because it is a composite of them plus movement and respiration -- the
    # screen shows both, and they can disagree.
    score: int | None = None
    score_label: str | None = None


@dataclass
class ReadinessFactor:
    """One input behind Garmin's readiness score, with the weight it carried.

    The score is a black box -- Garmin does not publish the formula -- but it *does*
    return the per-factor contribution, and a number with its inputs listed underneath
    is a different object from a bare 64. This is the whole answer to "64 what?".
    """

    key: str
    label: str
    # 0-100: how much this factor is helping today, by Garmin's own reckoning.
    percent: int | None
    # Garmin's verdict on it, already in Italian, or None when it returned a key this
    # app cannot read.
    verdict: str | None = None


@dataclass
class BodySnapshot:
    date: date_type
    has_overnight_data: bool
    readiness_score: int | None = None
    readiness_message: str | None = None
    # The band the score falls in ("media", "alta"), in Italian.
    readiness_level: str | None = None
    readiness_factors: list[ReadinessFactor] = field(default_factory=list)
    sleep: SleepPhases | None = None
    hrv_last_night_ms: int | None = None
    hrv_seven_day: list[tuple[date_type, int | None]] = field(default_factory=list)
    resting_heart_rate: int | None = None
    resting_heart_rate_delta: int | None = None
    battery_percent: int | None = None
    stress_level: int | None = None


@dataclass
class WeeklyLoad:
    week_start: date_type
    completed_load: float | None
    in_progress: bool


@dataclass
class LoadSnapshot:
    weeks: list[WeeklyLoad]
    acute_chronic_ratio: float | None
    vo2max: float | None


@dataclass
class ConflictOption:
    kind: str  # "reschedule" | "soften"
    label: str
    detail: str


@dataclass
class ConflictAssessment:
    has_conflict: bool
    signals: list[str]
    options: list[ConflictOption]


def _login(
    prompt_mfa: Callable[[], str] | None = None, sync: GarminSync | None = None
) -> GarminSync:
    """The caller's already-authenticated session, or a fresh login.

    Same optional-`sync` shape as `service.py`'s `_authenticated`, for the same reason:
    the web backend passes the process-wide session so a body screen doesn't pay a
    login per endpoint, while the CLI keeps logging in on its own.
    """
    if sync is not None:
        return sync
    fresh = GarminSync(prompt_mfa=prompt_mfa)
    fresh.login()
    return fresh


def _fetch_hrv_last_night(client, day: date_type) -> int | None:
    hrv = client.get_hrv_data(day.isoformat())
    summary = _get(hrv, "hrvSummary", default=hrv)
    return _get(summary, "lastNightAvg", "lastNight5MinHigh")


# The inputs Garmin's readiness score is built from, in the order its own card lists
# them, with the response fields each one lives in. Undocumented like everything else on
# these endpoints, so a renamed field costs one row of the breakdown and nothing more.
READINESS_FACTOR_FIELDS: tuple[tuple[str, str, str, str], ...] = (
    # key, Italian label, percent field, feedback field
    ("sonno", "Sonno di stanotte", "sleepScoreFactorPercent", "sleepScoreFactorFeedback"),
    ("storia_sonno", "Sonno delle ultime notti", "sleepHistoryFactorPercent", "sleepHistoryFactorFeedback"),
    ("recupero", "Recupero ancora da smaltire", "recoveryTimeFactorPercent", "recoveryTimeFactorFeedback"),
    ("hrv", "Variabilità cardiaca", "hrvFactorPercent", "hrvFactorFeedback"),
    ("carico", "Carico delle ultime settimane", "acwrFactorPercent", "acwrFactorFeedback"),
    ("stress", "Stress recente", "stressHistoryFactorPercent", "stressHistoryFactorFeedback"),
)

# Garmin's own word for how a single factor is doing. Same treatment as the composite
# feedback key: recognised values are translated, everything else degrades to no word
# rather than to an identifier on screen.
FACTOR_FEEDBACK_LABELS: dict[str, str] = {
    "GOOD": "buono",
    "MODERATE": "nella media",
    "MOD": "nella media",
    "FAIR": "così così",
    "POOR": "scarso",
    "LOW": "basso",
    "HIGH": "alto",
    "VERY_LOW": "molto basso",
    "VERY_HIGH": "molto alto",
    "NONE": "non disponibile",
    "EXCELLENT": "ottimo",
    "BALANCED": "in equilibrio",
    "UNBALANCED": "sbilanciato",
}


def _factor_verdict(raw) -> str | None:
    if not isinstance(raw, str) or not raw.strip():
        return None
    return FACTOR_FEEDBACK_LABELS.get(raw.strip().upper())


def _readiness_factors(readiness) -> list[ReadinessFactor]:
    """What Garmin says went into the score, dropping every factor it had nothing to say
    about -- a breakdown of six em dashes explains nothing."""
    factors: list[ReadinessFactor] = []
    for key, label, percent_field, feedback_field in READINESS_FACTOR_FIELDS:
        percent = _get(readiness, percent_field)
        verdict = _factor_verdict(_get(readiness, feedback_field))
        if percent is None and verdict is None:
            continue
        factors.append(
            ReadinessFactor(
                key=key,
                label=label,
                percent=round(percent) if isinstance(percent, (int, float)) else None,
                verdict=verdict,
            )
        )
    return factors


def fetch_body_snapshot(
    target_date: date_type | None = None,
    prompt_mfa: Callable[[], str] | None = None,
    sync: GarminSync | None = None,
) -> BodySnapshot:
    """The morning snapshot for `target_date` (default today): readiness, sleep, a
    7-day HRV trend, resting heart rate, battery, stress.

    The eleven Garmin calls this needs are issued concurrently: they are independent
    reads, and run serially they dominated this endpoint's latency (each one opens its
    own connection inside `garminconnect`). The pool is deliberately small -- Garmin
    rate-limits by IP, and `GarminSync`'s cooldown machinery exists because of it.
    """
    day = target_date or date_type.today()
    client = _login(prompt_mfa, sync).client
    day_str = day.isoformat()
    hrv_days = [day - timedelta(days=offset) for offset in range(6, -1, -1)]

    with ThreadPoolExecutor(max_workers=MAX_PARALLEL_GARMIN_CALLS) as pool:
        readiness_call = pool.submit(client.get_training_readiness, day_str)
        sleep_call = pool.submit(client.get_sleep_data, day_str)
        stress_call = pool.submit(client.get_stress_data, day_str)
        # `get_body_battery`'s "charged"/"drained" are cumulative deltas over the day,
        # not a current level, and `get_rhr_day`'s resting-heart-rate fields live nested
        # under `allMetrics.metricsMap` (not at the root, and without a 7-day average at
        # all) -- the daily user-summary endpoint has correct, flat fields for both.
        stats_call = pool.submit(client.get_stats, day_str)
        hrv_calls = [pool.submit(_fetch_hrv_last_night, client, d) for d in hrv_days]

        readiness = readiness_call.result()
        sleep = sleep_call.result()
        stress = stress_call.result()
        stats = stats_call.result()
        hrv_results = list(zip(hrv_days, hrv_calls))

    if isinstance(readiness, list):
        readiness = readiness[0] if readiness else None

    sleep_dto = _get(sleep, "dailySleepDTO", default=sleep)
    total_minutes = _seconds_to_minutes(_get(sleep_dto, "sleepTimeSeconds"))
    overall_score = _get(_get(sleep_dto, "sleepScores"), "overall")
    sleep_score = _get(overall_score, "value")
    sleep_phases = (
        SleepPhases(
            deep_minutes=_seconds_to_minutes(_get(sleep_dto, "deepSleepSeconds")),
            light_minutes=_seconds_to_minutes(_get(sleep_dto, "lightSleepSeconds")),
            rem_minutes=_seconds_to_minutes(_get(sleep_dto, "remSleepSeconds")),
            awake_minutes=_seconds_to_minutes(_get(sleep_dto, "awakeSleepSeconds")),
            total_minutes=total_minutes,
            score=round(sleep_score) if isinstance(sleep_score, (int, float)) else None,
            score_label=_factor_verdict(_get(overall_score, "qualifierKey")),
        )
        if total_minutes is not None
        else None
    )

    hrv_seven_day: list[tuple[date_type, int | None]] = []
    for series_day, call in hrv_results:
        try:
            hrv_seven_day.append((series_day, call.result()))
        except Exception:  # noqa: BLE001 - one missing day must not blank the whole trend
            logger.warning("HRV fetch failed for %s, degrading to unavailable", series_day, exc_info=True)
            hrv_seven_day.append((series_day, None))

    hrv_last_night_ms = hrv_seven_day[-1][1] if hrv_seven_day else None
    has_overnight_data = sleep_phases is not None or hrv_last_night_ms is not None

    resting_heart_rate = _get(stats, "restingHeartRate")
    resting_heart_rate_avg = _get(stats, "lastSevenDaysAvgRestingHeartRate")
    resting_heart_rate_delta = (
        resting_heart_rate - resting_heart_rate_avg
        if resting_heart_rate is not None and resting_heart_rate_avg is not None
        else None
    )

    return BodySnapshot(
        date=day,
        has_overnight_data=has_overnight_data,
        readiness_score=_get(readiness, "score"),
        # Garmin returns a lookup key here (`MOD_RT_LOW_SS_GOOD`), not a sentence. It
        # used to be printed verbatim under the day's score; `garmin_labels` decodes it,
        # and anything it cannot decode becomes no sentence at all rather than an
        # identifier on screen.
        readiness_message=readiness_feedback(_get(readiness, "feedbackLong", "feedbackShort")),
        readiness_level=readiness_level_label(_get(readiness, "level")),
        readiness_factors=_readiness_factors(readiness),
        sleep=sleep_phases,
        hrv_last_night_ms=hrv_last_night_ms,
        hrv_seven_day=hrv_seven_day,
        resting_heart_rate=resting_heart_rate,
        resting_heart_rate_delta=resting_heart_rate_delta,
        battery_percent=_get(stats, "bodyBatteryMostRecentValue"),
        stress_level=_get(stress, "avgStressLevel", "overallStressLevel"),
    )


def _primary_device_training_status(status) -> dict | None:
    """The per-device entry inside `get_training_status`'s `mostRecentTrainingStatus.
    latestTrainingStatusData` map (keyed by a numeric device ID we don't know ahead of
    time) for whichever device is flagged primary, falling back to the first one.
    """
    devices = _get(_get(status, "mostRecentTrainingStatus"), "latestTrainingStatusData")
    if not isinstance(devices, dict) or not devices:
        return None
    primary = next((d for d in devices.values() if isinstance(d, dict) and d.get("primaryTrainingDevice")), None)
    return primary or next(iter(devices.values()), None)


def fetch_load_snapshot(
    weeks: int = 5,
    prompt_mfa: Callable[[], str] | None = None,
    sync: GarminSync | None = None,
) -> LoadSnapshot:
    """Garmin-actual weekly training load for the last `weeks` weeks, plus acute:chronic
    ratio and VO2max. Does not know about the plan (see schemas.WeeklyLoadOut) -- the
    frontend merges this with its own client-computed "planned" series.

    `weeklyTrainingLoad` (the field this used to read) is consistently `null` on a
    live account regardless of date -- the populated figure `get_training_status`
    actually carries per device is `acuteTrainingLoadDTO.dailyTrainingLoadAcute`
    (queried per week-start date, same as the design intended), and
    `dailyAcuteChronicWorkloadRatio` for the ratio. VO2max is under
    `mostRecentVO2Max.generic` on the same response -- `get_max_metrics` (queried
    separately before) returns an empty list on this endpoint and isn't needed.
    """
    client = _login(prompt_mfa, sync).client
    today = date_type.today()
    current_week_start = today - timedelta(days=today.weekday())

    # One `get_training_status` per week plus today's, all independent -- issued
    # concurrently for the same reason as `fetch_body_snapshot`'s fan-out.
    week_starts = [current_week_start - timedelta(days=7 * i) for i in range(weeks - 1, -1, -1)]
    with ThreadPoolExecutor(max_workers=MAX_PARALLEL_GARMIN_CALLS) as pool:
        week_calls = [pool.submit(client.get_training_status, w.isoformat()) for w in week_starts]
        latest_call = pool.submit(client.get_training_status, today.isoformat())
        week_statuses = [call.result() for call in week_calls]
        latest_status = latest_call.result()

    week_records = []
    for offset, (week_start, status) in enumerate(zip(week_starts, week_statuses)):
        device_status = _primary_device_training_status(status)
        load = _get(_get(device_status, "acuteTrainingLoadDTO"), "dailyTrainingLoadAcute")
        week_records.append(
            WeeklyLoad(
                week_start=week_start,
                completed_load=load,
                in_progress=offset == len(week_starts) - 1,
            )
        )

    latest_device_status = _primary_device_training_status(latest_status)
    acute_chronic = _get(_get(latest_device_status, "acuteTrainingLoadDTO"), "dailyAcuteChronicWorkloadRatio")

    vo2max_container = _get(_get(latest_status, "mostRecentVO2Max"), "generic")
    vo2max = _get(vo2max_container, "vo2MaxPreciseValue", "vo2MaxValue")

    return LoadSnapshot(weeks=week_records, acute_chronic_ratio=acute_chronic, vo2max=vo2max)


def assess_conflict(
    snapshot: BodySnapshot, next_session: TrainingSession | None
) -> ConflictAssessment:
    """Compare today's snapshot against the next planned session (screen 13).

    Derived on every call, never stored -- both the body data and the plan can change
    independently of this assessment.
    """
    if next_session is None or not snapshot.has_overnight_data:
        return ConflictAssessment(has_conflict=False, signals=[], options=[])

    signals: list[str] = []
    if snapshot.readiness_score is not None and snapshot.readiness_score < READINESS_LOW_THRESHOLD:
        signals.append(f"prontezza {snapshot.readiness_score}")

    hrv_values = [v for _, v in snapshot.hrv_seven_day if v is not None]
    if len(hrv_values) >= 2:
        baseline = sum(hrv_values[:-1]) / len(hrv_values[:-1])
        delta = hrv_values[-1] - baseline
        if delta <= HRV_DELTA_ALERT_MS:
            signals.append(f"HRV {round(delta)} ms vs. media")

    is_demanding = any(step.type == "interval" for step in next_session.steps) or not next_session.steps

    if not signals or not is_demanding:
        return ConflictAssessment(has_conflict=False, signals=[], options=[])

    reps = next(
        (s for s in next_session.steps if s.type == "interval"), None
    )
    softer_detail = (
        f"{max(1, len(next_session.steps) - 2)} ripetute invece di {len(next_session.steps)}"
        if reps
        else "volume ridotto di circa un terzo"
    )

    options = [
        ConflictOption(
            kind="reschedule",
            label="Spostala a domani",
            detail="il fondo lento scala a oggi",
        ),
        ConflictOption(
            kind="soften",
            label="Tienila, ma più morbida",
            detail=softer_detail,
        ),
    ]
    return ConflictAssessment(has_conflict=True, signals=signals, options=options)
