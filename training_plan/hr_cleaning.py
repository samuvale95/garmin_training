"""Heart rate stream anomaly detection and physiological cleaning.

Protects time-in-zone compliance, aerocapacitive regression (pace-at-HR), and
training load calculations from synthetic artifacts:
1. Electrostatic shirt spikes (isolated jumps > 5 bpm/s or > 215 bpm).
2. Optical wrist cadence lock (HR abruptly jumping to match cadence +/- 3 spm at constant speed).
3. Sensor dropouts (temporary gaps <= 10s interpolated, longer gaps masked).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Sequence

QualityRating = Literal["alta", "media", "bassa"]

MAX_PHYSIOLOGICAL_HR = 215.0
MIN_PHYSIOLOGICAL_HR = 35.0
MAX_HR_ACCELERATION_BPM_PER_SEC = 5.0
SHORT_SPIKE_MAX_SECONDS = 10
CADENCE_LOCK_TOLERANCE_SPM = 3.0
CADENCE_LOCK_MIN_DURATION_SEC = 20


@dataclass(frozen=True)
class StreamQualityResult:
    cleaned_heart_rates: list[float | None]
    raw_heart_rates: list[float | None]
    valid_ratio: float
    quality: QualityRating
    spikes_detected: int
    cadence_lock_seconds: int


def clean_heart_rate_stream(
    heart_rates: Sequence[float | None],
    times: Sequence[float] | None = None,
    cadences: Sequence[float | None] | None = None,
    speeds: Sequence[float | None] | None = None,
    max_hr: float | None = None,
) -> StreamQualityResult:
    """Clean a heart rate stream by filtering spikes, dropouts, and cadence lock.

    Returns the cleaned time series and data quality metrics.
    """
    n = len(heart_rates)
    if n == 0:
        return StreamQualityResult(
            cleaned_heart_rates=[],
            raw_heart_rates=[],
            valid_ratio=1.0,
            quality="alta",
            spikes_detected=0,
            cadence_lock_seconds=0,
        )

    # Time delta between consecutive points (default to 1.0 second if times not provided)
    if times is not None and len(times) == n:
        dt = [
            max(0.1, times[i] - times[i - 1]) if i > 0 else 1.0
            for i in range(n)
        ]
    else:
        dt = [1.0] * n

    effective_max_hr = max_hr + 5.0 if max_hr and max_hr > 120 else MAX_PHYSIOLOGICAL_HR

    raw = list(heart_rates)
    cleaned = list(heart_rates)
    is_anomaly = [False] * n

    # Step 1: Detect absolute out-of-bounds
    for i, hr in enumerate(raw):
        if hr is None:
            continue
        if hr < MIN_PHYSIOLOGICAL_HR or hr > effective_max_hr:
            is_anomaly[i] = True

    # Step 2: Detect physiological rate-of-change spikes (|dHR/dt| > 5 bpm/s)
    # An isolated jump that returns to baseline within SHORT_SPIKE_MAX_SECONDS without
    # an accompanied surge in running speed.
    i = 0
    spikes_count = 0
    while i < n:
        if raw[i] is None or is_anomaly[i]:
            i += 1
            continue

        # Look for sharp step up
        if i > 0 and raw[i - 1] is not None and not is_anomaly[i - 1]:
            delta = raw[i] - raw[i - 1]
            rate = delta / dt[i]
            if rate > MAX_HR_ACCELERATION_BPM_PER_SEC:
                # Check if this is an isolated spike returning near baseline
                spike_start = i
                spike_duration = 0.0
                j = i
                while j < n and spike_duration < SHORT_SPIKE_MAX_SECONDS:
                    spike_duration += dt[j]
                    j += 1

                # Check if speed increased significantly (>30%) at the same time
                is_speed_surge = False
                if speeds is not None and len(speeds) == n and i > 0:
                    v_prev = speeds[i - 1] or 0.0
                    v_curr = speeds[i] or 0.0
                    if v_prev > 1.0 and v_curr > v_prev * 1.30:
                        is_speed_surge = True

                if not is_speed_surge:
                    # Look for return to baseline (within 10 bpm of raw[i-1]) within SHORT_SPIKE_MAX_SECONDS
                    returns_to_baseline = False
                    end_idx = i
                    for k in range(i + 1, min(n, i + 15)):
                        if raw[k] is not None and abs(raw[k] - raw[i - 1]) <= 12.0:
                            returns_to_baseline = True
                            end_idx = k
                            break

                    if returns_to_baseline or (j < n and is_anomaly[i]):
                        spikes_count += 1
                        for k in range(spike_start, end_idx):
                            is_anomaly[k] = True
                        i = end_idx
                        continue
        i += 1

    # Step 3: Detect Cadence Lock
    # Optical sensors locking onto running cadence (typically 155-190 spm)
    cadence_lock_sec = 0
    if cadences is not None and len(cadences) == n:
        i = 0
        while i < n:
            hr = raw[i]
            cad = cadences[i]
            # Cadence is often reported as steps/min (e.g. 170) or double steps (85)
            effective_cad = cad * 2 if cad is not None and cad < 110 else cad

            if (
                hr is not None
                and effective_cad is not None
                and not is_anomaly[i]
                and abs(hr - effective_cad) <= CADENCE_LOCK_TOLERANCE_SPM
            ):
                # Count duration of lock
                lock_start = i
                lock_duration = 0.0
                j = i
                while j < n:
                    h = raw[j]
                    c = cadences[j]
                    ec = c * 2 if c is not None and c < 110 else c
                    if h is not None and ec is not None and abs(h - ec) <= CADENCE_LOCK_TOLERANCE_SPM:
                        lock_duration += dt[j]
                        j += 1
                    else:
                        break

                if lock_duration >= CADENCE_LOCK_MIN_DURATION_SEC:
                    # Check if speed was relatively steady (avoid flagging sprint where cadence and HR coincidentally match)
                    speed_steady = True
                    if speeds is not None and len(speeds) == n and lock_start > 0:
                        prev_spd = speeds[lock_start - 1] or 0.0
                        curr_spd = speeds[lock_start] or 0.0
                        if prev_spd > 1.5 and abs(curr_spd - prev_spd) / prev_spd > 0.25:
                            speed_steady = False

                    if speed_steady:
                        cadence_lock_sec += int(round(lock_duration))
                        for k in range(lock_start, j):
                            is_anomaly[k] = True
                        i = j
                        continue
            i += 1

    # Step 4: Repair anomalies with linear interpolation over short gaps (<= 10s)
    for i in range(n):
        if is_anomaly[i]:
            cleaned[i] = None

    # Linear interpolation over gaps <= 10s
    i = 0
    while i < n:
        if cleaned[i] is None:
            gap_start = i
            gap_duration = 0.0
            while i < n and cleaned[i] is None:
                gap_duration += dt[i]
                i += 1
            gap_end = i

            # Interpolate if bounded by valid values on both sides and duration <= 10s
            left_val = cleaned[gap_start - 1] if gap_start > 0 else None
            right_val = cleaned[gap_end] if gap_end < n else None

            if left_val is not None and right_val is not None and gap_duration <= SHORT_SPIKE_MAX_SECONDS:
                total_steps = gap_end - gap_start + 1
                for step_idx, k in enumerate(range(gap_start, gap_end)):
                    alpha = (step_idx + 1) / total_steps
                    cleaned[k] = round(left_val + alpha * (right_val - left_val), 1)
        else:
            i += 1

    # Compute quality rating
    valid_count = sum(1 for x in cleaned if x is not None)
    valid_ratio = valid_count / n if n > 0 else 1.0

    if valid_ratio >= 0.95 and cadence_lock_sec < 60:
        quality: QualityRating = "alta"
    elif valid_ratio >= 0.80 and cadence_lock_sec < 300:
        quality = "media"
    else:
        quality = "bassa"

    return StreamQualityResult(
        cleaned_heart_rates=cleaned,
        raw_heart_rates=raw,
        valid_ratio=round(valid_ratio, 3),
        quality=quality,
        spikes_detected=spikes_count,
        cadence_lock_seconds=cadence_lock_sec,
    )
