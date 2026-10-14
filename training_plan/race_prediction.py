"""Race prediction and goal confidence -- part 2 of PLAN-goal-confidence-nutrition.md.

Every number here is arithmetic the user could redo by hand; the model only writes the
sentence around it (see `prediction_facts`). Three inputs, each computed and shown on
its own, so the user can see which one is dragging the assessment:

1. Fitness: Riegel's T2 = T1 * (D2 / D1)^1.06 from the best qualifying effort of the
   last 8 weeks, cross-checked against Garmin's VO2max. A disagreement over 5% widens
   the prediction into a range rather than picking a winner. With no qualifying effort
   there is no prediction: the app says so instead of extrapolating an easy jog, and
   offers the VO2max figure only as a weaker estimate.
2. Adherence over the last 42 days: planned runs with a run on that day (or the day
   either side), and kilometres run against kilometres planned.
3. Risk: the acute:chronic ratio of running minutes, the readiness trend over 14 days,
   and the weekly ramp still needed to reach the plan's peak week.

They combine into a band, never a percentage:

    gap = (predicted - target) / target   (a range: its slower end)
    gap <= -1%  -> avanti
    gap <=  2%  -> in linea
    gap <=  6%  -> ambizioso
    otherwise   -> fuori portata

then session adherence under 70% drops one band (the plan isn't being run), and with
more than 12 weeks to go the wording softens (there is time for the picture to change).
A goal with no target time gets no band at all -- only the three inputs.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date as date_type, timedelta
from typing import Any, Sequence

from .goal_fit import _longest_run_guide
from .models import RaceGoal, TrainingSession, days_to_race, race_phase, session_distance_km
from .plan_limits import ACWR_SAFE_MAX, ACWR_SAFE_MIN, calculate_rolling_acwr

RIEGEL_EXPONENT = 1.06
LOOKBACK_DAYS_PERFORMANCE = 56  # 8 weeks
LOOKBACK_DAYS_ADHERENCE = 42  # 6 weeks
MARATHON_KM = 42.195

# The band: how far the prediction is from the target, as a share of the target.
GAP_AHEAD = -0.01
GAP_ON_TRACK = 0.02
GAP_AMBITIOUS = 0.06

BAND_AHEAD = "avanti"
BAND_ON_TRACK = "in_linea"
BAND_AMBITIOUS = "ambizioso"
BAND_OUT_OF_REACH = "fuori_portata"
BANDS = (BAND_AHEAD, BAND_ON_TRACK, BAND_AMBITIOUS, BAND_OUT_OF_REACH)
BAND_LABEL = {
    BAND_AHEAD: "Sei avanti",
    BAND_ON_TRACK: "In linea",
    BAND_AMBITIOUS: "Ambizioso",
    BAND_OUT_OF_REACH: "Fuori portata a questo ritmo",
}

STATUS_ASSESSED = "valutato"
STATUS_NO_TARGET = "senza_tempo_obiettivo"
STATUS_NO_DATA = "dati_insufficienti"

# Modifiers.
SESSION_ADHERENCE_MIN = 0.70
SOFTEN_ABOVE_WEEKS = 12
VO2_DISAGREEMENT = 0.05
VO2_MIN_TRUSTED = 35.0

# Adherence: a run within a day of the planned date counts (sessions get moved).
MATCH_TOLERANCE_DAYS = 1
MIN_PLANNED_KM = 10.0

# Risk.
READINESS_WINDOW_DAYS = 7
READINESS_MIN_DAYS = 3
READINESS_DROP_POINTS = 8.0
READINESS_LOW_MEAN = 50.0
RAMP_MAX_PCT = 10.0
MIN_WEEKLY_KM_FOR_RAMP = 5.0
TAPER_DAYS = 21  # under this, a falling load is the taper, not a warning

RISK_LOW = "basso"
RISK_MODERATE = "moderato"
RISK_HIGH = "alto"
RISK_UNKNOWN = "sconosciuto"

SEVERITY_OK = "ok"
SEVERITY_WATCH = "attenzione"
SEVERITY_UNKNOWN = "sconosciuto"


@dataclass
class PredictionFactor:
    key: str
    label: str
    detail: str
    severity: str  # "ok" | "attenzione" | "sconosciuto"


@dataclass
class ReferenceEffort:
    activity_id: int
    date: date_type
    title: str
    distance_km: float
    duration_min: float
    pace_min_km: float
    avg_hr: int | None = None


@dataclass
class Adherence:
    sessions_planned: int
    sessions_done: int
    km_planned: float | None  # None when the planned sessions carry no distance
    km_done: float

    @property
    def session_ratio(self) -> float | None:
        return self.sessions_done / self.sessions_planned if self.sessions_planned else None

    @property
    def volume_ratio(self) -> float | None:
        if self.km_planned is None or self.km_planned < MIN_PLANNED_KM:
            return None
        return self.km_done / self.km_planned


@dataclass
class Risk:
    level: str  # "basso" | "moderato" | "alto" | "sconosciuto"
    acwr: float | None
    readiness_recent: float | None
    readiness_previous: float | None
    ramp_pct: float | None
    signals: list[PredictionFactor] = field(default_factory=list)


@dataclass
class RacePredictionResult:
    status: str  # "valutato" | "senza_tempo_obiettivo" | "dati_insufficienti"
    predicted_time_seconds: int | None
    # Set only when Riegel and VO2max disagree by more than 5%: the honest answer is the
    # range between them, and `predicted_time_seconds` is its midpoint.
    predicted_low_seconds: int | None
    predicted_high_seconds: int | None
    predicted_pace_sec_km: int | None
    prediction_basis: str | None  # "dal tuo Medio 15k del 6 settembre"
    vo2max_time_seconds: int | None
    target_time_seconds: int | None
    gap_seconds: int | None  # predicted (a range's slower end) - target: positive is slower
    gap_pct: float | None
    band: str | None
    band_label: str | None
    band_lowered: bool  # dropped one band for low session adherence
    softened: bool  # more than 12 weeks to go
    weeks_left: int
    phase: str
    headline: str
    summary: str
    adherence: Adherence
    risk: Risk
    reference_effort: ReferenceEffort | None = None
    longest_completed_km: float | None = None
    guide_longest_km: float | None = None
    factors: list[PredictionFactor] = field(default_factory=list)


# ---- formatting -----------------------------------------------------------------------


def format_duration(seconds: int | None) -> str:
    """3:22:05 for a marathon, 48:10 for a 10 km."""
    if seconds is None or seconds <= 0:
        return "—"
    h, rest = divmod(int(seconds), 3600)
    m, s = divmod(rest, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def format_pace(sec_per_km: int | None) -> str:
    if sec_per_km is None or sec_per_km <= 0:
        return "—"
    m, s = divmod(int(sec_per_km), 60)
    return f"{m}:{s:02d}/km"


_MONTHS = ("gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto",
           "settembre", "ottobre", "novembre", "dicembre")


def _num(value: float, digits: int = 1) -> str:
    """Italian decimals: 1,47 and 15,0, not 1.47."""
    return f"{value:.{digits}f}".replace(".", ",")


def _day_label(day: date_type) -> str:
    return f"{day.day} {_MONTHS[day.month - 1]}"


# ---- 1. fitness -----------------------------------------------------------------------


def calculate_riegel_time(dist_ref_km: float, time_ref_sec: float, dist_target_km: float) -> float:
    """Peter Riegel power-law projection: T2 = T1 * (D2 / D1)^1.06"""
    if dist_ref_km <= 0 or time_ref_sec <= 0 or dist_target_km <= 0:
        return 0.0
    return time_ref_sec * math.pow(dist_target_km / dist_ref_km, RIEGEL_EXPONENT)


def vdot_to_marathon_seconds(vdot: float) -> int:
    """Approximate Daniels VDOT equivalent for marathon."""
    # VDOT table approximation: VDOT 40 = ~3:58:00 (14280s), VDOT 50 = ~3:10:00 (11400s), VDOT 60 = ~2:38:00 (9480s)
    # Linear fit around standard recreational runners: seconds ~= 25700 - 286 * VDOT
    secs = round(25700.0 - 286.0 * vdot)
    return max(7200, min(21600, secs))


def vo2max_race_seconds(vo2max: float | None, distance_km: float) -> int | None:
    """What VO2max alone says about this distance: the marathon equivalent, carried to
    the race distance with the same Riegel exponent. None below a VO2max worth trusting."""
    if vo2max is None or vo2max < VO2_MIN_TRUSTED or distance_km <= 0:
        return None
    marathon = vdot_to_marathon_seconds(vo2max)
    return int(round(calculate_riegel_time(MARATHON_KM, marathon, distance_km)))


def _parse_day(value: Any) -> date_type | None:
    if isinstance(value, date_type):
        return value
    if isinstance(value, str):
        try:
            return date_type.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def _is_run(act: dict[str, Any]) -> bool:
    return "run" in str(act.get("sport") or "").lower()


def _runs(activities: Sequence[dict[str, Any]], start: date_type, end: date_type) -> list[dict[str, Any]]:
    """Running activities in [start, end] with a plausible distance and duration."""
    runs: list[dict[str, Any]] = []
    for act in activities:
        if not _is_run(act):
            continue
        day = _parse_day(act.get("day"))
        if day is None or day < start or day > end:
            continue
        dist = act.get("distance_km")
        dur = act.get("duration_min")
        if dist and dur and dist >= 1.0 and dur >= 5.0:
            runs.append({**act, "day": day})
    return runs


def _min_reference_km(target_km: float) -> float:
    if target_km >= 35.0:
        return 7.5
    if target_km >= 18.0:
        return 5.0
    return 3.0


def _best_effort(
    runs: Sequence[dict[str, Any]], target_km: float, aerobic_threshold_hr: int | None
) -> tuple[float, ReferenceEffort] | None:
    """The run that projects to the fastest race time, among those hard enough to say
    something about racing."""
    min_km = _min_reference_km(target_km)
    best: tuple[float, ReferenceEffort] | None = None
    for act in runs:
        dist = float(act.get("distance_km") or 0.0)
        dur_min = float(act.get("duration_min") or 0.0)
        if dist < min_km or dur_min <= 0:
            continue
        avg_hr = act.get("avg_hr")
        # Clearly under the aerobic threshold is an easy run: it says nothing about
        # race pace, unless it is long enough to be a race-specific long run.
        if aerobic_threshold_hr and avg_hr and avg_hr < aerobic_threshold_hr - 5 and dist < target_km * 0.6:
            continue
        projected = calculate_riegel_time(dist, dur_min * 60.0, target_km)
        if best is None or projected < best[0]:
            best = (
                projected,
                ReferenceEffort(
                    activity_id=int(act.get("activity_id") or 0),
                    date=act["day"],
                    title=str(act.get("title") or "Corsa"),
                    distance_km=round(dist, 2),
                    duration_min=round(dur_min, 1),
                    pace_min_km=round(dur_min / dist, 2),
                    avg_hr=int(avg_hr) if avg_hr else None,
                ),
            )
    return best


# ---- 2. adherence ---------------------------------------------------------------------


def assess_adherence(
    runs: Sequence[dict[str, Any]], planned: Sequence[TrainingSession], start: date_type, today: date_type
) -> Adherence:
    """Planned runs in [start, today) against the runs actually done.

    Today is left out on both sides: a session planned for this evening is not missed yet.
    Each run can satisfy one planned session, the closest one first.
    """
    planned_runs = sorted(
        (s for s in planned if s.date and start <= s.date < today and "run" in (s.sport or "").lower()),
        key=lambda s: s.date,
    )
    done = [r for r in runs if start <= r["day"] < today]
    used: set[int] = set()
    matched = 0
    for session in planned_runs:
        best_i: int | None = None
        best_gap = MATCH_TOLERANCE_DAYS + 1
        for i, run in enumerate(done):
            if i in used:
                continue
            gap = abs((run["day"] - session.date).days)
            if gap < best_gap:
                best_i, best_gap = i, gap
        if best_i is not None:
            used.add(best_i)
            matched += 1
    km_planned = sum(session_distance_km(s) for s in planned_runs)
    return Adherence(
        sessions_planned=len(planned_runs),
        sessions_done=matched,
        km_planned=round(km_planned, 1) if km_planned > 0 else None,
        km_done=round(sum(float(r.get("distance_km") or 0.0) for r in done), 1),
    )


# ---- 3. risk --------------------------------------------------------------------------


def _week_start(day: date_type) -> date_type:
    return day - timedelta(days=day.weekday())


def required_ramp_pct(
    runs: Sequence[dict[str, Any]], planned: Sequence[TrainingSession], today: date_type, race_date: date_type
) -> tuple[float | None, float | None, float | None]:
    """(weekly ramp %, current weekly km, peak planned week km).

    Current volume is the last four weeks' average; the target is the biggest week the
    plan still has before the race; the ramp is the steady weekly growth that joins the
    two. None when either end is unknown (no recent running, or sessions without steps).
    """
    recent = [r for r in runs if today - timedelta(days=28) <= r["day"] < today]
    current = sum(float(r.get("distance_km") or 0.0) for r in recent) / 4.0
    weeks: dict[date_type, float] = {}
    for s in planned:
        if s.date and today <= s.date < race_date and "run" in (s.sport or "").lower():
            weeks[_week_start(s.date)] = weeks.get(_week_start(s.date), 0.0) + session_distance_km(s)
    if not weeks or current < MIN_WEEKLY_KM_FOR_RAMP:
        return None, (round(current, 1) if current else None), None
    peak_start, peak_km = max(weeks.items(), key=lambda item: (item[1], -item[0].toordinal()))
    if peak_km <= 0:
        return None, round(current, 1), None
    if peak_km <= current:
        return 0.0, round(current, 1), round(peak_km, 1)
    n_weeks = max(1, (peak_start - _week_start(today)).days // 7)
    ramp = (math.pow(peak_km / current, 1.0 / n_weeks) - 1.0) * 100.0
    return round(ramp, 1), round(current, 1), round(peak_km, 1)


def _readiness_halves(wellness: Sequence[dict[str, Any]], today: date_type) -> tuple[float | None, float | None]:
    """Mean readiness of the last 7 days and of the 7 before, each only with enough days."""
    recent: list[float] = []
    previous: list[float] = []
    for row in wellness:
        day = _parse_day(row.get("day"))
        score = row.get("readiness_score")
        if day is None or score is None:
            continue
        age = (today - day).days
        if 0 <= age < READINESS_WINDOW_DAYS:
            recent.append(float(score))
        elif READINESS_WINDOW_DAYS <= age < 2 * READINESS_WINDOW_DAYS:
            previous.append(float(score))

    def mean(values: list[float]) -> float | None:
        return round(sum(values) / len(values), 1) if len(values) >= READINESS_MIN_DAYS else None

    return mean(recent), mean(previous)


def assess_risk(
    runs: Sequence[dict[str, Any]],
    planned: Sequence[TrainingSession],
    wellness: Sequence[dict[str, Any]],
    today: date_type,
    goal: RaceGoal,
) -> Risk:
    signals: list[PredictionFactor] = []
    days_left = days_to_race(goal, today)

    # Acute:chronic ratio of running minutes, from the runs themselves.
    daily: dict[date_type, float] = {}
    for r in runs:
        daily[r["day"]] = daily.get(r["day"], 0.0) + float(r.get("duration_min") or 0.0)
    acwr, acute, chronic = calculate_rolling_acwr(daily, today)
    if acwr is None:
        signals.append(PredictionFactor("acwr", "Carico: troppo pochi dati", "Servono almeno quattro settimane di corse per confrontare il carico recente con quello abituale.", SEVERITY_UNKNOWN))
    elif acwr > ACWR_SAFE_MAX:
        signals.append(PredictionFactor("acwr", f"Carico in salita rapida: {_num(acwr, 2)}", f"{acute:.0f} min di corsa negli ultimi 7 giorni contro {chronic:.0f} di media: oltre 1,3 il rischio di infortunio sale.", SEVERITY_WATCH))
    elif acwr < ACWR_SAFE_MIN and days_left > TAPER_DAYS:
        signals.append(PredictionFactor("acwr", f"Carico in calo: {_num(acwr, 2)}", f"{acute:.0f} min negli ultimi 7 giorni contro {chronic:.0f} di media: sotto 0,8 la forma tende a scendere.", SEVERITY_WATCH))
    else:
        detail = "scarico pre-gara, è previsto" if acwr < ACWR_SAFE_MIN else "fra 0,8 e 1,3, la zona sicura"
        signals.append(PredictionFactor("acwr", f"Carico sostenibile: {_num(acwr, 2)}", f"{acute:.0f} min negli ultimi 7 giorni contro {chronic:.0f} di media: {detail}.", SEVERITY_OK))

    # Readiness: the last week against the one before.
    recent, previous = _readiness_halves(wellness, today)
    if recent is None:
        signals.append(PredictionFactor("readiness_trend", "Prontezza: troppo pochi dati", "Servono almeno tre mattine con la prontezza Garmin negli ultimi 7 giorni.", SEVERITY_UNKNOWN))
    elif previous is not None and recent <= previous - READINESS_DROP_POINTS:
        signals.append(PredictionFactor("readiness_trend", f"Prontezza in calo: {recent:.0f} da {previous:.0f}", "Media degli ultimi 7 giorni contro i 7 prima: il recupero non sta tenendo il passo.", SEVERITY_WATCH))
    elif recent < READINESS_LOW_MEAN:
        signals.append(PredictionFactor("readiness_trend", f"Prontezza bassa: media {recent:.0f}", "Negli ultimi 7 giorni la prontezza è rimasta sotto 50.", SEVERITY_WATCH))
    else:
        trend = f", era {previous:.0f}" if previous is not None else ""
        signals.append(PredictionFactor("readiness_trend", f"Prontezza stabile: media {recent:.0f}", f"Media degli ultimi 7 giorni{trend}.", SEVERITY_OK))

    # Ramp to the plan's peak week.
    ramp, current, peak = required_ramp_pct(runs, planned, today, goal.race_date)
    if ramp is None:
        signals.append(PredictionFactor("ramp", "Crescita del volume: non calcolabile", "Servono corse recenti e sedute in programma con la distanza.", SEVERITY_UNKNOWN))
    elif ramp > RAMP_MAX_PCT:
        signals.append(PredictionFactor("ramp", f"Crescita richiesta: +{ramp:.0f}% a settimana", f"Da {current:.0f} km a settimana al picco di {peak:.0f} km: oltre il 10% a settimana è una salita ripida.", SEVERITY_WATCH))
    elif ramp > 0:
        signals.append(PredictionFactor("ramp", f"Crescita richiesta: +{ramp:.0f}% a settimana", f"Da {current:.0f} a {peak:.0f} km a settimana: nei limiti.", SEVERITY_OK))
    else:
        signals.append(PredictionFactor("ramp", "Volume di picco già raggiunto", f"Già oggi corri {current:.0f} km a settimana, la settimana più carica in programma ne ha {peak:.0f}.", SEVERITY_OK))

    flagged = sum(1 for s in signals if s.severity == SEVERITY_WATCH)
    known = sum(1 for s in signals if s.severity != SEVERITY_UNKNOWN)
    level = RISK_UNKNOWN if known == 0 else RISK_LOW if flagged == 0 else RISK_MODERATE if flagged == 1 else RISK_HIGH
    return Risk(level=level, acwr=acwr, readiness_recent=recent, readiness_previous=previous, ramp_pct=ramp, signals=signals)


# ---- the band -------------------------------------------------------------------------


def band_for_gap(gap_pct: float) -> str:
    if gap_pct <= GAP_AHEAD:
        return BAND_AHEAD
    if gap_pct <= GAP_ON_TRACK:
        return BAND_ON_TRACK
    if gap_pct <= GAP_AMBITIOUS:
        return BAND_AMBITIOUS
    return BAND_OUT_OF_REACH


def lower_band(band: str) -> str:
    return BANDS[min(len(BANDS) - 1, BANDS.index(band) + 1)]


def _summary(band: str, predicted: str, target: str, weeks: int, softened: bool) -> str:
    """The templated sentence for each band: what the screen says when the model is not
    there, and what the model is told not to contradict."""
    if softened:
        return {
            BAND_AHEAD: f"Già oggi saresti sotto il {target}: con {weeks} settimane davanti conta soprattutto non strafare.",
            BAND_ON_TRACK: f"Già oggi sei vicino al {target}: le {weeks} settimane che mancano servono a consolidare.",
            BAND_AMBITIOUS: f"Oggi saresti a {predicted}: il {target} è ambizioso, ma con {weeks} settimane davanti il quadro può cambiare.",
            BAND_OUT_OF_REACH: f"Oggi saresti a {predicted}, lontano dal {target}; mancano {weeks} settimane e il quadro può cambiare molto.",
        }[band]
    return {
        BAND_AHEAD: f"Al ritmo di oggi chiuderesti in {predicted}, sotto il {target}: c'è margine.",
        BAND_ON_TRACK: f"La previsione di {predicted} è in linea con il {target}: si tratta di confermarla.",
        BAND_AMBITIOUS: f"Oggi saresti a {predicted}: il {target} chiede ancora un passo avanti, è possibile ma non scontato.",
        BAND_OUT_OF_REACH: f"Al ritmo di oggi il {target} è lontano ({predicted}): vale la pena rivedere il tempo obiettivo o la preparazione.",
    }[band]


# ---- assessment -----------------------------------------------------------------------


def assess_race_prediction(
    activities: Sequence[dict[str, Any]],
    goal: RaceGoal,
    planned_sessions: Sequence[TrainingSession] = (),
    today: date_type | None = None,
    vo2max: float | None = None,
    aerobic_threshold_hr: int | None = None,
    wellness: Sequence[dict[str, Any]] = (),
) -> RacePredictionResult:
    now = today or date_type.today()
    target_km = float(goal.distance_km)
    runs = _runs(activities, now - timedelta(days=LOOKBACK_DAYS_PERFORMANCE), now)

    adherence = assess_adherence(runs, planned_sessions, now - timedelta(days=LOOKBACK_DAYS_ADHERENCE), now)
    risk = assess_risk(runs, planned_sessions, wellness, now, goal)
    # Rounded like the app's countdown ("fra 8 settimane"), so the two never disagree.
    weeks_left = max(0, round(days_to_race(goal, now) / 7))
    phase = race_phase(goal, now)
    softened = weeks_left > SOFTEN_ABOVE_WEEKS

    longest = max((float(r.get("distance_km") or 0.0) for r in runs), default=0.0)
    guide_longest = _longest_run_guide(target_km) or target_km * 0.75
    factors: list[PredictionFactor] = [_longest_run_factor(longest, guide_longest, target_km)]
    vo2_time = vo2max_race_seconds(vo2max, target_km)
    target = goal.target_time_seconds

    best = _best_effort(runs, target_km, aerobic_threshold_hr)
    if best is None:
        factors.insert(0, PredictionFactor(
            "no_efforts",
            "Nessuna prestazione recente su cui basarmi",
            f"Nelle ultime 8 settimane non c'è una corsa di almeno {_min_reference_km(target_km):g} km a ritmo sostenuto: "
            "proiettare il tempo gara da una corsa facile darebbe un numero senza senso.",
            SEVERITY_WATCH,
        ))
        summary = "Un medio o una gara di prova mi danno il riferimento che manca per stimare il tempo gara."
        if vo2_time:
            summary += f" Dal solo VO₂max la stima sarebbe {format_duration(vo2_time)}, ma è un'indicazione debole."
        return RacePredictionResult(
            status=STATUS_NO_DATA,
            predicted_time_seconds=None,
            predicted_low_seconds=None,
            predicted_high_seconds=None,
            predicted_pace_sec_km=None,
            prediction_basis=None,
            vo2max_time_seconds=vo2_time,
            target_time_seconds=target,
            gap_seconds=None,
            gap_pct=None,
            band=None,
            band_label=None,
            band_lowered=False,
            softened=softened,
            weeks_left=weeks_left,
            phase=phase,
            headline="Non ho una prestazione recente su cui basarmi",
            summary=summary,
            adherence=adherence,
            risk=risk,
            reference_effort=None,
            longest_completed_km=round(longest, 1) if longest > 0 else None,
            guide_longest_km=round(guide_longest, 1),
            factors=factors,
        )

    riegel_sec, ref = best
    riegel = int(round(riegel_sec))
    low = high = None
    predicted = riegel
    if vo2_time:
        if abs(riegel - vo2_time) / riegel > VO2_DISAGREEMENT:
            low, high = min(riegel, vo2_time), max(riegel, vo2_time)
            predicted = (low + high) // 2
            factors.insert(0, PredictionFactor(
                "vo2max",
                "Corse e VO₂max non concordano",
                f"Dalle corse {format_duration(riegel)}, dal VO₂max {vo2max:.0f} {format_duration(vo2_time)}: "
                "mostro l'intervallo invece di sceglierne uno.",
                SEVERITY_WATCH,
            ))
        else:
            factors.insert(0, PredictionFactor(
                "vo2max",
                "Corse e VO₂max concordano",
                f"Il VO₂max {vo2max:.0f} indica {format_duration(vo2_time)}, entro il 5% dalla stima delle corse.",
                SEVERITY_OK,
            ))
    basis = f"dal tuo {ref.title} del {_day_label(ref.date)}"
    factors.insert(0, PredictionFactor(
        "reference_run",
        f"{_num(ref.distance_km)} km a {format_pace(int(round(ref.pace_min_km * 60)))}",
        f"{ref.title} del {_day_label(ref.date)}: la prestazione recente che proietta il tempo gara migliore.",
        SEVERITY_OK,
    ))

    predicted_text = (
        f"{format_duration(low)}–{format_duration(high)}" if low is not None and high is not None else format_duration(predicted)
    )
    gap_seconds = gap_pct = None
    band = band_label = None
    lowered = False
    if target:
        # A range is judged on its slower end: one that straddles the target is not
        # "ahead", and reading the optimistic half would be picking a winner after all.
        gap_seconds = (high if high is not None else predicted) - target
        gap_pct = round(gap_seconds / target, 4)
        band = band_for_gap(gap_pct)
        ratio = adherence.session_ratio
        if ratio is not None and ratio < SESSION_ADHERENCE_MIN and band != BAND_OUT_OF_REACH:
            band = lower_band(band)
            lowered = True
        band_label = BAND_LABEL[band]
        summary = _summary(band, predicted_text, f"tuo obiettivo di {format_duration(target)}", weeks_left, softened)
        if lowered:
            summary += f" Ho abbassato il giudizio di un gradino: delle ultime {adherence.sessions_planned} sedute ne hai fatte {adherence.sessions_done}."
        status = STATUS_ASSESSED
        headline = band_label
    else:
        status = STATUS_NO_TARGET
        headline = f"Previsione: {predicted_text}"
        summary = f"Oggi chiuderesti in {predicted_text}. Senza un tempo obiettivo non c'è un giudizio: guarda costanza e rischio."

    return RacePredictionResult(
        status=status,
        predicted_time_seconds=predicted,
        predicted_low_seconds=low,
        predicted_high_seconds=high,
        predicted_pace_sec_km=int(round(predicted / target_km)),
        prediction_basis=basis,
        vo2max_time_seconds=vo2_time,
        target_time_seconds=target,
        gap_seconds=gap_seconds,
        gap_pct=gap_pct,
        band=band,
        band_label=band_label,
        band_lowered=lowered,
        softened=softened,
        weeks_left=weeks_left,
        phase=phase,
        headline=headline,
        summary=summary,
        adherence=adherence,
        risk=risk,
        reference_effort=ref,
        longest_completed_km=round(longest, 1) if longest > 0 else None,
        guide_longest_km=round(guide_longest, 1),
        factors=factors,
    )


def _longest_run_factor(longest: float, guide: float, target_km: float) -> PredictionFactor:
    if longest <= 0:
        return PredictionFactor("longest_run", "Nessun lungo nelle ultime 8 settimane", f"Per {target_km:.0f} km si arriva ad almeno {guide:.0f} km.", SEVERITY_WATCH)
    ratio = longest / guide if guide > 0 else 1.0
    if ratio >= 0.9:
        return PredictionFactor("longest_run", f"Lungo più lungo: {_num(longest)} km", f"Oltre il 90% dei {guide:.0f} km che servono per questa distanza.", SEVERITY_OK)
    return PredictionFactor("longest_run", f"Lungo più lungo: {_num(longest)} km", f"Per {target_km:.0f} km si arriva ad almeno {guide:.0f} km.", SEVERITY_WATCH)


def prediction_facts(res: RacePredictionResult, goal: RaceGoal) -> dict:
    """What the model is told -- already decided, nothing raw, nothing personal."""
    facts: dict[str, Any] = {
        "gara": goal.name or f"{goal.distance_km:g} km",
        "settimane_alla_gara": res.weeks_left,
        "fase": res.phase,
        "stato": res.status,
        "frase_di_riferimento": res.summary,
    }
    if res.predicted_time_seconds:
        facts["previsto"] = (
            f"{format_duration(res.predicted_low_seconds)}–{format_duration(res.predicted_high_seconds)}"
            if res.predicted_low_seconds and res.predicted_high_seconds
            else format_duration(res.predicted_time_seconds)
        )
        facts["base_della_previsione"] = res.prediction_basis
    if res.target_time_seconds:
        facts["obiettivo"] = format_duration(res.target_time_seconds)
    if res.band:
        facts["fascia"] = res.band_label
        facts["fascia_abbassata_per_costanza"] = res.band_lowered
    if res.adherence.session_ratio is not None:
        facts["sedute_fatte"] = f"{res.adherence.sessions_done} su {res.adherence.sessions_planned}"
    if res.adherence.volume_ratio is not None:
        facts["km_fatti_su_previsti"] = f"{res.adherence.km_done:.0f} su {res.adherence.km_planned:.0f}"
    facts["rischio"] = res.risk.level
    facts["segnali_di_rischio"] = [s.label for s in res.risk.signals if s.severity == SEVERITY_WATCH]
    facts["tono"] = "morbido: mancano molte settimane, il quadro può cambiare" if res.softened else "diretto"
    return facts
