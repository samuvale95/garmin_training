"""Per-sport technique: what a finished activity says about how it was actually done.

The rest of this app looks at *how much* was trained -- load, readiness, fuelling. This
module looks at *how*. It reads the form metrics a watch already records and nobody ever
opens (ground contact time, vertical ratio, pedalling cadence, SWOLF), compares each one
against a published reference band, and turns the comparison into one thing to work on.

Same discipline as `readiness.py` and `nutrition.py`, and for the same reason: every
verdict here is one measurement against one threshold, printed with both numbers, so a
user who disagrees can see exactly what produced the answer. A language model is allowed
to phrase the result (`llm.write_coach_narrative`) and nothing else.

Two honest limits, stated here because they belong on the screen too:

- **Form metrics are not form.** Ground contact time correlates with running economy
  across a population; it does not diagnose an individual's stride, and chasing a
  number is a good way to acquire an injury. Every cue below is a drill to try, never
  a fault to fix.
- **They are speed-dependent.** Cadence at 6:00/km and cadence at 4:00/km are different
  measurements of different things, so the bands are read with the session's own pace
  next to them, and a metric with no pace to anchor it is reported without a verdict.

Nothing here writes to Garmin, and a missing field degrades to "not measured" rather
than raising -- the same rule `body_insights.py` applies to the same undocumented
endpoints.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date as date_type
from datetime import datetime

from .garmin_sync import GarminSync
from .models import sport_from_garmin_key

logger = logging.getLogger(__name__)

VERDICT_GOOD = "buono"
VERDICT_OK = "nella norma"
VERDICT_WORK = "da lavorarci"
# For a metric that is worth showing but has no meaningful "better" direction --
# stride length, pool SWOLF on its own, average power in isolation.
VERDICT_NEUTRAL = "da leggere"

# Order used everywhere a list of findings is sorted: the thing to work on first.
_VERDICT_RANK = {VERDICT_WORK: 0, VERDICT_OK: 1, VERDICT_GOOD: 2, VERDICT_NEUTRAL: 3}


@dataclass
class FormMetric:
    """One measurement, its reference band, and what to do about it."""

    key: str
    label: str
    value: float
    unit: str
    # Pre-formatted for display: the arithmetic that rounds a figure belongs next to the
    # figure, not in six different components.
    display: str
    verdict: str
    # The band the verdict came from, written so it can be checked by eye.
    reference: str
    # One line on what the metric even is. This is the half that makes the screen
    # useful to someone who has never heard of vertical ratio.
    meaning: str
    # What to actually do, when there is something to do.
    cue: str | None = None


@dataclass
class PacingRead:
    """How the effort was distributed, from the activity's own laps."""

    kind: str  # "negativo" | "regolare" | "positivo"
    first_half_pace_sec_per_km: float | None
    second_half_pace_sec_per_km: float | None
    drift_percent: float | None
    detail: str
    verdict: str


@dataclass
class ActivityForm:
    activity_id: int
    date: date_type
    sport: str
    title: str
    distance_km: float | None
    duration_min: float | None
    average_pace_sec_per_km: float | None
    average_heart_rate: int | None
    metrics: list[FormMetric] = field(default_factory=list)
    pacing: PacingRead | None = None
    # The deterministic headline and the one thing to take away, both always present so
    # the screen never depends on a model being reachable.
    headline: str = ""
    focus: str | None = None
    # False when the watch recorded nothing this module can read -- a treadmill run from
    # a chest strap, a pool session logged by hand. The screen says so instead of
    # showing an empty analysis.
    has_metrics: bool = True


# ---- helpers ----------------------------------------------------------------------------


def _get(d, *keys, default=None):
    if not isinstance(d, dict):
        return default
    for key in keys:
        value = d.get(key)
        if value is not None:
            return value
    return default


def _number(value) -> float | None:
    return float(value) if isinstance(value, (int, float)) else None


