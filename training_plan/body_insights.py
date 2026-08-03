"""Read-only Garmin wellness/body data: readiness, sleep, HRV, load, VO2max, and the
derived body/plan conflict (design screens 11-13).

Nothing here writes to Garmin. Every extraction from a `garminconnect` response is
defensive (`_get(...)` with a `None` fallback): these wellness endpoints are not
officially documented and their exact field names are current as of this writing,
not verified against a live account (the same kind of gap `models.py` already flags
for `CONDITION_TYPE_PAYLOAD`). A missing/renamed field degrades to "unavailable"
rather than raising, which also happens to be the correct behavior for the "no
overnight sync yet" empty state.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date as date_type
from datetime import timedelta

from .garmin_sync import GarminSync
from .models import TrainingSession

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


@dataclass
class BodySnapshot:
    date: date_type
    has_overnight_data: bool
    readiness_score: int | None = None
    readiness_message: str | None = None
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


def _login(prompt_mfa: Callable[[], str] | None = None) -> GarminSync:
    sync = GarminSync(prompt_mfa=prompt_mfa)
    sync.login()
    return sync


def _fetch_hrv_last_night(client, day: date_type) -> int | None:
    hrv = client.get_hrv_data(day.isoformat())
    summary = _get(hrv, "hrvSummary", default=hrv)
    return _get(summary, "lastNightAvg", "lastNight5MinHigh")


def fetch_body_snapshot(
    target_date: date_type | None = None, prompt_mfa: Callable[[], str] | None = None
) -> BodySnapshot:
    """The morning snapshot for `target_date` (default today): readiness, sleep, a
    7-day HRV trend, resting heart rate, battery, stress.
    """
    day = target_date or date_type.today()
    sync = _login(prompt_mfa)
    client = sync.client
    day_str = day.isoformat()

    readiness = client.get_training_readiness(day_str)
    if isinstance(readiness, list):
        readiness = readiness[0] if readiness else None
    sleep = client.get_sleep_data(day_str)
    rhr = client.get_rhr_day(day_str)
    stress = client.get_stress_data(day_str)
    battery_series = client.get_body_battery(day_str)
    battery = battery_series[0] if battery_series else None

    sleep_dto = _get(sleep, "dailySleepDTO", default=sleep)
    total_minutes = _seconds_to_minutes(_get(sleep_dto, "sleepTimeSeconds"))
    sleep_phases = (
        SleepPhases(
            deep_minutes=_seconds_to_minutes(_get(sleep_dto, "deepSleepSeconds")),
            light_minutes=_seconds_to_minutes(_get(sleep_dto, "lightSleepSeconds")),
            rem_minutes=_seconds_to_minutes(_get(sleep_dto, "remSleepSeconds")),
            awake_minutes=_seconds_to_minutes(_get(sleep_dto, "awakeSleepSeconds")),
            total_minutes=total_minutes,
        )
        if total_minutes is not None
        else None
    )

    hrv_seven_day: list[tuple[date_type, int | None]] = []
    for offset in range(6, -1, -1):
        series_day = day - timedelta(days=offset)
        try:
            hrv_seven_day.append((series_day, _fetch_hrv_last_night(client, series_day)))
        except Exception:  # noqa: BLE001 - one missing day must not blank the whole trend
            hrv_seven_day.append((series_day, None))

    hrv_last_night_ms = hrv_seven_day[-1][1] if hrv_seven_day else None
    has_overnight_data = sleep_phases is not None or hrv_last_night_ms is not None

    return BodySnapshot(
        date=day,
        has_overnight_data=has_overnight_data,
        readiness_score=_get(readiness, "score"),
        readiness_message=_get(readiness, "feedbackLong", "feedbackShort"),
        sleep=sleep_phases,
        hrv_last_night_ms=hrv_last_night_ms,
        hrv_seven_day=hrv_seven_day,
        resting_heart_rate=_get(rhr, "restingHeartRate"),
        resting_heart_rate_delta=_get(rhr, "lastSevenDaysAvgRestingHeartRate")
        and _get(rhr, "restingHeartRate")
        and _get(rhr, "restingHeartRate") - _get(rhr, "lastSevenDaysAvgRestingHeartRate"),
        battery_percent=_get(battery, "charged", "bodyBatteryValue"),
        stress_level=_get(stress, "avgStressLevel", "overallStressLevel"),
    )


def fetch_load_snapshot(
    weeks: int = 5, prompt_mfa: Callable[[], str] | None = None
) -> LoadSnapshot:
    """Garmin-actual weekly training load for the last `weeks` weeks, plus acute:chronic
    ratio and VO2max. Does not know about the plan (see schemas.WeeklyLoadOut) -- the
    frontend merges this with its own client-computed "planned" series.
    """
    sync = _login(prompt_mfa)
    client = sync.client
    today = date_type.today()
    current_week_start = today - timedelta(days=today.weekday())

    week_records = []
    for i in range(weeks - 1, -1, -1):
        week_start = current_week_start - timedelta(days=7 * i)
        status = client.get_training_status(week_start.isoformat())
        load = _get(status, "weeklyTrainingLoad", "acuteLoad")
        week_records.append(
            WeeklyLoad(week_start=week_start, completed_load=load, in_progress=i == 0)
        )

    latest_status = client.get_training_status(today.isoformat())
    acute_chronic = _get(latest_status, "acuteChronicRatio", "loadRatio")

    max_metrics = client.get_max_metrics(today.isoformat())
    if isinstance(max_metrics, list):
        max_metrics = max_metrics[0] if max_metrics else None
    vo2max_container = _get(max_metrics, "generic", default=max_metrics)
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
