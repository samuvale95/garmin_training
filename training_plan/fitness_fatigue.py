"""Fitness, Fatigue and Form (CTL, ATL, TSB) model.

Implements the continuous exponential impulse-response model (Banister / Coggan):
- CTL (Chronic Training Load / Fitness): rolling exponential moving average with tau = 42 days.
- ATL (Acute Training Load / Fatigue): rolling exponential moving average with tau = 7 days.
- TSB (Training Stress Balance / Form): TSB = CTL - ATL.

Also computes forward projections through planned workouts to evaluate tapering into a target race.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date as date_type, timedelta
from typing import Any, Sequence

from .models import RaceGoal, TrainingSession, session_duration_minutes

TAU_CTL = 42.0
TAU_ATL = 7.0

ALPHA_CTL = 1.0 - math.exp(-1.0 / TAU_CTL)
ALPHA_ATL = 1.0 - math.exp(-1.0 / TAU_ATL)

# Form state thresholds based on scientific and coaching consensus
TSB_OVERREACHING = -25.0
TSB_OPTIMAL_MIN = -25.0
TSB_OPTIMAL_MAX = -10.0
TSB_NEUTRAL_MIN = -10.0
TSB_NEUTRAL_MAX = 5.0
TSB_FRESHNESS_MIN = 5.0
TSB_FRESHNESS_MAX = 20.0

STATUS_OVERREACHING = "molto_affaticato"
STATUS_OPTIMAL = "ottimale"
STATUS_NEUTRAL = "neutro"
STATUS_FRESHNESS = "freschezza"
STATUS_DETRAINING = "scarico_eccessivo"


@dataclass(frozen=True)
class FormStatus:
    key: str
    label: str
    caption: str
    color: str  # CSS color / token


FORM_STATUS_MAP: dict[str, FormStatus] = {
    STATUS_OVERREACHING: FormStatus(
        key=STATUS_OVERREACHING,
        label="Fatica Elevata (Rischio Overreaching)",
        caption="La fatica acuta supera di molto la fitness. Rischio di infortuni o sovrallenamento se prolungato: consigliato alleggerire.",
        color="#dc2626",
    ),
    STATUS_OPTIMAL: FormStatus(
        key=STATUS_OPTIMAL,
        label="Costruzione Ottimale",
        caption="Zona ideale di carico produttivo. Stimolo allenante elevato con adattamento aerobico in crescita.",
        color="var(--verde)",
    ),
    STATUS_NEUTRAL: FormStatus(
        key=STATUS_NEUTRAL,
        label="Mantenimento / Neutro",
        caption="Equilibrio tra carico recente e cronico. La forma è costante, ideale nelle settimane di consolidamento.",
        color="var(--azzurro)",
    ),
    STATUS_FRESHNESS: FormStatus(
        key=STATUS_FRESHNESS,
        label="Freschezza / Picco Gara",
        caption="La fatica è dissipata e la fitness è preservata. È la condizione ottimale per il giorno della gara (tapering riuscito).",
        color="#059669",
    ),
    STATUS_DETRAINING: FormStatus(
        key=STATUS_DETRAINING,
        label="Transizione / Scarico Eccessivo",
        caption="Carico molto basso per più settimane: la fatica è azzerata ma inizia la perdita di adattamenti cardiocircolatori.",
        color="#78716c",
    ),
}


def classify_tsb(tsb: float) -> FormStatus:
    """Classify TSB into one of the 5 physiological categories."""
    if tsb < TSB_OVERREACHING:
        return FORM_STATUS_MAP[STATUS_OVERREACHING]
    if tsb <= TSB_OPTIMAL_MAX:
        return FORM_STATUS_MAP[STATUS_OPTIMAL]
    if tsb <= TSB_NEUTRAL_MAX:
        return FORM_STATUS_MAP[STATUS_NEUTRAL]
    if tsb <= TSB_FRESHNESS_MAX:
        return FORM_STATUS_MAP[STATUS_FRESHNESS]
    return FORM_STATUS_MAP[STATUS_DETRAINING]


def calculate_activity_load(
    activity: dict[str, Any],
    resting_hr: int = 48,
    max_hr: int = 185,
) -> float:
    """Estimate training load (TSS equivalent) for a completed activity."""
    summary = activity.get("summary") or {}
    if isinstance(summary, dict):
        # Native Garmin training load
        garmin_load = summary.get("trainingLoad") or summary.get("activityTrainingLoad")
        if isinstance(garmin_load, (int, float)) and garmin_load > 0:
            return float(garmin_load)

        # Strava suffer score
        suffer = summary.get("suffer_score")
        if isinstance(suffer, (int, float)) and suffer > 0:
            return float(suffer)

    duration_min = activity.get("duration_min")
    if not duration_min or duration_min <= 0:
        return 0.0

    avg_hr = activity.get("avg_hr")
    act_max_hr = activity.get("max_hr") or max_hr

    if avg_hr and avg_hr > resting_hr:
        # Banister TRIMP calculation
        hr_range = max(act_max_hr - resting_hr, 30)
        delta_hr = max(0.1, min(1.0, (avg_hr - resting_hr) / hr_range))
        trimp = duration_min * delta_hr * 0.64 * math.exp(1.92 * delta_hr)
        # Scale to TSS equivalent: 60 min at delta_hr 0.85 = ~100 TSS
        return round(trimp * 0.6, 1)

    # Fallback to duration and distance/pace proxy
    dist_km = activity.get("distance_km")
    sport = (activity.get("sport") or "running").lower()

    if "cycling" in sport or "ride" in sport:
        rate_per_hour = 40.0
    elif dist_km and duration_min > 0:
        pace_min_km = duration_min / dist_km
        if pace_min_km < 4.5:
            rate_per_hour = 75.0
        elif pace_min_km < 5.5:
            rate_per_hour = 60.0
        else:
            rate_per_hour = 48.0
    else:
        rate_per_hour = 50.0

    return round((duration_min / 60.0) * rate_per_hour, 1)


def calculate_session_load(session: TrainingSession | None) -> float:
    """Calculate expected training load for a planned workout."""
    if session is None or session.sport == "rest":
        return 0.0

    minutes = session_duration_minutes(session)
    if minutes <= 0:
        # Estimate from distance if steps have distance
        steps = session.steps or []
        total_km = 0.0
        for s in steps:
            if getattr(s, "duration_type", None) == "distance" and getattr(s, "duration_value", None):
                total_km += float(s.duration_value)
        if total_km > 0:
            minutes = round(total_km * 5.0)  # assume 5:00/km
        else:
            minutes = 45

    title = (session.title or "").lower()
    if "lungo" in title or minutes >= 80:
        rate_per_hour = 65.0
    elif "ripetute" in title or "tempo" in title or "intervall" in title:
        rate_per_hour = 75.0
    elif "recupero" in title or "facile" in title or "rigenerante" in title:
        rate_per_hour = 45.0
    else:
        rate_per_hour = 55.0

    return round((minutes / 60.0) * rate_per_hour, 1)


@dataclass
class DailyMetrics:
    date: date_type
    ctl: float  # Fitness
    atl: float  # Fatigue
    tsb: float  # Form
    load: float  # Total training load for this day
    status: FormStatus
    is_projection: bool = False


@dataclass
class RaceTaperingAssessment:
    race_date: date_type
    race_name: str
    days_to_race: int
    projected_ctl: float
    projected_atl: float
    projected_tsb: float
    status: FormStatus
    verdict: str
    advice: str


@dataclass
class FitnessFatigueResult:
    current: DailyMetrics
    history: list[DailyMetrics]
    projection: list[DailyMetrics]
    race_assessment: RaceTaperingAssessment | None = None


def compute_fitness_fatigue_timeline(
    activities: Sequence[dict[str, Any]],
    planned_sessions: Sequence[TrainingSession] = (),
    goal: RaceGoal | None = None,
    today: date_type | None = None,
    lookback_days: int = 60,
    resting_hr: int = 48,
    max_hr: int = 185,
) -> FitnessFatigueResult:
    """Compute daily CTL, ATL, TSB across history and forward race projection."""
    now = today or date_type.today()
    start_date = now - timedelta(days=lookback_days)

    # 1. Aggregate past activities by date
    daily_past_load: dict[date_type, float] = {}
    for act in activities:
        act_day = act.get("day")
        if isinstance(act_day, str):
            act_day = date_type.fromisoformat(act_day)
        if not act_day:
            continue
        load = calculate_activity_load(act, resting_hr=resting_hr, max_hr=max_hr)
        daily_past_load[act_day] = round(daily_past_load.get(act_day, 0.0) + load, 1)

    # 2. Aggregate future planned sessions by date
    daily_planned_load: dict[date_type, float] = {}
    for session in planned_sessions:
        if session.date:
            load = calculate_session_load(session)
            daily_planned_load[session.date] = round(
                daily_planned_load.get(session.date, 0.0) + load, 1
            )

    # Determine end date for projection
    end_date = now + timedelta(days=14)
    if goal and goal.race_date > now:
        end_date = max(end_date, goal.race_date)

    # 3. Seed initialization: average of early days to avoid cold start at 0
    early_loads = [
        daily_past_load.get(start_date + timedelta(days=i), 0.0)
        for i in range(min(14, lookback_days))
    ]
    seed_val = sum(early_loads) / max(len(early_loads), 1) if early_loads else 30.0
    ctl = max(20.0, seed_val)
    atl = max(20.0, seed_val)

    history_points: list[DailyMetrics] = []
    projection_points: list[DailyMetrics] = []

    curr_date = start_date
    current_metrics: DailyMetrics | None = None

    while curr_date <= end_date:
        is_future = curr_date > now

        if is_future:
            day_load = daily_planned_load.get(curr_date, 0.0)
        else:
            # If today has past activities use them; if empty check if today has a planned session
            day_load = daily_past_load.get(curr_date, 0.0)

        # Exponential decay step
        ctl = ctl + ALPHA_CTL * (day_load - ctl)
        atl = atl + ALPHA_ATL * (day_load - atl)
        tsb = ctl - atl

        metrics = DailyMetrics(
            date=curr_date,
            ctl=round(ctl, 1),
            atl=round(atl, 1),
            tsb=round(tsb, 1),
            load=round(day_load, 1),
            status=classify_tsb(tsb),
            is_projection=is_future,
        )

        if curr_date <= now:
            history_points.append(metrics)
            if curr_date == now:
                current_metrics = metrics
        else:
            projection_points.append(metrics)

        curr_date += timedelta(days=1)

    if current_metrics is None:
        current_metrics = history_points[-1] if history_points else DailyMetrics(
            date=now, ctl=round(ctl, 1), atl=round(atl, 1), tsb=round(tsb, 1),
            load=0.0, status=classify_tsb(tsb)
        )

    # 4. Assess race tapering if goal is set
    race_assessment: RaceTaperingAssessment | None = None
    if goal and goal.race_date >= now:
        race_pt = next((p for p in projection_points if p.date == goal.race_date), None)
        if race_pt is None and current_metrics.date == goal.race_date:
            race_pt = current_metrics

        if race_pt:
            proj_tsb = race_pt.tsb
            days_out = (goal.race_date - now).days

            if proj_tsb < 0:
                verdict = "Tapering Insufficiente"
                advice = (
                    f"Il giorno della gara ({goal.name or 'Gara'}) il TSB stimato è {proj_tsb:+.0f}. "
                    "Arriveresti con troppa fatica residua nelle gambe. "
                    "Riduci il volume delle ultime 2 settimane prima del via."
                )
            elif proj_tsb < TSB_FRESHNESS_MIN:
                verdict = "Freschezza Moderata"
                advice = (
                    f"Il TSB stimato alla partenza è {proj_tsb:+.0f}. "
                    "Buono, ma puoi ottenere maggiore reattività inserendo un paio di giorni di scarico più marcato nella settimana finale."
                )
            elif proj_tsb <= TSB_FRESHNESS_MAX:
                verdict = "Picco di Freschezza Ottimale"
                advice = (
                    f"Tapering perfettamente calibrato: TSB al via stimato a {proj_tsb:+.0f}. "
                    "La fatica acuta sarà smaltita conservando oltre il 95% della fitness costruita."
                )
            else:
                verdict = "Rischio Scarico Eccessivo"
                advice = (
                    f"TSB stimato molto alto per {goal.name or 'la gara'} ({proj_tsb:+.0f}). "
                    "Attenzione a non deallenarti nelle ultime 3 settimane: mantieni richiami brevi a ritmo gara."
                )

            race_assessment = RaceTaperingAssessment(
                race_date=goal.race_date,
                race_name=goal.name or "Gara Obiettivo",
                days_to_race=days_out,
                projected_ctl=race_pt.ctl,
                projected_atl=race_pt.atl,
                projected_tsb=race_pt.tsb,
                status=race_pt.status,
                verdict=verdict,
                advice=advice,
            )

    return FitnessFatigueResult(
        current=current_metrics,
        history=history_points,
        projection=projection_points,
        race_assessment=race_assessment,
    )