def _band(value: float, bands: list[tuple[float | None, str]]) -> str:
    """The first band whose upper bound `value` falls under. The last entry's bound is
    `None` and catches everything above."""
    for upper, verdict in bands:
        if upper is None or value < upper:
            return verdict
    return bands[-1][1]


# ---- running ------------------------------------------------------------------------------
#
# Bands from the published distributions of Garmin's own running-dynamics data (the same
# colour zones the watch shows) and from the running-economy literature they come out of.
# Deliberately wide: these are population bands, and a runner sitting one zone "worse"
# than average on one metric has learned almost nothing about themselves.

# Steps per minute, both feet. The famous "180" is Daniels' observation of elite runners
# *racing*, not a target for an easy run, so the band that matters here is the low one:
# under about 160 spm at any pace is a long, slow stride, and that is worth a cue.
CADENCE_BANDS = [(160.0, VERDICT_WORK), (170.0, VERDICT_OK), (None, VERDICT_GOOD)]

# Milliseconds the foot spends on the ground per step. Shorter is more economical, and
# it falls naturally as pace rises -- which is why the verdict is only offered when the
# session was fast enough for the number to mean anything.
GROUND_CONTACT_BANDS = [(240.0, VERDICT_GOOD), (280.0, VERDICT_OK), (None, VERDICT_WORK)]

# Centimetres the torso travels up and down per step. Vertical travel is work that does
# not go into moving forward.
VERTICAL_OSCILLATION_BANDS = [(8.0, VERDICT_GOOD), (10.0, VERDICT_OK), (None, VERDICT_WORK)]

# Vertical oscillation as a percentage of stride length -- the better of the two, because
# it is the one that accounts for how far each step actually travels.
VERTICAL_RATIO_BANDS = [(7.0, VERDICT_GOOD), (9.0, VERDICT_OK), (None, VERDICT_WORK)]

# Percentage of ground contact time spent on the left foot. 50 is symmetric; the band is
# generous because the measurement itself is noisy at the half-percent level.
BALANCE_TOLERANCE_GOOD = 1.0
BALANCE_TOLERANCE_OK = 2.5

# Under this pace, ground contact time and vertical oscillation are measuring a jog, and
# the reference bands (drawn from runs at effort) say nothing useful about it.
SLOW_RUN_PACE_SEC_PER_KM = 390.0


