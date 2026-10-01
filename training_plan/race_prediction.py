"""Dynamic race prediction and goal confidence model.

Implements deterministic race performance estimation and honest readiness evaluation:
- Peter Riegel formula: T2 = T1 * (D2 / D1)^1.06 from the best quality effort in the last 8 weeks.
- Optional cross-check against Garmin VO2max (Jack Daniels equivalent).
- Honest failure mode: if only easy/recovery runs are recorded, says so clearly rather than inventing a number.
- Goal confidence assessment based on:
  1. Performance gap (predicted time vs target time)
  2. Longest completed long run in the last 8 weeks vs recommended guide
  3. Workload adherence over the last 42 days (completed km vs planned km)
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date as date_type, timedelta
from typing import Any, Sequence

from . import history, plan_store
from .goal_fit import LONGEST_RUN_GUIDE, _longest_run_guide
from .intensity import RUNNING_SPORTS
from .models import RaceGoal, TrainingSession, days_to_race, session_distance_km

RIEGEL_EXPONENT = 1.06
LOOKBACK_DAYS_PERFORMANCE = 56  # 8 weeks
LOOKBACK_DAYS_ADHERENCE = 42   # 6 weeks

CONFIDENCE_HIGH = "alta"
CONFIDENCE_MEDIUM = "media"
CONFIDENCE_CAUTIOUS = "cauta"
CONFIDENCE_UNKNOWN = "non_valutabile"


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
class RacePredictionResult:
    predicted_time_seconds: int | None
    predicted_pace_sec_km: int | None
    target_time_seconds: int | None
    gap_seconds: int | None
    confidence: str  # "alta" | "media" | "cauta" | "non_valutabile"
    confidence_score: int  # 0 to 100
    confidence_label: str
    confidence_color: str
    headline: str
    verdict: str
    advice: str
    reference_effort: ReferenceEffort | None = None
    longest_completed_km: float | None = None
    guide_longest_km: float | None = None
    volume_adherence_pct: float | None = None
    factors: list[PredictionFactor] = field(default_factory=list)


def format_duration(seconds: int | None) -> str:
    if seconds is None or seconds <= 0:
        return "—"
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    if h > 0:
        return f"{h}h {m:02d}m {s:02d}s"
    return f"{m}m {s:02d}s"


def format_pace(sec_per_km: int | None) -> str:
    if sec_per_km is None or sec_per_km <= 0:
        return "—"
    m = sec_per_km // 60
    s = sec_per_km % 60
    return f"{m}:{s:02d}/km"


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


def assess_race_prediction(
    activities: Sequence[dict[str, Any]],
    goal: RaceGoal,
    planned_sessions: Sequence[TrainingSession] = (),
    today: date_type | None = None,
    vo2max: float | None = None,
    aerobic_threshold_hr: int | None = None,
) -> RacePredictionResult:
    """Assess dynamic race prediction and goal confidence from actual executed data."""
    now = today or date_type.today()
    perf_start = now - timedelta(days=LOOKBACK_DAYS_PERFORMANCE)
    adh_start = now - timedelta(days=LOOKBACK_DAYS_ADHERENCE)
    target_dist = float(goal.distance_km)

    # 1. Filter running activities in the last 8 weeks
    recent_runs: list[dict[str, Any]] = []
    for act in activities:
        sport = str(act.get("sport") or "").lower()
        if not any(r.lower() in sport for r in ("run", "running")):
            continue
        act_day = act.get("day")
        if isinstance(act_day, str):
            act_day = date_type.fromisoformat(act_day)
        if not act_day or act_day < perf_start or act_day > now:
            continue
        dist = act.get("distance_km")
        dur_min = act.get("duration_min")
        if dist and dur_min and dist >= 1.0 and dur_min >= 5.0:
            recent_runs.append({**act, "day": act_day})

    # 2. Find longest completed run in the last 8 weeks
    longest_completed = max((act.get("distance_km") or 0.0 for act in recent_runs), default=0.0)
    guide_longest = _longest_run_guide(target_dist) or (target_dist * 0.75)

    # 3. Adherence over last 42 days (km executed vs km planned)
    runs_42d = [r for r in recent_runs if r["day"] >= adh_start]
    km_executed_42d = sum(float(r.get("distance_km") or 0.0) for r in runs_42d)

    planned_42d = [
        s for s in planned_sessions
        if s.date and adh_start <= s.date <= now and s.sport in ("running", "run")
    ]
    km_planned_42d = sum(session_distance_km(s) for s in planned_42d)
    
    adherence_pct: float | None = None
    if km_planned_42d > 10.0:
        adherence_pct = round(min(150.0, (km_executed_42d / km_planned_42d) * 100.0), 1)

    # 4. Search for the best reference effort (highest quality / Riegel equivalent)
    # Minimum distance required depends on race distance:
    # - 5k/10k race -> min 3k effort
    # - Half marathon -> min 5k effort
    # - Marathon -> min 8k effort
    if target_dist >= 35.0:
        min_ref_dist = 7.5
    elif target_dist >= 18.0:
        min_ref_dist = 5.0
    else:
        min_ref_dist = 3.0

    candidate_efforts: list[tuple[float, ReferenceEffort]] = []
    
    for act in recent_runs:
        dist = float(act.get("distance_km") or 0.0)
        dur_min = float(act.get("duration_min") or 0.0)
        if dist < min_ref_dist or dur_min <= 0:
            continue

        # If aerobic threshold is known, check if this run was hard enough
        avg_hr = act.get("avg_hr")
        if aerobic_threshold_hr and avg_hr and avg_hr < (aerobic_threshold_hr - 5):
            # purely easy recovery run: discount unless it's very long
            if dist < target_dist * 0.6:
                continue

        dur_sec = dur_min * 60.0
        projected_sec = calculate_riegel_time(dist, dur_sec, target_dist)
        
        pace_min_km = dur_min / dist
        ref = ReferenceEffort(
            activity_id=int(act.get("activity_id") or 0),
            date=act["day"],
            title=str(act.get("title") or "Corsa"),
            distance_km=round(dist, 2),
            duration_min=round(dur_min, 1),
            pace_min_km=round(pace_min_km, 2),
            avg_hr=int(avg_hr) if avg_hr else None,
        )
        candidate_efforts.append((projected_sec, ref))

    factors: list[PredictionFactor] = []

    # 5. Honest failure mode: No qualifying quality efforts in last 8 weeks
    if not candidate_efforts:
        factors.append(
            PredictionFactor(
                key="no_efforts",
                label="Nessun test di qualità recente",
                detail=(
                    f"Nelle ultime 8 settimane non ci sono corse veloci di almeno {min_ref_dist:.1f} km "
                    "su cui basare una stima affidabile del ritmo gara."
                ),
                severity="attenzione",
            )
        )
        if longest_completed > 0:
            factors.append(
                PredictionFactor(
                    key="longest_run",
                    label=f"Lungo massimo completato: {longest_completed:.1f} km",
                    detail=f"Per questa distanza la guida consiglia almeno {guide_longest:.0f} km.",
                    severity="ok" if longest_completed >= guide_longest * 0.85 else "attenzione",
                )
            )

        return RacePredictionResult(
            predicted_time_seconds=None,
            predicted_pace_sec_km=None,
            target_time_seconds=goal.target_time_seconds,
            gap_seconds=None,
            confidence=CONFIDENCE_UNKNOWN,
            confidence_score=20,
            confidence_label="Non Valutabile",
            confidence_color="#78716c",
            headline="Dati insufficienti per una stima onesta",
            verdict="Mancano sforzi ad alta intensità recenti.",
            advice="Fai una seduta di medio o una gara di prova (es. 10k o mezza) per calibrare la proiezione cronometrica.",
            reference_effort=None,
            longest_completed_km=round(longest_completed, 1) if longest_completed > 0 else None,
            guide_longest_km=round(guide_longest, 1),
            volume_adherence_pct=adherence_pct,
            factors=factors,
        )

    # Sort candidates by fastest predicted race time
    candidate_efforts.sort(key=lambda x: x[0])
    best_pred_sec, best_ref = candidate_efforts[0]
    predicted_time = int(round(best_pred_sec))
    predicted_pace = int(round(predicted_time / target_dist))

    # Cross-check with VO2max if provided
    if vo2max and vo2max >= 35.0 and target_dist >= 40.0:
        vo2_pred = vdot_to_marathon_seconds(vo2max)
        diff_pct = abs(predicted_time - vo2_pred) / predicted_time
        if diff_pct <= 0.05:
            factors.append(
                PredictionFactor(
                    key="vo2max_alignment",
                    label="Allineato con VO₂max Garmin",
                    detail=f"La stima Riegel ({format_duration(predicted_time)}) concorda con il tuo VO₂max {vo2max:.0f}.",
                    severity="ok",
                )
            )
        else:
            factors.append(
                PredictionFactor(
                    key="vo2max_divergence",
                    label="Scostamento rispetto a VO₂max",
                    detail=f"La stima dalle corse ({format_duration(predicted_time)}) differisce dalla capacità cardiaca pura ({format_duration(vo2_pred)}).",
                    severity="attenzione",
                )
            )

    # Reference effort factor
    factors.append(
        PredictionFactor(
            key="reference_run",
            label=f"Miglior prestazione recente: {best_ref.distance_km:.1f} km a {format_pace(int(best_ref.pace_min_km * 60))}",
            detail=f"{best_ref.title} del {best_ref.date.strftime('%d/%m')}, durata {best_ref.duration_min:.0f} min.",
            severity="ok",
        )
    )

    # Longest run factor
    longest_ratio = (longest_completed / guide_longest) if guide_longest > 0 else 1.0
    if longest_ratio >= 0.90:
        factors.append(
            PredictionFactor(
                key="longest_run",
                label=f"Lungo solido: {longest_completed:.1f} km completati",
                detail=f"Supera il 90% della distanza consigliata ({guide_longest:.0f} km). Base specifica presente.",
                severity="ok",
            )
        )
    elif longest_ratio >= 0.75:
        factors.append(
            PredictionFactor(
                key="longest_run",
                label=f"Lungo moderato: {longest_completed:.1f} km completati",
                detail=f"Consigliato raggiungere almeno {guide_longest:.0f} km per completare l'adattamento metabolico.",
                severity="attenzione",
            )
        )
    else:
        factors.append(
            PredictionFactor(
                key="longest_run",
                label=f"Lungo insufficiente: {longest_completed:.1f} km",
                detail=f"Troppo distante dai {guide_longest:.0f} km consigliati per una gara di {target_dist:.0f} km.",
                severity="attenzione",
            )
        )

    # Adherence factor
    if adherence_pct is not None:
        if adherence_pct >= 85.0:
            factors.append(
                PredictionFactor(
                    key="volume_adherence",
                    label=f"Aderenza volume ottima: {adherence_pct:.0f}%",
                    detail=f"{km_executed_42d:.0f} km percorsi su {km_planned_42d:.0f} km previsti nelle ultime 6 settimane.",
                    severity="ok",
                )
            )
        elif adherence_pct >= 70.0:
            factors.append(
                PredictionFactor(
                    key="volume_adherence",
                    label=f"Aderenza volume discreta: {adherence_pct:.0f}%",
                    detail=f"Qualche seduta saltata ({km_executed_42d:.0f}/{km_planned_42d:.0f} km nelle ultime 6 settimane).",
                    severity="attenzione",
                )
            )
        else:
            factors.append(
                PredictionFactor(
                    key="volume_adherence",
                    label=f"Aderenza volume bassa: {adherence_pct:.0f}%",
                    detail=f"Meno del 70% del chilometraggio pianificato ({km_executed_42d:.0f}/{km_planned_42d:.0f} km).",
                    severity="attenzione",
                )
            )

    # Target comparison and Gap
    gap_seconds: int | None = None
    target_time = goal.target_time_seconds
    if target_time:
        # gap > 0 means predicted is faster than target (surplus)
        # gap < 0 means predicted is slower than target (deficit)
        gap_seconds = target_time - predicted_time

    # Score calculation (0 - 100)
    score = 65  # baseline
    if longest_ratio >= 0.90:
        score += 15
    elif longest_ratio < 0.75:
        score -= 20

    if adherence_pct is not None:
        if adherence_pct >= 85.0:
            score += 15
        elif adherence_pct < 70.0:
            score -= 15

    if gap_seconds is not None:
        if gap_seconds >= 0:
            score += 10
        elif gap_seconds < -600:  # > 10 min slower
            score -= 15

    score = max(10, min(95, score))

    if score >= 80:
        confidence = CONFIDENCE_HIGH
        label = "Confidenza Alta"
        color = "#059669"
        headline = f"In piena linea per {format_duration(predicted_time)}"
        verdict = "Preparazione solida sia sui ritmi che sulla tenuta dei lunghi."
        advice = "Concentrati su rifinitura, recupero e strategia di alimentazione in gara."
    elif score >= 60:
        confidence = CONFIDENCE_MEDIUM
        label = "Confidenza Media"
        color = "var(--azzurro)"
        headline = f"Potenziale stimato a {format_duration(predicted_time)}"
        verdict = "Il motore c'è, ma serve confermare la tenuta con un chilometraggio costante."
        advice = "Mantieni i ritmi pianificati e non forzare nei giorni facili per non accumulare stanchezza."
    else:
        confidence = CONFIDENCE_CAUTIOUS
        label = "Confidenza Cauta"
        color = "#ea580c"
        headline = f"Stima prudente a {format_duration(predicted_time)}"
        verdict = "Il volume o i lunghi recenti indicano prudenza rispetto all'obiettivo."
        advice = "Valuta un ritmo di partenza più conservativo per evitare cali drastici nel finale."

    return RacePredictionResult(
        predicted_time_seconds=predicted_time,
        predicted_pace_sec_km=predicted_pace,
        target_time_seconds=target_time,
        gap_seconds=gap_seconds,
        confidence=confidence,
        confidence_score=score,
        confidence_label=label,
        confidence_color=color,
        headline=headline,
        verdict=verdict,
        advice=advice,
        reference_effort=best_ref,
        longest_completed_km=round(longest_completed, 1) if longest_completed > 0 else None,
        guide_longest_km=round(guide_longest, 1),
        volume_adherence_pct=adherence_pct,
        factors=factors,
    )
