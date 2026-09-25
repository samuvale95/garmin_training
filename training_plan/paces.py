"""The paces this athlete actually runs at each heart rate, from their own history.

A prescribed session has to name a pace. The plan format carries pace targets and
nothing else (`models.Step.target_pace`), the watch wants a speed range, and "corri
facile" is not a workout.

The obvious source is Garmin's threshold *speed*, and it is not usable: the value comes
back on a scale the API does not document and which does not read as metres per second
(see `garmin_sync.lactate_threshold`). Publishing a pace derived from a unit that is a
guess is exactly what the rest of this codebase refuses to do.

So the paces are measured instead of looked up. Two years of streams pair a heart rate
with a speed every second or so; the pace at a given heart rate is the median speed of
the samples recorded near it. It needs no unit conversion anyone has to trust, it is
this athlete's own data rather than a population formula, and it improves on its own as
the history grows.

Two things it is careful about:

- **Heart rate lags effort.** A sample at 155 bpm was produced by the effort of thirty
  to sixty seconds earlier, so the pairing is noisy at the individual sample. Across
  hundreds of thousands of samples the lag averages out; across a handful it does not,
  which is why `MIN_SAMPLES` exists and why a thin band returns nothing at all.
- **Standing still is not a pace.** Traffic lights, drink stops and the pause at the top
  of a climb all record a heart rate with no speed under it, and they would drag every
  median toward zero.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Sequence

logger = logging.getLogger(__name__)

# How far from the target heart rate a sample may sit and still count, in bpm. Wide
# enough to collect a usable sample count out of a handful of sessions, narrow enough
# that the band is still describing one effort level.
HR_TOLERANCE_BPM = 3

# Below this, the athlete is walking or stopped, and neither belongs in a running pace.
MIN_RUNNING_SPEED_MPS = 1.8

# Under this many samples in the band the median is noise. At roughly one sample per
# second this is about ten minutes of running spent near that heart rate, accumulated
# across the whole history.
MIN_SAMPLES = 600


@dataclass
class PaceEstimate:
    """A pace, and enough about its provenance to decide whether to trust it."""

    heart_rate: int
    sec_per_km: int
    samples: int
    # The middle half of the distribution, which is what makes a *range* rather than a
    # single number -- and a range is what a workout step actually wants.
    faster_sec_per_km: int
    slower_sec_per_km: int

    def as_range(self) -> tuple[int, int]:
        return self.slower_sec_per_km, self.faster_sec_per_km


def _quantile(ordered: list[float], q: float) -> float:
    """Nearest-rank quantile of an already sorted list. `statistics.quantiles` needs at
    least two points and interpolates; this is simpler and enough for a band summary."""
    if not ordered:
        return 0.0
    index = max(0, min(len(ordered) - 1, int(round(q * (len(ordered) - 1)))))
    return ordered[index]


def _median(ordered: list[float]) -> float:
    """Median of an already sorted, non-empty list -- the same value `statistics.median`
    returns, without sorting it a second time."""
    mid = len(ordered) // 2
    return ordered[mid] if len(ordered) % 2 else (ordered[mid - 1] + ordered[mid]) / 2


def pace_at_heart_rate(
    samples: Sequence[tuple[float | None, float | None]],
    target_hr: int,
    *,
    tolerance: int = HR_TOLERANCE_BPM,
    min_samples: int = MIN_SAMPLES,
) -> PaceEstimate | None:
    """The pace this athlete holds at `target_hr`, or `None` when too little was recorded
    there to say.

    `samples` is `(heart_rate, speed_mps)` pairs from however many activities the caller
    wants folded together -- the estimate gets better the more history goes in, which is
    the whole argument for having stored it.
    """
    speeds = [
        speed
        for heart_rate, speed in samples
        if heart_rate is not None
        and speed is not None
        and speed >= MIN_RUNNING_SPEED_MPS
        and abs(heart_rate - target_hr) <= tolerance
    ]
    if len(speeds) < min_samples:
        return None
    # Sorted once: the median and both quartiles read off the same list, and on a year of
    # history that list is tens of thousands of samples long.
    speeds.sort()

    # Quartiles, not the extremes: the fastest sample near a heart rate is a downhill and
    # the slowest is the first stride after a corner, and a workout written between those
    # two would have a range nobody could run inside.
    return PaceEstimate(
        heart_rate=target_hr,
        sec_per_km=round(1000 / _median(speeds)),
        samples=len(speeds),
        faster_sec_per_km=round(1000 / _quantile(speeds, 0.75)),
        slower_sec_per_km=round(1000 / _quantile(speeds, 0.25)),
    )


@dataclass
class PaceProfile:
    """The two paces every prescription in this app is written against."""

    easy: PaceEstimate | None
    threshold: PaceEstimate | None

    @property
    def usable(self) -> bool:
        return self.easy is not None or self.threshold is not None


def build_profile(
    samples: Sequence[tuple[float | None, float | None]], *, aerobic_hr: int, threshold_hr: int
) -> PaceProfile:
    return PaceProfile(
        easy=pace_at_heart_rate(samples, aerobic_hr),
        threshold=pace_at_heart_rate(samples, threshold_hr),
    )


def samples_from_streams(
    streams: dict[str, list], *, near: Sequence[int] | None = None, tolerance: int = HR_TOLERANCE_BPM
) -> list[tuple[float | None, float | None]]:
    """`(heart_rate, speed)` pairs out of one decoded stream, as far as both run.

    With `near`, only the pairs `pace_at_heart_rate` could ever use for those target
    heart rates are kept. A year of running is on the order of a million samples, and a
    profile only reads the few percent sitting within a few beats of two thresholds that
    are known before the first stream is decoded -- keeping the rest would hold the
    whole history in memory to throw nearly all of it away.
    """
    heart_rates = streams.get("heartrate") or []
    speeds = streams.get("velocity_smooth") or []
    pairs = zip(heart_rates, speeds)
    if near is None:
        return list(pairs)
    return [
        (heart_rate, speed)
        for heart_rate, speed in pairs
        if heart_rate is not None
        and speed is not None
        and speed >= MIN_RUNNING_SPEED_MPS
        and any(abs(heart_rate - target) <= tolerance for target in near)
    ]


def scale_pace(sec_per_km: int, factor: float) -> int:
    """A pace `factor` times as fast (or slow), rounded to the second.

    Written as a multiplier on *pace* rather than on speed because that is how training
    paces are talked about and prescribed -- "five percent slower than threshold" means
    five percent more seconds per kilometre.
    """
    return round(sec_per_km * factor)