def _running_metrics(summary: dict, pace_sec_per_km: float | None) -> list[FormMetric]:
    metrics: list[FormMetric] = []

    cadence = _number(
        _get(summary, "averageRunningCadenceInStepsPerMinute", "averageRunCadence", "avgRunCadence")
    )
    if cadence:
        verdict = _band(cadence, CADENCE_BANDS)
        metrics.append(
            FormMetric(
                key="cadenza",
                label="Cadenza",
                value=round(cadence, 1),
                unit="passi/min",
                display=f"{round(cadence)} passi/min",
                verdict=verdict,
                reference="sopra 170 passi/min",
                meaning="quanti passi fai al minuto: più passi corti che lunghi tengono il piede sotto il bacino",
                cue=(
                    "prova 4 tratti da 1 minuto contando i passi e tenendone 5 in più del solito, "
                    "senza correre più forte"
                )
                if verdict == VERDICT_WORK
                else None,
            )
        )

    contact = _number(_get(summary, "avgGroundContactTime", "averageGroundContactTime"))
    if contact:
        slow = pace_sec_per_km is not None and pace_sec_per_km > SLOW_RUN_PACE_SEC_PER_KM
        verdict = VERDICT_NEUTRAL if slow else _band(contact, GROUND_CONTACT_BANDS)
        metrics.append(
            FormMetric(
                key="contatto",
                label="Tempo di contatto",
                value=round(contact),
                unit="ms",
                display=f"{round(contact)} ms",
                verdict=verdict,
                reference="sotto 240 ms a ritmo sostenuto",
                meaning="quanto resta a terra il piede a ogni passo: meno resta, meno energia si perde nell'appoggio",
                cue=(
                    "allunghi in salita leggera, 6 × 15 secondi: la salita accorcia il contatto senza doverci pensare"
                )
                if verdict == VERDICT_WORK
                else ("a questo ritmo il dato dice poco: guardalo su una seduta più veloce" if slow else None),
            )
        )

    oscillation = _number(_get(summary, "avgVerticalOscillation", "averageVerticalOscillation"))
    if oscillation:
        # Garmin reports this in centimetres on some responses and millimetres on
        # others; anything above 30 is obviously the latter.
        if oscillation > 30:
            oscillation = oscillation / 10
        verdict = _band(oscillation, VERTICAL_OSCILLATION_BANDS)
        metrics.append(
            FormMetric(
                key="oscillazione",
                label="Oscillazione verticale",
                value=round(oscillation, 1),
                unit="cm",
                display=f"{oscillation:.1f} cm",
                verdict=verdict,
                reference="sotto 8 cm",
                meaning="quanto sali e scendi a ogni passo: è lavoro che non ti porta avanti",
                cue="corri 30 secondi immaginando un soffitto basso, alternati a 30 normali"
                if verdict == VERDICT_WORK
                else None,
            )
        )

    ratio = _number(_get(summary, "avgVerticalRatio", "averageVerticalRatio"))
    if ratio:
        verdict = _band(ratio, VERTICAL_RATIO_BANDS)
        metrics.append(
            FormMetric(
                key="rapporto_verticale",
                label="Rapporto verticale",
                value=round(ratio, 1),
                unit="%",
                display=f"{ratio:.1f}%",
                verdict=verdict,
                reference="sotto il 7%",
                meaning="l'oscillazione misurata sulla lunghezza del passo: il singolo numero che riassume meglio l'efficienza",
                cue="è la conseguenza di cadenza e oscillazione: lavora su quelle, non su questo"
                if verdict == VERDICT_WORK
                else None,
            )
        )

    balance = _number(_get(summary, "avgGroundContactBalance", "averageGroundContactBalance"))
    if balance:
        gap = abs(balance - 50.0)
        verdict = (
            VERDICT_GOOD
            if gap <= BALANCE_TOLERANCE_GOOD
            else VERDICT_OK
            if gap <= BALANCE_TOLERANCE_OK
            else VERDICT_WORK
        )
        side = "sinistra" if balance > 50 else "destra"
        metrics.append(
            FormMetric(
                key="bilanciamento",
                label="Bilanciamento appoggio",
                value=round(balance, 1),
                unit="% sinistra",
                display=f"{balance:.1f}% / {100 - balance:.1f}%",
                verdict=verdict,
                reference="50/50, tolleranza ±2,5",
                meaning="come si divide il tempo a terra fra i due piedi",
                cue=(
                    f"stai caricando di più la gamba {side}: se è costante su più uscite vale un occhio "
                    "a mobilità d'anca e forza monopodalica, non una correzione della corsa"
                )
                if verdict == VERDICT_WORK
                else None,
            )
        )

    stride = _number(_get(summary, "avgStrideLength", "averageStrideLength"))
    if stride:
        # Centimetres on this endpoint, metres on others.
        stride_m = stride / 100 if stride > 5 else stride
        metrics.append(
            FormMetric(
                key="passo",
                label="Lunghezza del passo",
                value=round(stride_m, 2),
                unit="m",
                display=f"{stride_m:.2f} m",
                verdict=VERDICT_NEUTRAL,
                reference="cresce con il ritmo, non va allungata a comando",
                meaning="quanto avanzi a ogni passo: si allunga da sola quando spingi di più",
                cue=None,
            )
        )

    return metrics


# ---- cycling ------------------------------------------------------------------------------

