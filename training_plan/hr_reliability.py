"""How far one activity's heart-rate stream can be trusted.

`hr_cleaning` repairs a stream sample by sample: spikes, short dropouts, seconds where
the reading sits on the cadence. What it cannot see is the failure that matters most on
a long run: the optical sensor drifting onto the step rhythm over a few minutes and
staying there. Sample by sample nothing looks wrong -- the heart rate just climbs 20 bpm
and never comes back -- and every zone, load and verdict built on it is wrong.

The signature used here is physiological, not statistical: at an unchanged pace on flat
ground the heart does not gain a dozen beats in five minutes. Cardiac drift is a few
beats an hour. So a sustained step at a stable pace is called a sensor step, and one
that lands on the cadence is called a cadence lock.

Everything is measured on the time axis, not on sample counts: Strava's streams are
resampled (a sample every 15-20 s on a marathon) and Garmin's are not, and a window of
"90 samples" is a minute and a half on one and half an hour on the other.
"""

from __future__ import annotations

from bisect import bisect_left
from collections.abc import Sequence
from dataclasses import dataclass, field
from itertools import pairwise
from statistics import median
from typing import Literal

Verdict = Literal["affidabile", "dubbia", "inaffidabile"]

BIN_S = 10
# Sensor steps are looked for only after the warm-up, where a fast real rise is normal.
WARMUP_S = 10 * 60
# How fast a step may build and still be one: the marathon that motivated this rose
# about 20 bpm over four to five minutes.
RAMP_S = 5 * 60
WINDOW_S = 3 * 60
# Heart rate takes a few minutes to catch up with a change of pace, so the pace must
# also have been steady this long before the step's baseline.
LAG_S = 3 * 60
# The rise has to hold this long after the step, or it was a hill or a surge.
SUSTAIN_S = 6 * 60
STEP_MIN_BPM = 12.0
SUSTAIN_MIN_BPM = 10.0
# Pace counts as unchanged within this share either side.
STABLE_SPEED_SHARE = 0.05
# A climb of more than this average grade over the ramp explains a rise on its own.
MAX_RAMP_GRADE_PCT = 2.0
LOCK_TOLERANCE_BPM = 5.0
# Below this the cadence is not running, and a reading near it is a coincidence.
MIN_RUNNING_CADENCE_SPM = 140.0
DROPOUT_GAP_S = 10.0
DROPOUT_DUBIOUS_SHARE = 0.10
LOCKED_UNRELIABLE_SHARE = 0.20


@dataclass(frozen=True)
class SensorStep:
    time_s: int
    distance_km: float | None
    hr_before: int
    hr_after: int
    cadence_after: int | None
    pace_change_pct: float
    locked_to_cadence: bool


@dataclass(frozen=True)
class HrReliability:
    verdict: Verdict
    # The first second from which the stream should not be read as heart rate; None
    # when nothing points to a sensor failure.
    unreliable_from_s: int | None
    steps: list[SensorStep] = field(default_factory=list)
    # Share of running time spent within a few beats of the cadence.
    locked_share: float = 0.0
    dropout_share: float = 0.0
    reasons: list[str] = field(default_factory=list)

    @property
    def key_step(self) -> SensorStep | None:
        """The step that decides the verdict: the first cadence lock, else the first step.

        Not simply the first step: on a real marathon an earlier, smaller step came from
        the baseline dipping (a short dropout to 128 bpm) and would have put the start of
        the unreliable stretch at km 3 instead of km 8, where the lock is.
        """
        return next((s for s in self.steps if s.locked_to_cadence), self.steps[0] if self.steps else None)


@dataclass
class _Bin:
    t: float
    hr: float | None
    cadence: float | None
    speed: float | None
    distance: float | None
    altitude: float | None


def _spm(cadence: float | None) -> float | None:
    """Steps per minute, whichever convention the source used (Strava counts one leg)."""
    if cadence is None or cadence <= 0:
        return None
    return cadence * 2 if cadence < 110 else cadence


