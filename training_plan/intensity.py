"""How hard the training actually was, against how hard it was meant to be.

Every other module in this app reads what a session *says*: the plan's target paces, the
activity's summary figures, Garmin's own verdicts. This one reads what the body actually
did, second by second, and puts it next to the intention.

The reason that gap exists at all is arithmetic. A run with an average heart rate of 150
can be sixty minutes steady at 150, or thirty at 130 followed by thirty at 170 -- the
same summary number, two completely different sessions, and only one of them is the easy
run the plan asked for. **An average destroys exactly the information this question needs**,
which is why nothing here works from activity summaries and everything works from streams.

What it is for, in one sentence: the most common mistake in endurance training is running
the easy days too hard, and the people who make it are certain they are not making it --
because every single run feels reasonable at the time. The only thing that settles it is
the distribution, and the distribution needs the stream.

Three zones, not five
---------------------
Five-zone models multiply boundaries without changing the answer to the question being
asked here. The evidence-based unit for training distribution is the three-zone model
(Seiler): below the first ventilatory threshold, between the two, and above the second.
The interesting pathology -- the "grey zone", too hard to recover from and too easy to
drive adaptation -- is the middle one, and it only exists as a concept in the three-zone
frame.

Anchored on a measurement, never on 220 minus age
-------------------------------------------------
Zone boundaries are derived from lactate-threshold heart rate, which Garmin estimates
(`get_lactate_threshold`) from real sessions. Failing that, from the highest heart rate
actually sustained for half an hour in the athlete's own history. The age formula is not
a fallback here: its standard error is around 10-12 bpm, which is wider than the zones it
would be defining.

Same discipline as the rest of the app: every figure is one measurement against one
threshold, both printed, reproducible by hand.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date as date_type
from typing import Literal, Sequence

# ---- zone boundaries -------------------------------------------------------------------
#
# Expressed as fractions of lactate-threshold heart rate, which is the anchor with the
# smallest error bar among those obtainable without a lab.
#
# The first ventilatory threshold sits near 85% of LTHR across the published comparisons;
# the second is LTHR itself, by definition. Both are approximations of a boundary that is
# genuinely fuzzy in the physiology, which is why the screens print the bpm they resolve
# to rather than the percentages.
AEROBIC_THRESHOLD_FRACTION = 0.85

ZONE_EASY = "facile"
ZONE_GREY = "grigia"
ZONE_HARD = "dura"

ZONE_MEANING: dict[str, str] = {
    ZONE_EASY: "sotto la soglia aerobica: costruisce la base e non chiede recupero",
    ZONE_GREY: "fra le due soglie: troppo dura per recuperare, troppo facile per adattarsi",
    ZONE_HARD: "sopra la soglia: il lavoro di qualità, quello che va pagato con il riposo",
}

# The distribution the evidence points at, as a share of total training *time* (not of
# sessions). Roughly 80% easy is the figure the polarized literature converges on across
# endurance sports; the grey zone is not given a target because the finding is that it
# should be small, not that it should be any particular size.
POLARIZED_EASY_SHARE = 0.80
# Above this share of grey-zone time, the distribution has a name in the literature and
# it is not a flattering one.
GREY_ZONE_WARNING_SHARE = 0.25

# How much of a session billed as easy may sit above the aerobic threshold before the
# session stops being an easy one. Some drift is unavoidable -- hills, heat, the last
# kilometre home, and heart rate lags effort by a minute or two either way.
EASY_SESSION_TOLERANCE = 0.15

# A stream shorter than this has nothing to distribute; a warmup lap on its own.
MIN_ANALYSABLE_SECONDS = 600

# Sessions whose plan calls them easy. Matches the vocabulary `nutrition.classify_load`
# and `readiness.session_demand` already use, so the three modules agree on what an easy
# day is.
EASY_INTENTS = ("riposo", "facile")

# A session read out of the history with no plan behind it. Deliberately outside
# EASY_INTENTS: calling every run "meant to be easy" would count each interval session
# as a failed easy day and fire "I tuoi lenti non sono lenti" on a history that simply
# has quality in it.
NO_INTENT = "non_pianificata"

# The sports these zones mean anything for. Heart-rate zones are anchored on a *running*
# lactate threshold, so folding a ski tour or a hike into the distribution is not a
# rounding error -- it is a different physiology measured against the wrong ruler.
#
# The first version of this module had no such filter, and on a real two-year history it
# reported 74% easy where running alone was 54%: ninety hours of skiing, hiking, sailing
# and climbing, almost all of it under the aerobic threshold, quietly flattered a
# distribution that was actually a problem.
RUNNING_SPORTS = ("Run", "TrailRun", "VirtualRun", "running")


@dataclass
class Zones:
    """The three boundaries, and where they came from.

    `source` is on the dataclass rather than in a comment because it changes how much the
    numbers downstream deserve to be trusted, and the screen has to say so.
    """

    threshold_hr: int
    source: Literal["garmin", "stimato"]
    # Top of the easy zone: above this, the session is no longer building base.
    aerobic_hr: int

    @classmethod
    def from_threshold(cls, threshold_hr: int, source: Literal["garmin", "stimato"] = "garmin") -> "Zones":
        # Truncated, not rounded. The boundary is genuinely uncertain by several bpm, so
        # which side of it a single beat falls on is arbitrary either way -- but Python's
        # round() is banker's rounding (144.5 -> 144, 145.5 -> 146), and a threshold that
        # a user cannot reproduce with a calculator has no business being in this module.
        return cls(
            threshold_hr=int(threshold_hr),
            source=source,
            aerobic_hr=int(threshold_hr * AEROBIC_THRESHOLD_FRACTION),
        )

    def zone_of(self, heart_rate: float) -> str:
        if heart_rate <= self.aerobic_hr:
            return ZONE_EASY
        if heart_rate <= self.threshold_hr:
            return ZONE_GREY
        return ZONE_HARD

    def describe(self) -> str:
        return f"facile fino a {self.aerobic_hr} bpm, grigia fino a {self.threshold_hr}, dura sopra"


@dataclass
class TimeInZone:
    """Seconds spent in each zone, and the shares they work out to."""

    easy_seconds: int
    grey_seconds: int
    hard_seconds: int

    @property
    def total_seconds(self) -> int:
        return self.easy_seconds + self.grey_seconds + self.hard_seconds

    def share(self, zone: str) -> float:
        total = self.total_seconds
        if total == 0:
            return 0.0
        seconds = {ZONE_EASY: self.easy_seconds, ZONE_GREY: self.grey_seconds, ZONE_HARD: self.hard_seconds}[zone]
        return seconds / total

    def __add__(self, other: "TimeInZone") -> "TimeInZone":
        return TimeInZone(
            easy_seconds=self.easy_seconds + other.easy_seconds,
            grey_seconds=self.grey_seconds + other.grey_seconds,
            hard_seconds=self.hard_seconds + other.hard_seconds,
        )


def time_in_zone(
    heart_rates: Sequence[float | None], times: Sequence[float] | None, zones: Zones
) -> TimeInZone:
    """Seconds per zone, from a heart-rate stream and its time axis.

    Streams are not evenly sampled -- Strava records "smart" intervals that stretch when
    nothing is changing -- so each sample is weighted by the gap to the next one rather
    than counted as one second. Assuming a uniform 1 Hz (which the first version of this
    did) systematically under-weights the steady parts of a run, which are exactly the
    parts this analysis is about.

    A `None` sample is a dropout: the strap lost contact. It contributes no time at all
    rather than being interpolated, so a lost signal narrows the measurement instead of
    inventing a zone for it.
    """
    if not heart_rates:
        return TimeInZone(0, 0, 0)
    axis = list(times) if times is not None else list(range(len(heart_rates)))
    if len(axis) != len(heart_rates):
        axis = list(range(len(heart_rates)))

    buckets = {ZONE_EASY: 0.0, ZONE_GREY: 0.0, ZONE_HARD: 0.0}
    for i, heart_rate in enumerate(heart_rates):
        if heart_rate is None or heart_rate <= 0:
            continue
        # The last sample gets the median gap rather than zero, so it is not silently
        # dropped; on a smart-recorded stream that gap can be several seconds.
        if i + 1 < len(axis):
            weight = max(float(axis[i + 1]) - float(axis[i]), 0.0)
        else:
            weight = 1.0
        buckets[zones.zone_of(heart_rate)] += weight

    return TimeInZone(
        easy_seconds=round(buckets[ZONE_EASY]),
        grey_seconds=round(buckets[ZONE_GREY]),
        hard_seconds=round(buckets[ZONE_HARD]),
    )


def heart_rate_histogram(
    heart_rates: Sequence[float | None], times: Sequence[float] | None
) -> dict[int, float]:
    """Seconds spent at each whole bpm.

    The same walk as `time_in_zone`, kept before the zones are applied. It is what makes
    the threshold-sensitivity table affordable: asking "and what if the threshold were
    172 instead of 183" is then a re-bucketing of a few hundred integers rather than a
    second pass over six hundred thousand samples, and the honest answer to a verdict
    that pivots on one estimated number is to show how much it moves.

    Histograms add, so a whole history folds into one with `collections.Counter`-style
    accumulation and costs nothing to keep.
    """
    if not heart_rates:
        return {}
    axis = list(times) if times is not None else list(range(len(heart_rates)))
    if len(axis) != len(heart_rates):
        axis = list(range(len(heart_rates)))

    histogram: dict[int, float] = {}
    for i, heart_rate in enumerate(heart_rates):
        if heart_rate is None or heart_rate <= 0:
            continue
        weight = max(float(axis[i + 1]) - float(axis[i]), 0.0) if i + 1 < len(axis) else 1.0
        bucket = int(round(heart_rate))
        histogram[bucket] = histogram.get(bucket, 0.0) + weight
    return histogram


def merge_histograms(histograms: Iterable[dict[int, float]]) -> dict[int, float]:
    merged: dict[int, float] = {}
    for histogram in histograms:
        for bucket, seconds in histogram.items():
            merged[bucket] = merged.get(bucket, 0.0) + seconds
    return merged


def time_in_zone_from_histogram(histogram: dict[int, float], zones: Zones) -> TimeInZone:
    buckets = {ZONE_EASY: 0.0, ZONE_GREY: 0.0, ZONE_HARD: 0.0}
    for heart_rate, seconds in histogram.items():
        buckets[zones.zone_of(heart_rate)] += seconds
    return TimeInZone(
        easy_seconds=round(buckets[ZONE_EASY]),
        grey_seconds=round(buckets[ZONE_GREY]),
        hard_seconds=round(buckets[ZONE_HARD]),
    )


# How far either side of the estimated threshold the sensitivity table reaches, in bpm.
# Garmin's estimate is an estimate, and this is roughly the spread between it and a
# field test -- wide enough to show whether the verdict survives being wrong.
SENSITIVITY_OFFSETS = (-11, -6, 0, +5)


def threshold_sensitivity(histogram: dict[int, float], threshold_hr: int) -> list[dict]:
    """The same distribution read against neighbouring thresholds.

    On a real history eleven beats moved the verdict from "roughly polarized" to "living
    in the grey zone". A screen that shows the first number without this one is claiming
    a precision the input does not have.
    """
    rows = []
    for offset in SENSITIVITY_OFFSETS:
        candidate = Zones.from_threshold(threshold_hr + offset)
        in_zone = time_in_zone_from_histogram(histogram, candidate)
        rows.append(
            {
                "threshold_hr": candidate.threshold_hr,
                "aerobic_hr": candidate.aerobic_hr,
                "is_estimate": offset == 0,
                "easy_share": round(in_zone.share(ZONE_EASY), 3),
                "grey_share": round(in_zone.share(ZONE_GREY), 3),
                "hard_share": round(in_zone.share(ZONE_HARD), 3),
            }
        )
    return rows


# ---- one session: what it was for, and what it became ----------------------------------


@dataclass
class SessionExecution:
    """One session, with the plan's intention next to the stream's verdict."""

    activity_id: int
    date: date_type
    title: str
    sport: str
    intent: str  # the plan's own load word: riposo / facile / moderato / duro / molto_lungo
    zones: TimeInZone
    # True only for a session the plan billed as easy that was, in fact, easy.
    honoured: bool | None
    detail: str


def read_execution(
    *,
    activity_id: int,
    day: date_type,
    title: str,
    intent: str,
    sport: str = "Run",
    heart_rates: Sequence[float | None],
    times: Sequence[float] | None,
    zones: Zones,
) -> SessionExecution | None:
    """One session's distribution, and whether it did what it said it would.

    `honoured` is `None` for anything the plan did not bill as easy: a quality session
    spending time above threshold is the session working, not a discrepancy, and marking
    it "not honoured" would bury the finding that matters under six that do not.
    """
    in_zone = time_in_zone(heart_rates, times, zones)
    if in_zone.total_seconds < MIN_ANALYSABLE_SECONDS:
        return None

    above = in_zone.share(ZONE_GREY) + in_zone.share(ZONE_HARD)

    if intent not in EASY_INTENTS:
        honoured = None
        detail = (
            f"{round(in_zone.share(ZONE_HARD) * 100)}% del tempo sopra soglia, "
            f"{round(in_zone.share(ZONE_EASY) * 100)}% in facile"
        )
    elif above <= EASY_SESSION_TOLERANCE:
        honoured = True
        detail = f"tenuta facile davvero: {round(above * 100)}% sopra la soglia aerobica"
    else:
        honoured = False
        detail = (
            f"doveva essere facile, ma il {round(above * 100)}% del tempo è sopra la soglia "
            f"aerobica ({zones.aerobic_hr} bpm)"
        )

    return SessionExecution(
        activity_id=activity_id,
        date=day,
        title=title,
        sport=sport,
        intent=intent,
        zones=in_zone,
        honoured=honoured,
        detail=detail,
    )


# ---- the block: you against the state of the art ----------------------------------------

EVIDENCE_RESEARCH = "ricerca"
EVIDENCE_YOURS = "tuoi dati"
EVIDENCE_MEASURED = "misurato"


@dataclass
class Finding:
    """One thing the data says, with the strength of the claim attached to it.

    `evidence` is the load-bearing field and the reason this dataclass exists rather than
    a string. "Il 41% dei tuoi minuti facili è sopra soglia" is a measurement. "Spostarlo
    sotto il 10% migliora la resistenza aerobica" is a population finding. "Nei tuoi due
    blocchi più polarizzati il disaccoppiamento è sceso" is a correlation in one person's
    uncontrolled data. Presenting all three in the same voice is how an app ends up
    sounding certain about things nobody is certain about.
    """

    key: str
    headline: str
    measured: str
    evidence: str
    standard: str | None = None
    action: str | None = None
    severity: str = "info"  # "info" | "attenzione"


@dataclass
class BlockDistribution:
    """Several weeks of training, distributed -- and compared to the published standard."""

    sessions: int
    from_date: date_type
    to_date: date_type
    zones: TimeInZone
    easy_share: float
    grey_share: float
    hard_share: float
    # Sessions the plan called easy, and how many of them were.
    easy_planned: int
    easy_honoured: int
    findings: list[Finding] = field(default_factory=list)


def _distribution_findings(easy: float, grey: float, planned: int, honoured: int) -> list[Finding]:
    findings: list[Finding] = []

    missed = planned - honoured
    if planned > 0 and missed > 0:
        findings.append(
            Finding(
                key="facili_non_facili",
                headline="I tuoi lenti non sono lenti",
                measured=f"{missed} sedute su {planned} previste facili sono finite sopra la soglia aerobica",
                standard=(
                    "il modello polarizzato tiene circa l'80% del tempo sotto la soglia aerobica: "
                    "è la base aerobica a crescere lì, non nella fascia intermedia"
                ),
                evidence=EVIDENCE_RESEARCH,
                action=(
                    "corri i facili a frequenza, non a passo: metti l'allarme sopra la soglia aerobica "
                    "e accetta di andare più piano di quanto ti sembri giusto"
                ),
                severity="attenzione",
            )
        )

    if easy < POLARIZED_EASY_SHARE:
        findings.append(
            Finding(
                key="distribuzione",
                headline="Troppo poco tempo in facile",
                measured=f"{round(easy * 100)}% del tempo sotto la soglia aerobica",
                standard=f"il riferimento polarizzato è circa il {round(POLARIZED_EASY_SHARE * 100)}%",
                evidence=EVIDENCE_RESEARCH,
                action="il modo più semplice è rallentare i lenti, non togliere le sedute dure",
                severity="attenzione" if easy < POLARIZED_EASY_SHARE - 0.15 else "info",
            )
        )
    else:
        findings.append(
            Finding(
                key="distribuzione",
                headline="La distribuzione è dove dovrebbe stare",
                measured=f"{round(easy * 100)}% del tempo sotto la soglia aerobica",
                standard=f"il riferimento polarizzato è circa il {round(POLARIZED_EASY_SHARE * 100)}%",
                evidence=EVIDENCE_MEASURED,
            )
        )

    if grey > GREY_ZONE_WARNING_SHARE:
        findings.append(
            Finding(
                key="zona_grigia",
                headline="Stai vivendo nella fascia intermedia",
                measured=f"{round(grey * 100)}% del tempo fra soglia aerobica e soglia",
                standard=(
                    "è la fascia che costa recupero come una seduta dura senza darne gli adattamenti: "
                    "la critica principale al modello a soglia sta tutta qui"
                ),
                evidence=EVIDENCE_RESEARCH,
                action="dividi le giornate in due: o davvero facile, o davvero dura. La via di mezzo paga poco",
                severity="attenzione",
            )
        )

    return findings


def read_block(executions: list[SessionExecution]) -> BlockDistribution | None:
    """Several weeks of sessions as one distribution, with what it says about them.

    The unit is *time*, not sessions: eight easy half-hours and two hard hours are not an
    80/20 split, and counting sessions instead of minutes is the most common way the
    polarized rule gets misquoted.
    """
    # Running only, and not as a convenience: see RUNNING_SPORTS for the two-year
    # history where skiing and hiking turned a 54% easy share into a reassuring 74%.
    executions = [e for e in executions if e.sport in RUNNING_SPORTS]
    if not executions:
        return None

    total = TimeInZone(0, 0, 0)
    for execution in executions:
        total = total + execution.zones
    if total.total_seconds == 0:
        return None

    planned = [e for e in executions if e.intent in EASY_INTENTS]
    honoured = [e for e in planned if e.honoured]
    dates = sorted(e.date for e in executions)

    easy, grey, hard = total.share(ZONE_EASY), total.share(ZONE_GREY), total.share(ZONE_HARD)

    return BlockDistribution(
        sessions=len(executions),
        from_date=dates[0],
        to_date=dates[-1],
        zones=total,
        easy_share=round(easy, 3),
        grey_share=round(grey, 3),
        hard_share=round(hard, 3),
        easy_planned=len(planned),
        easy_honoured=len(honoured),
        findings=_distribution_findings(easy, grey, len(planned), len(honoured)),
    )