# Pedalling revolutions per minute. Under about 75 is grinding a big gear, which costs
# the legs what it saves the lungs; the useful endurance band sits either side of 90.
BIKE_CADENCE_LOW = 75.0
BIKE_CADENCE_HIGH = 100.0

# Normalized power over average power. On a steady ride this should be near 1: the
# further above, the more the ride was surges and coasting rather than pedalling.
VARIABILITY_STEADY = 1.05
VARIABILITY_VARIABLE = 1.15


def _cycling_metrics(summary: dict) -> list[FormMetric]:
    metrics: list[FormMetric] = []

    cadence = _number(_get(summary, "averageBikingCadenceInRevPerMinute", "averageBikeCadence", "avgBikeCadence"))
    if cadence:
        if cadence < BIKE_CADENCE_LOW:
            verdict, cue = (
                VERDICT_WORK,
                "un'ora a cadenza libera ma sempre sopra 85 rpm, anche se vai più piano: "
                "è la gamba che deve imparare, non la strada",
            )
        elif cadence > BIKE_CADENCE_HIGH:
            verdict, cue = VERDICT_OK, "cadenza alta, va bene se il cuore ti sta dietro"
        else:
            verdict, cue = VERDICT_GOOD, None
        metrics.append(
            FormMetric(
                key="cadenza_bici",
                label="Cadenza di pedalata",
                value=round(cadence, 1),
                unit="rpm",
                display=f"{round(cadence)} rpm",
                verdict=verdict,
                reference="85-95 rpm in endurance",
                meaning="giri di pedale al minuto: sotto i 75 stai spingendo un rapporto che paghi nelle gambe",
                cue=cue,
            )
        )

    average_power = _number(_get(summary, "avgPower", "averagePower"))
    normalized = _number(_get(summary, "normPower", "normalizedPower"))
    if average_power:
        metrics.append(
            FormMetric(
                key="potenza",
                label="Potenza media",
                value=round(average_power),
                unit="W",
                display=f"{round(average_power)} W",
                verdict=VERDICT_NEUTRAL,
                reference="confrontala con le tue uscite simili, non con quelle di altri",
                meaning="il lavoro che hai messo nei pedali, l'unico dato in bici che non mente sul vento",
                cue=None,
            )
        )
    if average_power and normalized and average_power > 0:
        index = normalized / average_power
        if index < VARIABILITY_STEADY:
            verdict, cue = VERDICT_GOOD, None
        elif index < VARIABILITY_VARIABLE:
            verdict, cue = VERDICT_OK, None
        else:
            verdict, cue = (
                VERDICT_WORK,
                "uscita fatta a strappi: se doveva essere endurance, cerca strade dove puoi pedalare "
                "continuo invece che accelerare e rullare",
            )
        metrics.append(
            FormMetric(
                key="regolarita",
                label="Regolarità della pedalata",
                value=round(index, 2),
                unit="",
                display=f"{index:.2f}",
                verdict=verdict,
                reference="vicino a 1,00 su un'uscita continua",
                meaning="potenza normalizzata divisa per la media: quanto l'uscita è stata continua invece che a strappi",
                cue=cue,
            )
        )

    balance = _number(_get(summary, "avgLeftBalance", "averageLeftBalance"))
    if balance:
        gap = abs(balance - 50.0)
        verdict = VERDICT_GOOD if gap <= 2 else VERDICT_OK if gap <= 5 else VERDICT_WORK
        metrics.append(
            FormMetric(
                key="bilanciamento_bici",
                label="Bilanciamento pedalata",
                value=round(balance, 1),
                unit="% sinistra",
                display=f"{balance:.1f}% / {100 - balance:.1f}%",
                verdict=verdict,
                reference="50/50, tolleranza ±5",
                meaning="quanta potenza esce da ciascuna gamba",
                cue="squilibrio costante: vale una controllata alla posizione in sella prima che ai muscoli"
                if verdict == VERDICT_WORK
                else None,
            )
        )

    return metrics


