"""Automatic recalibration of heart rate and pace training zones.

Estimates Lactate Threshold Heart Rate (LTHR) and Threshold Pace from actual performance
efforts in running history (sustained 20-30 min efforts, tempo runs, and races).

Calculates a full 5-zone model (both HR and pace ranges) and compares against the current
Garmin or baseline estimate, recommending recalibration when performance has shifted.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date as date_type, timedelta
from typing import Any, Sequence

from . import history, paces
from .hr_cleaning import clean_heart_rate_stream
from .intensity import RUNNING_SPORTS, Zones

LOOKBACK_DAYS_ZONES = 70  # ~10 weeks to detect sustained threshold efforts
MIN_EFFORT_SECONDS = 1200  # 20 minutes minimum for sustained threshold estimation


@dataclass
class ZoneBoundary:
    zone_number: int
    name: str
    hr_min: int
    hr_max: int
    pace_min_sec: int  # faster pace (fewer seconds/km)
    pace_max_sec: int  # slower pace (more seconds/km)
    hr_range_formatted: str
    pace_range_formatted: str
    description: str


@dataclass
class SupportingWorkout:
    activity_id: int
    date: date_type
    title: str
    distance_km: float
    duration_min: float
    avg_hr: int
    avg_pace_sec_km: int
    avg_pace_formatted: str
    effort_type: str  # e.g. "Gara / Test 20-30 min", "Medio sostenuto", "Fondo veloce"


@dataclass
class ZoneRecalibrationResult:
    status: str  # "ricalibrazione_consigliata" | "migliorato" | "allineato" | "dati_insufficienti"
    status_label: str
    status_color: str
    headline: str
    summary: str
    advice: str
    
    # Threshold values
    current_lthr: int | None
    estimated_lthr: int | None
    diff_lthr_bpm: int | None
    
    current_threshold_pace_sec: int | None
    estimated_threshold_pace_sec: int | None
    diff_pace_sec: int | None
    
    # Formatted strings
    current_threshold_pace_formatted: str | None = None
    estimated_threshold_pace_formatted: str | None = None
    diff_pace_formatted: str | None = None
    
    zones: list[ZoneBoundary] = field(default_factory=list)
    supporting_workouts: list[SupportingWorkout] = field(default_factory=list)


def format_pace(sec_per_km: int | None) -> str:
    if sec_per_km is None or sec_per_km <= 0:
        return "—"
    m = sec_per_km // 60
    s = sec_per_km % 60
    return f"{m}:{s:02d}/km"


def _find_best_20min_effort(
    hr_stream: list[float],
    speed_stream: list[float],
    time_stream: list[float],
) -> tuple[float, float] | None:
    """Find the highest sustained 20-minute average heart rate and speed in a run.

    Uses a sliding window of ~1200 seconds.
    Returns (avg_hr_20m, avg_speed_mps_20m) or None if run is too short.
    """
    n = len(time_stream)
    if n < 60:
        return None
    total_dur = time_stream[-1] - time_stream[0]
    if total_dur < MIN_EFFORT_SECONDS:
        return None

    best_hr_integral = 0.0
    best_speed = 0.0
    found = False

    window_sec = 1200.0
    left = 0

    running_hr_time = 0.0
    running_speed_time = 0.0
    running_time = 0.0

    for right in range(n - 1):
        dt = max(0.0, time_stream[right + 1] - time_stream[right])
        hr = hr_stream[right]
        speed = speed_stream[right]
        if hr and hr > 0 and speed and speed > 0:
            running_hr_time += hr * dt
            running_speed_time += speed * dt
            running_time += dt

        # Shrink window from left if longer than window_sec
        while (time_stream[right + 1] - time_stream[left]) > window_sec and left < right:
            dt_left = max(0.0, time_stream[left + 1] - time_stream[left])
            hr_l = hr_stream[left]
            speed_l = speed_stream[left]
            if hr_l and hr_l > 0 and speed_l and speed_l > 0:
                running_hr_time -= hr_l * dt_left
                running_speed_time -= speed_l * dt_left
                running_time -= dt_left
            left += 1

        if running_time >= window_sec * 0.90:
            avg_hr = running_hr_time / running_time
            if avg_hr > best_hr_integral:
                best_hr_integral = avg_hr
                best_speed = running_speed_time / running_time
                found = True

    if found and best_hr_integral > 100:
        return best_hr_integral, best_speed
    return None


def calculate_5_zones(lthr: int, threshold_pace_sec: int) -> list[ZoneBoundary]:
    """Build the standard 5-zone model from LTHR and Threshold Pace."""
    # Z1: Recupero (< 80% LTHR, > Pace + 45s)
    z1_hr_max = int(round(lthr * 0.80))
    z1_pace_min = threshold_pace_sec + 45
    z1_pace_max = threshold_pace_sec + 90
    
    # Z2: Aerobico / Base (80% - 87% LTHR, Pace + 25s a + 45s)
    z2_hr_min = z1_hr_max + 1
    z2_hr_max = int(round(lthr * 0.87))
    z2_pace_min = threshold_pace_sec + 25
    z2_pace_max = z1_pace_min
    
    # Z3: Tempo / Ritmo Maratona (87% - 94% LTHR, Pace + 10s a + 25s)
    z3_hr_min = z2_hr_max + 1
    z3_hr_max = int(round(lthr * 0.94))
    z3_pace_min = threshold_pace_sec + 10
    z3_pace_max = z2_pace_min
    
    # Z4: Soglia Anaerobica (94% - 100% LTHR, Pace - 5s a + 10s)
    z4_hr_min = z3_hr_max + 1
    z4_hr_max = lthr
    z4_pace_min = threshold_pace_sec - 5
    z4_pace_max = z3_pace_min
    
    # Z5: VO2max / Massimale (> 100% LTHR, Pace < - 5s)
    z5_hr_min = lthr + 1
    z5_hr_max = int(round(lthr * 1.10))
    z5_pace_min = max(120, threshold_pace_sec - 35)
    z5_pace_max = z4_pace_min

    return [
        ZoneBoundary(
            zone_number=1,
            name="Z1 · Recupero",
            hr_min=0,
            hr_max=z1_hr_max,
            pace_min_sec=z1_pace_min,
            pace_max_sec=z1_pace_max,
            hr_range_formatted=f"< {z1_hr_max} bpm",
            pace_range_formatted=f"> {format_pace(z1_pace_min)}",
            description="Recupero attivo, rigenerazione muscolare e smaltimento fatica.",
        ),
        ZoneBoundary(
            zone_number=2,
            name="Z2 · Base Aerobica",
            hr_min=z2_hr_min,
            hr_max=z2_hr_max,
            pace_min_sec=z2_pace_min,
            pace_max_sec=z2_pace_max,
            hr_range_formatted=f"{z2_hr_min}–{z2_hr_max} bpm",
            pace_range_formatted=f"{format_pace(z2_pace_max)} – {format_pace(z2_pace_min)}",
            description="Costruzione del motore aerobico, densità mitocondriale e ossidazione dei grassi.",
        ),
        ZoneBoundary(
            zone_number=3,
            name="Z3 · Tempo",
            hr_min=z3_hr_min,
            hr_max=z3_hr_max,
            pace_min_sec=z3_pace_min,
            pace_max_sec=z3_pace_max,
            hr_range_formatted=f"{z3_hr_min}–{z3_hr_max} bpm",
            pace_range_formatted=f"{format_pace(z3_pace_max)} – {format_pace(z3_pace_min)}",
            description="Ritmo sostenuto, tipico della maratona e del medio controllato.",
        ),
        ZoneBoundary(
            zone_number=4,
            name="Z4 · Soglia Lattato",
            hr_min=z4_hr_min,
            hr_max=z4_hr_max,
            pace_min_sec=z4_pace_min,
            pace_max_sec=z4_pace_max,
            hr_range_formatted=f"{z4_hr_min}–{z4_hr_max} bpm",
            pace_range_formatted=f"{format_pace(z4_pace_max)} – {format_pace(z4_pace_min)}",
            description="Soglia anaerobica: ritmo gara 10k o mezza, massima efficienza di smaltimento del lattato.",
        ),
        ZoneBoundary(
            zone_number=5,
            name="Z5 · VO₂max",
            hr_min=z5_hr_min,
            hr_max=z5_hr_max,
            pace_min_sec=z5_pace_min,
            pace_max_sec=z5_pace_max,
            hr_range_formatted=f"> {lthr} bpm",
            pace_range_formatted=f"< {format_pace(z5_pace_max)}",
            description="Lavoro di potenza aerobica massimale e ripetute corte per stimolare il massimo consumo di ossigeno.",
        ),
    ]


def recalibrate_zones(
    user_id: str,
    current_zones: Zones | None = None,
    lookback_days: int = LOOKBACK_DAYS_ZONES,
    today: date_type | None = None,
) -> ZoneRecalibrationResult:
    """Analyze running stream history to estimate actual LTHR and Threshold Pace."""
    now = today or date_type.today()
    start_date = now - timedelta(days=lookback_days)

    current_lthr = current_zones.threshold_hr if current_zones else None

    # Load stream data
    candidates: list[tuple[float, float, dict[str, Any]]] = []

    for activity_dict, streams_dict in history.streams_between(user_id, start_date, now, RUNNING_SPORTS):
        sport = str(activity_dict.get("sport") or "").lower()
        if not any(r.lower() in sport for r in ("run", "running")):
            continue

        times = streams_dict.get("time") or []
        hrs = streams_dict.get("heartrate") or []
        speeds = streams_dict.get("velocity_smooth") or []

        if not times or not hrs or not speeds or len(times) < 60:
            continue

        clean_res = clean_heart_rate_stream(hrs, times=times)
        effort = _find_best_20min_effort(clean_res.cleaned_heart_rates, speeds, times)
        if effort:
            best_hr_20m, best_speed_20m = effort
            candidates.append((best_hr_20m, best_speed_20m, activity_dict))

    if not candidates:
        return ZoneRecalibrationResult(
            status="dati_insufficienti",
            status_label="Dati Insufficienti",
            status_color="#78716c",
            headline="Nessuna seduta utile per la ricalibrazione",
            summary="Nelle ultime 10 settimane non ci sono corse continue di almeno 20 minuti a ritmo sostenuto.",
            advice="Esegui un medio tirato di 25-30 minuti o una gara di 5-10 km per permettere all'algoritmo di rilevare la soglia.",
            current_lthr=current_lthr,
            estimated_lthr=None,
            diff_lthr_bpm=None,
            current_threshold_pace_sec=None,
            estimated_threshold_pace_sec=None,
            diff_pace_sec=None,
        )

    # Sort candidates by sustained HR
    candidates.sort(key=lambda x: x[0], reverse=True)
    best_hr_20m, best_speed_20m, best_act = candidates[0]

    # Joe Friel standard: LTHR is ~95% of peak 20-min average HR
    # For a continuous 10k race (> 40 min), average HR is ~98-100% of LTHR
    dur_min = float(best_act.get("duration_min") or 30.0)
    dist_km = float(best_act.get("distance_km") or 6.0)

    if dur_min >= 40.0 and dist_km >= 8.0:
        # Long hard race/tempo: HR is very close to LTHR
        estimated_lthr = int(round(best_hr_20m * 0.98))
    else:
        # Standard 20m peak
        estimated_lthr = int(round(best_hr_20m * 0.95))

    estimated_pace_sec = int(round(1000.0 / best_speed_20m)) if best_speed_20m > 0 else 270

    # Build supporting workouts list (top 3)
    supporting: list[SupportingWorkout] = []
    for c_hr, c_speed, act in candidates[:3]:
        c_dur = float(act.get("duration_min") or 0.0)
        c_dist = float(act.get("distance_km") or 0.0)
        c_pace_sec = int(round(1000.0 / c_speed)) if c_speed > 0 else 0
        act_day = act.get("day")
        if isinstance(act_day, str):
            act_day = date_type.fromisoformat(act_day)
        else:
            act_day = act_day or now

        effort_type = "Gara / Test sostenuto" if c_dist >= 9.0 else "Medio / Frazione veloce 20'"
        supporting.append(
            SupportingWorkout(
                activity_id=int(act.get("activity_id") or 0),
                date=act_day,
                title=str(act.get("title") or "Corsa"),
                distance_km=round(c_dist, 2),
                duration_min=round(c_dur, 1),
                avg_hr=int(round(c_hr)),
                avg_pace_sec_km=c_pace_sec,
                avg_pace_formatted=format_pace(c_pace_sec),
                effort_type=effort_type,
            )
        )

    # Compute difference with current baseline
    diff_hr = (estimated_lthr - current_lthr) if current_lthr else None
    
    # Current threshold pace proxy: 5:00/km if unknown
    current_pace_sec = None
    diff_pace = None
    if current_zones:
        # Z4 is threshold
        # Approximate current threshold pace around 4:30 if not known
        current_pace_sec = 270

    zones_list = calculate_5_zones(estimated_lthr, estimated_pace_sec)

    # Determine status & message
    if diff_hr is not None and abs(diff_hr) <= 2:
        status = "allineato"
        label = "Zone Allineate"
        color = "#059669"
        headline = f"Soglia confermata a {estimated_lthr} bpm ({format_pace(estimated_pace_sec)})"
        summary = "Le tue zone attuali riflettono fedelmente le tue capacità fisiologiche misurate sul campo."
        advice = "Continua ad allenarti con i target attuali: la polarizzazione e l'analisi del carico sono calibrate."
    elif diff_hr is not None and (diff_hr > 2 or (diff_pace and diff_pace < -5)):
        status = "migliorato"
        label = "Fitness in Crescita"
        color = "#059669"
        headline = f"Nuova soglia rilevata: {estimated_lthr} bpm a {format_pace(estimated_pace_sec)}"
        summary = f"Hai sostenuto un'intensità più elevata nelle ultime settimane (+{diff_hr} bpm rispetto al riferimento precedente)."
        advice = "Consigliato aggiornare le zone: correndo con le vecchie zone rischieresti di fare i lenti troppo lenti e i medi sotto-stimolati."
    else:
        status = "ricalibrazione_consigliata"
        label = "Ricalibrazione Consigliata"
        color = "#ea580c"
        diff_str = f"({diff_hr:+d} bpm)" if diff_hr is not None else ""
        headline = f"Soglia stimata a {estimated_lthr} bpm {diff_str} · {format_pace(estimated_pace_sec)}"
        summary = "I dati delle tue sedute recenti suggeriscono un adattamento delle soglie cardiache e di passo."
        advice = "Adottando queste nuove zone l'analisi della distribuzione dello sforzo (Z1-Z5) risulterà molto più precisa."

    return ZoneRecalibrationResult(
        status=status,
        status_label=label,
        status_color=color,
        headline=headline,
        summary=summary,
        advice=advice,
        current_lthr=current_lthr,
        estimated_lthr=estimated_lthr,
        diff_lthr_bpm=diff_hr,
        current_threshold_pace_sec=current_pace_sec,
        estimated_threshold_pace_sec=estimated_pace_sec,
        diff_pace_sec=diff_pace,
        current_threshold_pace_formatted=format_pace(current_pace_sec) if current_pace_sec else None,
        estimated_threshold_pace_formatted=format_pace(estimated_pace_sec),
        diff_pace_formatted=f"{diff_pace:+d}s/km" if diff_pace is not None else None,
        zones=zones_list,
        supporting_workouts=supporting,
    )
