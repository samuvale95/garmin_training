"""Chest strap against wrist: does the heart-rate trouble follow the watch?

The question a runner asks before sending the watch in for repair. Every run with a
stored stream is judged by `hr_reliability`, then grouped by the sensor Garmin says
recorded it. If cadence locks and unexplained steps show up on wrist runs and not on
strap runs, it is the optical sensor; if they show up on both, it is not the watch.

Only Garmin rows know their sensor -- Strava does not say -- so a history synced from
Strava alone ends up entirely under `unknown`, and the report says so.

    python -m training_plan.hr_sensor_report <user_id> [--days 365]
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Iterable
from dataclasses import asdict, dataclass, field
from datetime import date as date_type
from datetime import timedelta

from . import history, hr_reliability, intensity

SOURCES = ("chest_strap", "wrist", "unknown")
# A run shorter than this rarely gets past the warm-up the step detection skips.
MIN_MINUTES = 25


@dataclass
class SourceStats:
    runs: int = 0
    reliable: int = 0
    dubious: int = 0
    unreliable: int = 0
    with_cadence_lock: int = 0
    locked_share_avg: float = 0.0
    examples: list[dict] = field(default_factory=list)

    @property
    def problem_share(self) -> float:
        return (self.dubious + self.unreliable) / self.runs if self.runs else 0.0


@dataclass
class SensorReport:
    by_source: dict[str, SourceStats]
    conclusion: str


def summarize(rows: Iterable[tuple[str | None, dict, hr_reliability.HrReliability]]) -> SensorReport:
    """`rows` is (hr_source, activity, assessment) per run."""
    stats = {source: SourceStats() for source in SOURCES}
    locked_sum = {source: 0.0 for source in SOURCES}
    for source, activity, rel in rows:
        key = source if source in ("chest_strap", "wrist") else "unknown"
        s = stats[key]
        s.runs += 1
        locked_sum[key] += rel.locked_share
        if rel.verdict == "affidabile":
            s.reliable += 1
        elif rel.verdict == "dubbia":
            s.dubious += 1
        else:
            s.unreliable += 1
        if any(step.locked_to_cadence for step in rel.steps):
            s.with_cadence_lock += 1
        if rel.verdict != "affidabile" and len(s.examples) < 5:
            s.examples.append({
                "day": str(activity.get("day")),
                "title": activity.get("title"),
                "verdict": rel.verdict,
                "from_km": rel.steps[0].distance_km if rel.steps else None,
                "reasons": rel.reasons,
            })
    for key, s in stats.items():
        s.locked_share_avg = round(locked_sum[key] / s.runs, 3) if s.runs else 0.0
    return SensorReport(by_source=stats, conclusion=_conclusion(stats))


def _conclusion(stats: dict[str, SourceStats]) -> str:
    strap, wrist = stats["chest_strap"], stats["wrist"]
    if strap.runs == 0 and wrist.runs == 0:
        return (
            "Nessuna corsa ha l'informazione sul sensore: serve sincronizzare da Garmin "
            "(Strava non dice se c'era la fascia)."
        )
    if strap.runs < 3 or wrist.runs < 3:
        return (
            f"Troppo poche corse per confrontare ({strap.runs} con la fascia, {wrist.runs} col polso): "
            "ne servono almeno 3 per tipo."
        )
    w, c = wrist.problem_share, strap.problem_share
    wl = wrist.with_cadence_lock / wrist.runs
    if w >= 0.15 and w >= 2 * max(c, 0.03):
        return (
            f"Il problema segue l'orologio: anomalie nel {w:.0%} delle corse col polso "
            f"(aggancio alla cadenza nel {wl:.0%}) contro il {c:.0%} con la fascia. "
            "È il limite del sensore ottico; prima dell'assistenza prova cinturino più stretto e più in alto. "
            "Se resta così frequente, ha senso segnalarlo a Garmin con questi numeri."
        )
    if c >= 0.15 and abs(w - c) < 0.10:
        return (
            f"Le anomalie compaiono anche con la fascia ({c:.0%} contro {w:.0%} col polso): "
            "non dipende dall'orologio. Controlla contatto e batteria della fascia."
        )
    return (
        f"Nessuna differenza netta: anomalie nel {w:.0%} delle corse col polso e nel {c:.0%} con la fascia. "
        "Non c'è motivo di mandare l'orologio in assistenza."
    )


def build(user_id: str, *, days: int = 365, end: date_type | None = None) -> SensorReport:
    last = end or date_type.today()
    rows = []
    for activity in history.activities_between(user_id, last - timedelta(days=days), last):
        if activity.get("sport") not in intensity.RUNNING_SPORTS:
            continue
        if (activity.get("duration_min") or 0) < MIN_MINUTES or activity.get("avg_hr") is None:
            continue
        streams = history.load_workout_streams(user_id, activity["source"], activity["activity_id"])
        rel = hr_reliability.assess(streams)
        if rel is None:
            continue
        rows.append((activity.get("hr_source"), activity, rel))
    return summarize(rows)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("user_id")
    parser.add_argument("--days", type=int, default=365)
    args = parser.parse_args(argv)
    report = build(args.user_id, days=args.days)
    print(json.dumps(
        {
            "by_source": {k: {**asdict(v), "problem_share": round(v.problem_share, 3)} for k, v in report.by_source.items()},
            "conclusion": report.conclusion,
        },
        ensure_ascii=False, indent=2, default=str,
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