# ---- swimming -----------------------------------------------------------------------------

# SWOLF is seconds plus strokes for one length; on 25 m it is the number most pools are
# talked about in. Lower is better, and the bands below are the usual amateur-to-good
# spread for 25 m freestyle.
SWOLF_BANDS_25M = [(35.0, VERDICT_GOOD), (45.0, VERDICT_OK), (None, VERDICT_WORK)]


def _swimming_metrics(summary: dict) -> list[FormMetric]:
    metrics: list[FormMetric] = []

    swolf = _number(_get(summary, "avgSwolf", "averageSwolf"))
    pool_length = _number(_get(summary, "poolLength"))
    if swolf:
        # Only the 25 m bands are published here; in any other pool the number is still
        # worth tracking against itself, but not against a table.
        known_pool = pool_length is None or 24 <= pool_length <= 26
        verdict = _band(swolf, SWOLF_BANDS_25M) if known_pool else VERDICT_NEUTRAL
        metrics.append(
            FormMetric(
                key="swolf",
                label="SWOLF",
                value=round(swolf, 1),
                unit="",
                display=f"{swolf:.0f}",
                verdict=verdict,
                reference="sotto 35 in vasca da 25 m" if known_pool else "confrontalo con le tue vasche, non con una tabella",
                meaning="secondi più bracciate per vasca: scende sia nuotando più forte sia nuotando più efficiente",
                cue="serie da 50 contando le bracciate e provando a togliere una bracciata per vasca "
                "tenendo lo stesso tempo"
                if verdict == VERDICT_WORK
                else None,
            )
        )

    strokes = _number(_get(summary, "avgStrokes", "averageStrokes"))
    if strokes:
        metrics.append(
            FormMetric(
                key="bracciate",
                label="Bracciate per vasca",
                value=round(strokes, 1),
                unit="",
                display=f"{strokes:.0f}",
                verdict=VERDICT_NEUTRAL,
                reference="meno bracciate a parità di tempo = più scivolamento",
                meaning="quante bracciate ti servono per una vasca",
                cue=None,
            )
        )

    cadence = _number(_get(summary, "averageSwimCadenceInStrokesPerMinute", "avgStrokeCadence"))
    if cadence:
        metrics.append(
            FormMetric(
                key="frequenza_bracciata",
                label="Frequenza di bracciata",
                value=round(cadence, 1),
                unit="bracciate/min",
                display=f"{round(cadence)} bracciate/min",
                verdict=VERDICT_NEUTRAL,
                reference="va letta insieme al SWOLF",
                meaning="quanto spesso giri le braccia: alzarla senza perdere scivolamento è il lavoro di anni",
                cue=None,
            )
        )

    return metrics


# ---- pacing -------------------------------------------------------------------------------

# How far apart the two halves have to be before the split is worth naming, as a
# fraction. Inside this, a run is "regolare" -- GPS alone moves a lap pace by more than
# a percent or two.
SPLIT_TOLERANCE = 0.025


def _lap_pace(lap: dict) -> tuple[float, float] | None:
    """(distance_km, duration_s) for one lap, or None when it has neither."""
    distance = _number(_get(lap, "distance"))
    duration = _number(_get(lap, "duration", "elapsedDuration", "movingDuration"))
    if not distance or not duration or distance <= 0:
        return None
    return distance / 1000.0, duration


