"""Aerobic Efficiency and Cardiac Decoupling analysis for runners."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date as date_type, timedelta
from typing import Any, Sequence, Literal

from training_plan.hr_cleaning import clean_heart_rate_stream
from training_plan.intensity import RUNNING_SPORTS, Zones, Finding
from training_plan import history

@dataclass
class EFTrend:
    current_ef: float
    ef_4w_ago: float
    change_pct: float
    slope: float
    classification: Literal["miglioramento", "stabile", "calo"]

@dataclass
class EFPoint:
    date: date_type
    activity_id: int
    ef: float
    avg_hr: float
    avg_pace_min_km: float
    duration_min: float
    distance_km: float
    decoupling_pct: float | None

@dataclass
class AerobicEfficiencyResult:
    trend: EFTrend | None
    history: list[EFPoint]
    findings: list[Finding]

def _compute_weighted_averages(heart_rates: list[float], speeds: list[float], times: list[float]) -> tuple[float, float, float]:
    """Compute time-weighted average speed and HR, returning (avg_hr, avg_speed, duration_seconds)."""
    total_hr = 0.0
    total_speed = 0.0
    total_time = 0.0
    
    n = len(heart_rates)
    n_times = len(times)
    for i in range(n):
        hr = heart_rates[i]
        speed = speeds[i]
        
        if hr is not None and hr > 0 and speed is not None and speed > 0:
            if i + 1 < n_times:
                weight = max(float(times[i + 1]) - float(times[i]), 0.0)
            elif i > 0 and n_times > 1:
                weight = max(float(times[i]) - float(times[i - 1]), 0.0)
            else:
                weight = 1.0
            
            total_hr += hr * weight
            total_speed += speed * weight
            total_time += weight
            
    if total_time == 0:
        return 0.0, 0.0, 0.0
        
    return total_hr / total_time, total_speed / total_time, total_time

def _is_easy_run(heart_rates: list[float], times: list[float], aerobic_hr: int) -> bool:
    """Check if most of the time is spent below the aerobic threshold."""
    total_time = 0.0
    easy_time = 0.0
    
    n = len(heart_rates)
    n_times = len(times)
    for i in range(n):
        hr = heart_rates[i]
        if hr is not None and hr > 0:
            if i + 1 < n_times:
                weight = max(float(times[i + 1]) - float(times[i]), 0.0)
            elif i > 0 and n_times > 1:
                weight = max(float(times[i]) - float(times[i - 1]), 0.0)
            else:
                weight = 1.0
            
            total_time += weight
            if hr <= aerobic_hr:
                easy_time += weight
                
    if total_time == 0:
        return False
    return (easy_time / total_time) > 0.5

def _linear_regression_slope(x: list[float], y: list[float]) -> float:
    if len(x) < 2:
        return 0.0
    n = len(x)
    sum_x = sum(x)
    sum_y = sum(y)
    sum_xy = sum(xi * yi for xi, yi in zip(x, y))
    sum_xx = sum(xi * xi for xi in x)
    
    denominator = (n * sum_xx - sum_x * sum_x)
    if denominator == 0:
        return 0.0
    return (n * sum_xy - sum_x * sum_y) / denominator

def compute_aerobic_efficiency(user_id: str, lookback_days: int, zones: Zones, today: date_type | None = None) -> AerobicEfficiencyResult:
    """Compute Aerobic Efficiency (EF) and Cardiac Decoupling for easy runs."""
    now = today or date_type.today()
    start_date = now - timedelta(days=lookback_days)
    
    ef_points: list[EFPoint] = []
    
    for activity_dict, streams_dict in history.streams_between(user_id, start_date, now, RUNNING_SPORTS):
        sport = activity_dict.get("sport", "").lower()
        # Ensure it's a running sport (though streams_between might filter, double check is good)
        if activity_dict.get("sport") not in RUNNING_SPORTS and sport not in [s.lower() for s in RUNNING_SPORTS]:
            continue
            
        time_stream = streams_dict.get("time", [])
        hr_stream = streams_dict.get("heartrate", [])
        speed_stream = streams_dict.get("velocity_smooth", [])
        
        if not time_stream or not hr_stream or not speed_stream:
            continue
            
        duration_min = activity_dict.get("duration_min")
        if not duration_min:
            if time_stream:
                duration_min = (time_stream[-1] - time_stream[0]) / 60.0
            else:
                continue
                
        if duration_min < 20.0:
            continue
            
        cleaned_hr_res = clean_heart_rate_stream(hr_stream, times=time_stream, max_hr=zones.threshold_hr * 1.15)
        hr_stream_clean = cleaned_hr_res.cleaned_heart_rates
        
        if not _is_easy_run(hr_stream_clean, time_stream, zones.aerobic_hr):
            continue
            
        avg_hr, avg_speed, valid_time = _compute_weighted_averages(hr_stream_clean, speed_stream, time_stream)
        if avg_hr == 0 or avg_speed == 0:
            continue
            
        ef = avg_speed / avg_hr
        
        avg_pace_min_km = (1000.0 / avg_speed) / 60.0 if avg_speed > 0 else 0.0
        distance_km = activity_dict.get("distance_km", (avg_speed * valid_time) / 1000.0)
        
        act_date_raw = activity_dict.get("day")
        if isinstance(act_date_raw, str):
            act_date = date_type.fromisoformat(act_date_raw)
        else:
            act_date = act_date_raw or now
            
        decoupling_pct = None
        if duration_min >= 45.0:
            # Split into halves by time
            total_duration = time_stream[-1] - time_stream[0]
            midpoint_time = time_stream[0] + (total_duration / 2.0)
            
            hr_1, speed_1, time_1 = [], [], []
            hr_2, speed_2, time_2 = [], [], []
            
            for h, s, t in zip(hr_stream_clean, speed_stream, time_stream):
                if t < midpoint_time:
                    hr_1.append(h)
                    speed_1.append(s)
                    time_1.append(t)
                else:
                    hr_2.append(h)
                    speed_2.append(s)
                    time_2.append(t)
                    
            avg_hr_1, avg_speed_1, _ = _compute_weighted_averages(hr_1, speed_1, time_1)
            avg_hr_2, avg_speed_2, _ = _compute_weighted_averages(hr_2, speed_2, time_2)
            
            if avg_hr_1 > 0 and avg_hr_2 > 0 and avg_speed_1 > 0:
                ef_1 = avg_speed_1 / avg_hr_1
                ef_2 = avg_speed_2 / avg_hr_2
                decoupling_pct = ((ef_1 - ef_2) / ef_1) * 100.0
                
        ef_points.append(EFPoint(
            date=act_date,
            activity_id=activity_dict.get("activity_id", 0),
            ef=ef,
            avg_hr=avg_hr,
            avg_pace_min_km=avg_pace_min_km,
            duration_min=duration_min,
            distance_km=distance_km,
            decoupling_pct=decoupling_pct
        ))
        
    ef_points.sort(key=lambda p: p.date)
    
    trend: EFTrend | None = None
    findings: list[Finding] = []
    
    if ef_points:
        # Calculate trend
        x = [(p.date - start_date).days for p in ef_points]
        y = [p.ef for p in ef_points]
        slope = _linear_regression_slope(x, y)
        
        # Recent EF vs 4 weeks ago
        recent_points = [p for p in ef_points if (now - p.date).days <= 14]
        old_points = [p for p in ef_points if 21 <= (now - p.date).days <= 35]
        
        if recent_points:
            current_ef = sum(p.ef for p in recent_points) / len(recent_points)
        else:
            current_ef = ef_points[-1].ef
            
        if old_points:
            ef_4w_ago = sum(p.ef for p in old_points) / len(old_points)
        else:
            ef_4w_ago = ef_points[0].ef
            
        change_pct = ((current_ef - ef_4w_ago) / ef_4w_ago * 100.0) if ef_4w_ago > 0 else 0.0
        
        if change_pct > 2.0 or slope > 0.0001:
            classification = "miglioramento"
        elif change_pct < -2.0 or slope < -0.0001:
            classification = "calo"
        else:
            classification = "stabile"
            
        trend = EFTrend(
            current_ef=current_ef,
            ef_4w_ago=ef_4w_ago,
            change_pct=change_pct,
            slope=slope,
            classification=classification
        )
        
        # Findings logic
        if classification == "miglioramento":
            findings.append(Finding(
                key="ef_trend",
                headline="Efficienza Aerobica in Miglioramento",
                measured=f"Il tuo EF è salito da {ef_4w_ago:.3f} a {current_ef:.3f} ({change_pct:+.1f}%).",
                evidence="misurato",
                action="Ottimo segno: a parità di battiti vai più veloce, o a parità di passo i battiti sono più bassi.",
                severity="info"
            ))
        elif classification == "calo":
            findings.append(Finding(
                key="ef_trend",
                headline="Efficienza Aerobica in Calo",
                measured=f"Il tuo EF è sceso da {ef_4w_ago:.3f} a {current_ef:.3f} ({change_pct:+.1f}%).",
                evidence="misurato",
                action="Potrebbe indicare stanchezza accumulata, condizioni meteo avverse o una regressione nella base aerobica.",
                severity="attenzione"
            ))
        else:
            findings.append(Finding(
                key="ef_trend",
                headline="Efficienza Aerobica Stabile",
                measured=f"EF stabile attorno a {current_ef:.3f} nelle ultime settimane.",
                evidence="misurato",
                severity="info"
            ))
            
        # Decoupling findings
        recent_long_runs = [p for p in ef_points if p.decoupling_pct is not None and (now - p.date).days <= 28]
        if recent_long_runs:
            avg_decoupling = sum(p.decoupling_pct for p in recent_long_runs) / len(recent_long_runs) # type: ignore
            if avg_decoupling < 5.0:
                findings.append(Finding(
                    key="decoupling",
                    headline="Ottima tenuta aerobica",
                    measured=f"Disaccoppiamento medio del {avg_decoupling:.1f}% sui lunghi recenti (sotto il 5%).",
                    evidence="misurato",
                    action="La tua base aerobica è solida, riesci a mantenere l'efficienza anche nella seconda metà dell'allenamento.",
                    severity="info"
                ))
            else:
                findings.append(Finding(
                    key="decoupling",
                    headline="Deriva Cardiaca Elevata",
                    measured=f"Disaccoppiamento medio del {avg_decoupling:.1f}% sui lunghi recenti (sopra il 5%).",
                    evidence="misurato",
                    action="Nella seconda metà dei lunghi il cuore sale molto a parità di passo. Manca resistenza aerobica specifica, oppure ci sono problemi di idratazione/nutrizione.",
                    severity="attenzione"
                ))
                
    return AerobicEfficiencyResult(
        trend=trend,
        history=ef_points,
        findings=findings
    )