def _bins(streams: dict[str, Sequence[float | None]]) -> list[_Bin]:
    times = streams.get("time") or []
    n = len(times)

    def channel(name: str) -> Sequence[float | None]:
        values = streams.get(name)
        return values if values is not None and len(values) == n else [None] * n

    hrs, cads, spds = channel("heartrate"), channel("cadence"), channel("velocity_smooth")
    dists, alts = channel("distance"), channel("altitude")

    grouped: dict[int, list[int]] = {}
    for i, t in enumerate(times):
        if t is not None:
            grouped.setdefault(int(t // BIN_S), []).append(i)

    def med(values: list[float | None]) -> float | None:
        present = [v for v in values if v is not None]
        return median(present) if present else None

    out: list[_Bin] = []
    for key in sorted(grouped):
        idx = grouped[key]
        hr = med([hrs[i] if hrs[i] is not None and 30 < hrs[i] < 230 else None for i in idx])
        out.append(
            _Bin(
                t=key * BIN_S,
                hr=hr,
                cadence=med([_spm(cads[i]) for i in idx]),
                speed=med([spds[i] if spds[i] is not None and spds[i] > 0.5 else None for i in idx]),
                distance=med([dists[i] for i in idx]),
                altitude=med([alts[i] for i in idx]),
            )
        )
    return out


def _mean(bins: list[_Bin], attr: str) -> float | None:
    values = [getattr(b, attr) for b in bins if getattr(b, attr) is not None]
    return sum(values) / len(values) if len(values) >= max(3, len(bins) // 2) else None


def _between(bins: list[_Bin], start: float, end: float) -> list[_Bin]:
    """The bins in [start, end); `bins` is sorted by time, so two bisections."""
    return bins[bisect_left(bins, start, key=_bin_t) : bisect_left(bins, end, key=_bin_t)]


def _bin_t(b: _Bin) -> float:
    return b.t


def _dropout_share(streams: dict[str, Sequence[float | None]]) -> float:
    times = streams.get("time") or []
    hrs = streams.get("heartrate") or []
    if len(times) < 2 or len(hrs) != len(times):
        return 0.0
    total = (times[-1] or 0) - (times[0] or 0)
    if total <= 0:
        return 0.0
    # A resampled stream (Strava: a sample every 15-20 s) is not a dropout every sample,
    # so a gap only counts when it is well beyond the stream's own spacing.
    deltas = [b - a for a, b in pairwise(times) if a is not None and b is not None and b > a]
    threshold = max(DROPOUT_GAP_S, 3 * median(deltas)) if deltas else DROPOUT_GAP_S
    missing = 0.0
    last_seen = times[0]
    for t, hr in zip(times, hrs):
        if t is None:
            continue
        if hr is not None and hr > 30:
            if t - last_seen > threshold:
                missing += t - last_seen
            last_seen = t
    if times[-1] is not None and times[-1] - last_seen > threshold:
        missing += times[-1] - last_seen
    return min(1.0, missing / total)


def assess(streams: dict[str, Sequence[float | None]] | None) -> HrReliability | None:
    """The reliability of one activity's heart rate; None when it has none to judge."""
    if not streams or not streams.get("time") or not streams.get("heartrate"):
        return None
    bins = _bins(streams)
    if not any(b.hr is not None for b in bins):
        return None

    steps: list[SensorStep] = []
    end_t = bins[-1].t
    t = bins[0].t + WARMUP_S + RAMP_S + WINDOW_S + LAG_S
    while t + SUSTAIN_S <= end_t:
        before = _between(bins, t - RAMP_S - WINDOW_S, t - RAMP_S)
        after = _between(bins, t, t + WINDOW_S)
        sustain = _between(bins, t, t + SUSTAIN_S)
        hr_b, hr_a, hr_s = _mean(before, "hr"), _mean(after, "hr"), _mean(sustain, "hr")
        sp_b, sp_a, sp_s = _mean(before, "speed"), _mean(after, "speed"), _mean(sustain, "speed")
        if None in (hr_b, hr_a, hr_s, sp_b, sp_a, sp_s):
            t += BIN_S
            continue
        # The largest change across before, ramp, after and the sustained stretch: a surge
        # anywhere in there is a reason for the heart rate to rise.
        # Minute by minute from the lag before the baseline on, so neither a surge inside
        # the baseline nor one the heart rate is still catching up with hides in a mean.
        lead = t - RAMP_S - WINDOW_S - LAG_S
        pieces = [_between(bins, lead + k * 60, lead + (k + 1) * 60) for k in range((LAG_S + WINDOW_S) // 60)]
        pieces.append(_between(bins, t - RAMP_S, t))
        speeds = [sp for sp in (_mean(p, "speed") for p in pieces) if sp is not None] + [sp_a, sp_s]
        pace_change = max(((sp - sp_b) / sp_b for sp in speeds), key=abs)
        if (
            hr_a - hr_b >= STEP_MIN_BPM
            and hr_s - hr_b >= SUSTAIN_MIN_BPM
            and abs(pace_change) <= STABLE_SPEED_SHARE
            and not _climbing(bins, t - RAMP_S - WINDOW_S, t + WINDOW_S)
        ):
            # Walk forward to where the rise is largest, so the step is reported at its
            # top rather than at the first bin that crossed the threshold.
            best_t, best_rise = t, hr_a - hr_b
            probe = t + BIN_S
            while probe <= t + RAMP_S and probe + SUSTAIN_S <= end_t:
                rise = (_mean(_between(bins, probe, probe + WINDOW_S), "hr") or 0) - hr_b
                if rise > best_rise:
                    best_t, best_rise = probe, rise
                probe += BIN_S
            top = _between(bins, best_t, best_t + WINDOW_S)
            hr_top = _mean(top, "hr") or hr_a
            cad_top = _mean(top, "cadence")
            # The step starts at the first bin that has left the baseline by a quarter of
            # the rise, not at the edge of the search window.
            rising = [
                b for b in _between(bins, t - RAMP_S, best_t + WINDOW_S)
                if b.hr is not None and b.hr >= hr_b + 0.25 * (hr_top - hr_b)
            ]
            onset_bin = rising[0] if rising else _between(bins, t - RAMP_S, t + BIN_S)[0]
            onset_dist = next(
                (b.distance for b in _between(bins, onset_bin.t, onset_bin.t + 60) if b.distance is not None), None
            )
            dist = onset_dist
            steps.append(
                SensorStep(
                    time_s=int(onset_bin.t - bins[0].t),
                    distance_km=round(dist / 1000, 2) if dist is not None else None,
                    hr_before=round(hr_b),
                    hr_after=round(hr_top),
                    cadence_after=round(cad_top) if cad_top is not None else None,
                    pace_change_pct=round(pace_change * 100, 1),
                    locked_to_cadence=(
                        cad_top is not None
                        and cad_top >= MIN_RUNNING_CADENCE_SPM
                        and abs(hr_top - cad_top) <= LOCK_TOLERANCE_BPM
                    ),
                )
            )
            t = best_t + SUSTAIN_S
            continue
        t += BIN_S

    running = [b for b in bins if b.hr is not None and b.cadence is not None and b.cadence >= MIN_RUNNING_CADENCE_SPM]
    locked = [b for b in running if abs(b.hr - b.cadence) <= LOCK_TOLERANCE_BPM]
    locked_share = len(locked) / len(running) if running else 0.0
    dropout_share = _dropout_share(streams)

    reasons: list[str] = []
    verdict: Verdict = "affidabile"
    if any(s.locked_to_cadence for s in steps):
        verdict = "inaffidabile"
        first = next(s for s in steps if s.locked_to_cadence)
        reasons.append(
            f"Battito salito da {first.hr_before} a {first.hr_after} bpm a passo invariato, "
            f"agganciato alla cadenza ({first.cadence_after} passi/min)."
        )
    elif steps:
        verdict = "dubbia"
        first = steps[0]
        reasons.append(
            f"Battito salito da {first.hr_before} a {first.hr_after} bpm in pochi minuti a passo invariato."
        )
    if locked_share >= LOCKED_UNRELIABLE_SHARE and steps:
        verdict = "inaffidabile"
    if locked_share >= LOCKED_UNRELIABLE_SHARE:
        reasons.append(f"Battito uguale alla cadenza per il {round(locked_share * 100)}% del tempo di corsa.")
    if dropout_share >= DROPOUT_DUBIOUS_SHARE:
        if verdict == "affidabile":
            verdict = "dubbia"
        reasons.append(f"Segnale assente per il {round(dropout_share * 100)}% del tempo.")

    key = next((s for s in steps if s.locked_to_cadence), steps[0] if steps else None)
    return HrReliability(
        verdict=verdict,
        unreliable_from_s=key.time_s if key else None,
        steps=steps,
        locked_share=round(locked_share, 3),
        dropout_share=round(dropout_share, 3),
        reasons=reasons,
    )


def _climbing(bins: list[_Bin], start: float, end: float) -> bool:
    span = [b for b in _between(bins, start, end) if b.altitude is not None and b.distance is not None]
    if len(span) < 2:
        return False
    run = span[-1].distance - span[0].distance
    if run < 100:
        return False
    return (span[-1].altitude - span[0].altitude) / run * 100 > MAX_RAMP_GRADE_PCT