def read_pacing(laps: list[dict]) -> PacingRead | None:
    """Negative, even or positive split, from the activity's own laps.

    The one piece of "how it was done" that needs no watch sensor at all -- and, for a
    long run or a race, the one that says the most. Two laps is the minimum; a session
    recorded as a single lap has no distribution to read.
    """
    parsed = [p for lap in laps if (p := _lap_pace(lap)) is not None]
    if len(parsed) < 2:
        return None

    total_km = sum(km for km, _ in parsed)
    if total_km <= 0:
        return None

    half = total_km / 2
    first_km = first_s = second_km = second_s = 0.0
    covered = 0.0
    for km, seconds in parsed:
        # A lap straddling the midpoint is split proportionally rather than assigned
        # whole: with 5 km laps on a 30 km run, assigning whole laps moves the boundary
        # by 2.5 km and invents a split that is not there.
        if covered + km <= half:
            first_km, first_s = first_km + km, first_s + seconds
        elif covered >= half:
            second_km, second_s = second_km + km, second_s + seconds
        else:
            share = (half - covered) / km
            first_km, first_s = first_km + km * share, first_s + seconds * share
            second_km, second_s = second_km + km * (1 - share), second_s + seconds * (1 - share)
        covered += km

    if first_km <= 0 or second_km <= 0:
        return None

    first_pace = first_s / first_km
    second_pace = second_s / second_km
    drift = (second_pace - first_pace) / first_pace

    if drift < -SPLIT_TOLERANCE:
        kind, verdict = "negativo", VERDICT_GOOD
        detail = "seconda metà più veloce della prima: è così che si impara a finire una gara"
    elif drift <= SPLIT_TOLERANCE:
        kind, verdict = "regolare", VERDICT_GOOD
        detail = "ritmo tenuto uguale dall'inizio alla fine"
    else:
        kind, verdict = "positivo", VERDICT_WORK
        detail = (
            f"seconda metà più lenta del {abs(drift) * 100:.0f}%: sei partito più forte di quanto "
            "la giornata reggesse"
        )

    return PacingRead(
        kind=kind,
        first_half_pace_sec_per_km=round(first_pace, 1),
        second_half_pace_sec_per_km=round(second_pace, 1),
        drift_percent=round(drift * 100, 1),
        detail=detail,
        verdict=verdict,
    )


# ---- putting it together --------------------------------------------------------------------

SPORT_METRIC_READERS: dict[str, Callable[[dict], list[FormMetric]]] = {
    "cycling": _cycling_metrics,
    "swimming": _swimming_metrics,
}


def _headline(metrics: list[FormMetric], pacing: PacingRead | None) -> str:
    """The same priority `_focus` uses, said out loud.

    The two used to rank independently, so a run with a blown second half could be
    titled after its vertical oscillation and then advised about its pacing -- a card
    arguing with itself.
    """
    if not metrics and pacing is None:
        return "L'orologio non ha registrato dati di tecnica"
    if pacing is not None and pacing.verdict == VERDICT_WORK:
        return "Da lavorarci: come distribuisci il ritmo"
    to_work = [m for m in metrics if m.verdict == VERDICT_WORK]
    if to_work:
        return f"Da lavorarci: {to_work[0].label.lower()}"
    return "Niente fuori posto in questa seduta"


def _focus(metrics: list[FormMetric], pacing: PacingRead | None) -> str | None:
    """One cue, never a list of six.

    A screen that hands someone five things to fix hands them nothing. The worst metric
    with a cue attached wins; pacing wins over everything when it is the thing that went
    wrong, because how a session was distributed matters more than any single form
    number.
    """
    if pacing is not None and pacing.verdict == VERDICT_WORK:
        return (
            "Parti più piano. Il primo chilometro deve sembrarti troppo lento: se la seconda metà "
            "crolla, il problema è quasi sempre l'inizio."
        )
    for metric in sorted(metrics, key=lambda m: _VERDICT_RANK[m.verdict]):
        if metric.verdict == VERDICT_WORK and metric.cue:
            return metric.cue
    return None


