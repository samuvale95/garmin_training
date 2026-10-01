"""Acute:Chronic Workload Ratio (ACWR) limits and rolling workload analysis.

Following Gabbett et al. and consensus in sports science:
- Safe / Sweet Spot: 0.80 - 1.30 (progressive overload with low injury risk)
- High / Warning: > 1.35 (overreaching, acute overload warning)
- Excessive / Danger: >= 1.50 (injury risk spike, critical warning)

Workload is measured in running minutes (or training load):
- Acute workload: rolling 7-day workload.
- Chronic workload: 28-day workload divided by 4 (weekly equivalent average).
- ACWR = acute_workload / chronic_workload.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date as date_type
from datetime import timedelta
from typing import Any, Sequence

ACWR_SAFE_MIN = 0.80
ACWR_SAFE_MAX = 1.30
ACWR_HIGH = 1.35
ACWR_EXCESSIVE = 1.50

MIN_CHRONIC_MINUTES = 10.0
ACUTE_DAYS = 7
CHRONIC_DAYS = 28

STATUS_SAFE = "safe"
STATUS_HIGH = "acwr_high"
STATUS_EXCESSIVE = "acwr_excessive"
STATUS_UNDERLOAD = "underload"
STATUS_UNKNOWN = "unknown"


@dataclass
class AcwrAssessment:
    acwr: float | None
    status: str
    acute_minutes: float
    chronic_minutes: float
    peak_date: date_type | None = None
    involved_sessions: list[Any] = None

    def __post_init__(self):
        if self.involved_sessions is None:
            self.involved_sessions = []


def calculate_acwr(acute_minutes: float, chronic_weekly_minutes: float | None) -> float | None:
    """Calculate the Acute to Chronic Workload Ratio.

    Returns None if chronic baseline is unknown or insufficient (< 10 minutes/week).
    """
    if chronic_weekly_minutes is None or chronic_weekly_minutes < MIN_CHRONIC_MINUTES:
        return None
    return round(acute_minutes / chronic_weekly_minutes, 2)


def assess_acwr(acwr: float | None) -> str:
    """Assess status category for an ACWR value."""
    if acwr is None:
        return STATUS_UNKNOWN
    if acwr >= ACWR_EXCESSIVE:
        return STATUS_EXCESSIVE
    if acwr >= ACWR_HIGH:
        return STATUS_HIGH
    if acwr < ACWR_SAFE_MIN:
        return STATUS_UNDERLOAD
    return STATUS_SAFE


def calculate_rolling_acwr(
    daily_minutes: dict[date_type, float],
    target_date: date_type,
) -> tuple[float | None, float, float]:
    """Calculate (acwr, acute_minutes, chronic_weekly_minutes) for target_date.

    - Acute: sum over [target_date - 6 days, target_date] (7 days).
    - Chronic: sum over [target_date - 27 days, target_date] / 4.0 (28 days).
    """
    acute_start = target_date - timedelta(days=ACUTE_DAYS - 1)
    acute_minutes = sum(
        daily_minutes.get(acute_start + timedelta(days=i), 0.0)
        for i in range(ACUTE_DAYS)
    )

    chronic_start = target_date - timedelta(days=CHRONIC_DAYS - 1)
    total_chronic_28d = sum(
        daily_minutes.get(chronic_start + timedelta(days=i), 0.0)
        for i in range(CHRONIC_DAYS)
    )
    chronic_weekly = total_chronic_28d / (CHRONIC_DAYS / ACUTE_DAYS)

    acwr = calculate_acwr(acute_minutes, chronic_weekly)
    return acwr, round(acute_minutes, 1), round(chronic_weekly, 1)


def find_peak_acwr(
    planned_items: Sequence[Any],
    chronic_weekly_minutes: float | None,
) -> AcwrAssessment:
    """Evaluate rolling 7-day acute workload across planned items relative to chronic baseline.

    Finds the maximum ACWR reached across all 7-day windows in the planned sequence.
    """
    if not planned_items or chronic_weekly_minutes is None or chronic_weekly_minutes < MIN_CHRONIC_MINUTES:
        return AcwrAssessment(
            acwr=None,
            status=STATUS_UNKNOWN,
            acute_minutes=0.0,
            chronic_minutes=chronic_weekly_minutes or 0.0,
        )

    # Group running minutes by date
    daily_minutes: dict[date_type, float] = {}
    for item in planned_items:
        d = item.session.date
        daily_minutes[d] = daily_minutes.get(d, 0.0) + (item.minutes if item.minutes > 0 else 0.0)

    dates = sorted(daily_minutes.keys())
    if not dates:
        return AcwrAssessment(
            acwr=None,
            status=STATUS_UNKNOWN,
            acute_minutes=0.0,
            chronic_minutes=chronic_weekly_minutes,
        )

    max_acwr: float | None = None
    max_acute: float = 0.0
    peak_date: date_type | None = None
    peak_items: list[Any] = []

    # Check rolling 7-day window ending at each planned date
    for d in dates:
        window_start = d - timedelta(days=ACUTE_DAYS - 1)
        acute = sum(daily_minutes.get(window_start + timedelta(days=i), 0.0) for i in range(ACUTE_DAYS))
        ratio = calculate_acwr(acute, chronic_weekly_minutes)
        if ratio is not None:
            if max_acwr is None or ratio > max_acwr:
                max_acwr = ratio
                max_acute = acute
                peak_date = d
                peak_items = [
                    item for item in planned_items
                    if window_start <= item.session.date <= d and item.minutes > 0
                ]

    status = assess_acwr(max_acwr)
    return AcwrAssessment(
        acwr=max_acwr,
        status=status,
        acute_minutes=round(max_acute, 1),
        chronic_minutes=round(chronic_weekly_minutes, 1),
        peak_date=peak_date,
        involved_sessions=peak_items,
    )