def analyse_activity(
    summary: dict,
    *,
    activity_id: int,
    sport: str,
    title: str,
    day: date_type,
    laps: list[dict] | None = None,
) -> ActivityForm:
    """An activity's summary (and optionally its laps) as a technique read.

    Pure function over two dicts: the Garmin call lives in `fetch_activity_form` below,
    so every band in this module can be tested without a network.
    """
    distance_m = _number(_get(summary, "distance"))
    duration_s = _number(_get(summary, "duration", "elapsedDuration", "movingDuration"))
    distance_km = round(distance_m / 1000, 2) if distance_m else None
    duration_min = round(duration_s / 60, 1) if duration_s else None
    pace = duration_s / (distance_m / 1000) if distance_m and duration_s and distance_m > 0 else None

    if sport == "running":
        metrics = _running_metrics(summary, pace)
    else:
        reader = SPORT_METRIC_READERS.get(sport)
        metrics = reader(summary) if reader else []

    pacing = read_pacing(laps or []) if sport in ("running", "cycling") else None
    metrics.sort(key=lambda m: _VERDICT_RANK[m.verdict])

    heart_rate = _number(_get(summary, "averageHR", "averageHeartRate"))

    return ActivityForm(
        activity_id=activity_id,
        date=day,
        sport=sport,
        title=title,
        distance_km=distance_km,
        duration_min=duration_min,
        average_pace_sec_per_km=round(pace, 1) if pace else None,
        average_heart_rate=round(heart_rate) if heart_rate else None,
        metrics=metrics,
        pacing=pacing,
        headline=_headline(metrics, pacing),
        focus=_focus(metrics, pacing),
        has_metrics=bool(metrics) or pacing is not None,
    )


def _activity_date(summary: dict, activity: dict) -> date_type:
    raw = _get(summary, "startTimeLocal") or _get(activity, "startTimeLocal") or ""
    try:
        return datetime.strptime(str(raw)[:10], "%Y-%m-%d").date()
    except ValueError:
        return date_type.today()


def fetch_activity_form(activity_id: int, sync: GarminSync) -> ActivityForm:
    """One completed activity, read for technique.

    Two Garmin calls: the activity itself (whose `summaryDTO` carries every form metric
    the watch recorded) and its laps, which only the pacing read needs -- and whose
    failure costs that read and nothing else.
    """
    client = sync.client
    activity = client.get_activity(activity_id)
    summary = _get(activity, "summaryDTO", default={}) or {}

    sport_key = _get(_get(activity, "activityTypeDTO"), "typeKey")
    sport = sport_from_garmin_key(sport_key)
    title = str(_get(_get(activity, "activityName"), default="") or _get(activity, "activityName") or "Attività")

    laps: list[dict] = []
    try:
        splits = client.get_activity_splits(activity_id)
        raw_laps = _get(splits, "lapDTOs", default=[])
        if isinstance(raw_laps, list):
            laps = [lap for lap in raw_laps if isinstance(lap, dict)]
    except Exception:  # noqa: BLE001 - no laps means no pacing read, not a failed screen
        logger.warning("splits unavailable for activity %s, skipping the pacing read", activity_id, exc_info=True)

    return analyse_activity(
        summary,
        activity_id=activity_id,
        sport=sport,
        title=title,
        day=_activity_date(summary, activity),
        laps=laps,
    )


def coach_facts(form: ActivityForm) -> dict:
    """The already-decided dict the model is allowed to phrase.

    Same contract as `readiness.verdict_facts`: the verdicts and the cue are settled
    before this is built, so there is no room for the model to reach a different
    conclusion -- only to say this one better.
    """
    facts: dict = {
        "sport": form.sport,
        "seduta": form.title,
        "distanza_km": form.distance_km,
        "durata_min": form.duration_min,
        "misure": [
            {"cosa": m.label, "valore": m.display, "giudizio": m.verdict, "riferimento": m.reference}
            for m in form.metrics
        ],
    }
    if form.pacing:
        facts["andatura"] = {"tipo": form.pacing.kind, "dettaglio": form.pacing.detail}
    if form.focus:
        facts["da_fare"] = form.focus
    return facts
