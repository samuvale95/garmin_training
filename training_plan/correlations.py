"""Personal correlations engine: sleep, overnight HRV, and resting HR vs athletic performance.

Pairs each running workout with the biometric wellness data of the night immediately preceding it.
Calculates deterministic statistical relationships (Pearson correlation, delta comparisons across
sleep and HRV bands) and derives actionable, honest insights without hand-waving or black-box scores.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date as date_type, timedelta
from typing import Any, Sequence

from . import aerobic_efficiency, checkin, history
from .intensity import RUNNING_SPORTS, Zones

LOOKBACK_DAYS_CORRELATIONS = 90  # 3 months of paired data
MIN_PAIRED_SAMPLES = 6  # Minimum paired sessions to formulate a solid correlation


@dataclass
class CorrelationInsight:
    metric_x: str  # "sonno" | "hrv" | "rhr"
    metric_y: str  # "efficienza_ef" | "passo" | "rpe" | "decoupling"
    title: str
    headline: str
    finding: str
    action: str
    sample_size: int
    correlation_r: float | None
    significance: str  # "forte" | "moderata" | "preliminare" | "insufficiente"
    good_band_label: str
    good_band_avg: str
    bad_band_label: str
    bad_band_avg: str
    delta_pct: float | None = None


@dataclass
class PairedDayData:
    date: date_type
    sleep_hours: float | None
    sleep_score: int | None
    hrv_ms: float | None
    resting_hr: int | None
    activity_id: int
    sport: str
    title: str
    distance_km: float
    duration_min: float
    avg_hr: float
    avg_speed_mps: float
    pace_sec_km: int
    ef: float
    decoupling_pct: float | None = None
    rpe_effort: str | None = None
    body_feeling: str | None = None


@dataclass
class PersonalCorrelationsResult:
    status: str  # "solido" | "preliminare" | "dati_insufficienti"
    status_label: str
    status_color: str
    headline: str
    summary: str
    total_paired_runs: int
    insights: list[CorrelationInsight] = field(default_factory=list)
    paired_runs: list[dict[str, Any]] = field(default_factory=list)


def _pearson_correlation(x: list[float], y: list[float]) -> float | None:
    """Standard Pearson correlation coefficient r."""
    if len(x) < 3 or len(x) != len(y):
        return None
    n = len(x)
    mean_x = sum(x) / n
    mean_y = sum(y) / n
    
    num = sum((xi - mean_x) * (yi - mean_y) for xi, yi in zip(x, y))
    den_x = sum((xi - mean_x) ** 2 for xi in x)
    den_y = sum((yi - mean_y) ** 2 for yi in y)
    
    den = math.sqrt(den_x * den_y)
    if den == 0:
        return 0.0
    return num / den


def format_pace(sec_per_km: int | None) -> str:
    if sec_per_km is None or sec_per_km <= 0:
        return "—"
    m = sec_per_km // 60
    s = sec_per_km % 60
    return f"{m}:{s:02d}/km"


def compute_personal_correlations(
    user_id: str,
    zones: Zones | None = None,
    lookback_days: int = LOOKBACK_DAYS_CORRELATIONS,
    today: date_type | None = None,
) -> PersonalCorrelationsResult:
    """Analyze pairings between sleep/biometrics and same-day running performance."""
    now = today or date_type.today()
    start_date = now - timedelta(days=lookback_days)

    # 1. Fetch wellness days (sleep, HRV, RHR)
    wellness_rows = history.wellness_between(user_id, start_date, now)
    wellness_by_day: dict[date_type, dict[str, Any]] = {}
    for row in wellness_rows:
        day_raw = row.get("day")
        if isinstance(day_raw, str):
            d = date_type.fromisoformat(day_raw)
        else:
            d = day_raw
        if d:
            wellness_by_day[d] = row

    # 2. Fetch daily check-ins
    checkins_by_day: dict[date_type, checkin.CheckIn] = {}
    try:
        checkins_list = checkin.get_range(user_id, start_date, now)
        for c in checkins_list:
            checkins_by_day[c.date] = c
    except Exception:
        pass

    # 3. Load activities and streams
    paired: list[PairedDayData] = []
    
    # Read activities in range
    activities = history.activities_between(user_id, start_date, now)
    
    for act in activities:
        sport = str(act.get("sport") or "").lower()
        if not any(r.lower() in sport for r in ("run", "running")):
            continue
            
        act_day_raw = act.get("day")
        if isinstance(act_day_raw, str):
            act_day = date_type.fromisoformat(act_day_raw)
        else:
            act_day = act_day_raw
            
        if not act_day:
            continue

        well = wellness_by_day.get(act_day)
        if not well:
            continue

        dur_min = float(act.get("duration_min") or 0.0)
        dist_km = float(act.get("distance_km") or 0.0)
        avg_hr = float(act.get("avg_hr") or 0.0)

        if dur_min < 15.0 or dist_km < 2.0 or avg_hr <= 0:
            continue

        speed_mps = (dist_km * 1000.0) / (dur_min * 60.0)
        pace_sec = int(round(1000.0 / speed_mps)) if speed_mps > 0 else 0
        ef = speed_mps / avg_hr

        # Sleep
        sleep_min = well.get("sleep_total_min")
        sleep_hours = round(sleep_min / 60.0, 1) if sleep_min and sleep_min > 60 else None
        sleep_score = well.get("sleep_score")

        hrv_ms = well.get("hrv_ms")
        resting_hr = well.get("resting_hr")

        chk = checkins_by_day.get(act_day)
        rpe_effort = chk.effort if chk else None
        body_feeling = chk.body if chk else None

        paired.append(
            PairedDayData(
                date=act_day,
                sleep_hours=sleep_hours,
                sleep_score=int(sleep_score) if sleep_score else None,
                hrv_ms=float(hrv_ms) if hrv_ms else None,
                resting_hr=int(resting_hr) if resting_hr else None,
                activity_id=int(act.get("activity_id") or 0),
                sport=str(act.get("sport")),
                title=str(act.get("title") or "Corsa"),
                distance_km=round(dist_km, 2),
                duration_min=round(dur_min, 1),
                avg_hr=round(avg_hr, 1),
                avg_speed_mps=round(speed_mps, 2),
                pace_sec_km=pace_sec,
                ef=round(ef, 4),
                rpe_effort=rpe_effort,
                body_feeling=body_feeling,
            )
        )

    if len(paired) < MIN_PAIRED_SAMPLES:
        return PersonalCorrelationsResult(
            status="dati_insufficienti",
            status_label="Dati in Accumulo",
            status_color="#78716c",
            headline="Servono più sedute abbinate al sonno",
            summary=f"Trovate {len(paired)} sedute con dati biometrici notturni (minimo {MIN_PAIRED_SAMPLES} per calcolare correlazioni affidabili).",
            total_paired_runs=len(paired),
            insights=[],
            paired_runs=[
                {
                    "date": p.date.isoformat(),
                    "title": p.title,
                    "sleep_hours": p.sleep_hours,
                    "hrv_ms": p.hrv_ms,
                    "pace_formatted": format_pace(p.pace_sec_km),
                    "ef": p.ef,
                }
                for p in paired[:10]
            ],
        )

    insights: list[CorrelationInsight] = []

    # -------------------------------------------------------------
    # 1. CORRELAZIONE: Sonno (Ore) vs Efficienza Aerobica (EF)
    # -------------------------------------------------------------
    sleep_ef_pairs = [(p.sleep_hours, p.ef, p.pace_sec_km) for p in paired if p.sleep_hours is not None]
    if len(sleep_ef_pairs) >= MIN_PAIRED_SAMPLES:
        good_sleep = [p for p in sleep_ef_pairs if p[0] >= 7.0]
        bad_sleep = [p for p in sleep_ef_pairs if p[0] < 6.8]

        x_vals = [p[0] for p in sleep_ef_pairs]
        y_vals = [p[1] for p in sleep_ef_pairs]
        r_val = _pearson_correlation(x_vals, y_vals)

        if good_sleep and bad_sleep:
            avg_ef_good = sum(p[1] for p in good_sleep) / len(good_sleep)
            avg_ef_bad = sum(p[1] for p in bad_sleep) / len(bad_sleep)
            avg_pace_good = int(round(sum(p[2] for p in good_sleep) / len(good_sleep)))
            avg_pace_bad = int(round(sum(p[2] for p in bad_sleep) / len(bad_sleep)))

            delta_pct = round(((avg_ef_good - avg_ef_bad) / avg_ef_bad) * 100.0, 1) if avg_ef_bad > 0 else 0.0

            if delta_pct >= 2.5 or (r_val and r_val > 0.3):
                significance = "forte" if len(sleep_ef_pairs) >= 15 else "moderata"
                insights.append(
                    CorrelationInsight(
                        metric_x="sonno",
                        metric_y="efficienza_ef",
                        title="Sonno & Rendimento Cardiaco",
                        headline=f"+{delta_pct}% efficienza dopo notti da ≥ 7 ore",
                        finding=f"Dopo una notte da almeno 7h corri a {format_pace(avg_pace_good)} con maggiore economia rispetto a notti corte ({format_pace(avg_pace_bad)}).",
                        action="Proteggi almeno 7h di sonno prima delle sedute chiave: il cuore lavora a regime molto più efficiente.",
                        sample_size=len(sleep_ef_pairs),
                        correlation_r=round(r_val, 2) if r_val is not None else None,
                        significance=significance,
                        good_band_label="≥ 7h di sonno",
                        good_band_avg=f"EF {(avg_ef_good * 1000):.1f} · {format_pace(avg_pace_good)}",
                        bad_band_label="< 6.8h di sonno",
                        bad_band_avg=f"EF {(avg_ef_bad * 1000):.1f} · {format_pace(avg_pace_bad)}",
                        delta_pct=delta_pct,
                    )
                )

    # -------------------------------------------------------------
    # 2. CORRELAZIONE: HRV Notturno vs Efficienza & FC Corsa
    # -------------------------------------------------------------
    hrv_pairs = [(p.hrv_ms, p.ef, p.avg_hr) for p in paired if p.hrv_ms is not None and p.hrv_ms > 10]
    if len(hrv_pairs) >= MIN_PAIRED_SAMPLES:
        median_hrv = sorted(p[0] for p in hrv_pairs)[len(hrv_pairs) // 2]
        high_hrv = [p for p in hrv_pairs if p[0] >= median_hrv]
        low_hrv = [p for p in hrv_pairs if p[0] < median_hrv]

        x_hrv = [p[0] for p in hrv_pairs]
        y_ef = [p[1] for p in hrv_pairs]
        r_hrv = _pearson_correlation(x_hrv, y_ef)

        if high_hrv and low_hrv:
            avg_ef_high = sum(p[1] for p in high_hrv) / len(high_hrv)
            avg_ef_low = sum(p[1] for p in low_hrv) / len(low_hrv)
            avg_hr_high = round(sum(p[2] for p in high_hrv) / len(high_hrv), 0)
            avg_hr_low = round(sum(p[2] for p in low_hrv) / len(low_hrv), 0)

            delta_hrv_pct = round(((avg_ef_high - avg_ef_low) / avg_ef_low) * 100.0, 1) if avg_ef_low > 0 else 0.0

            significance = "forte" if len(hrv_pairs) >= 15 else "moderata"
            insights.append(
                CorrelationInsight(
                    metric_x="hrv",
                    metric_y="efficienza_ef",
                    title="HRV Notturno & Capacità Cardiovascolare",
                    headline=f"HRV alto riflette un'efficienza superiore ({delta_hrv_pct:+.1f}%)",
                    finding=f"Nelle giornate con HRV sopra la mediana ({median_hrv:.0f} ms), il cuore batte a regime più controllato ({avg_hr_high:.0f} bpm medi vs {avg_hr_low:.0f} bpm).",
                    action="Se l'HRV scende sensibilmente sotto la tua media, trasforma la seduta in fondo facile senza forzare.",
                    sample_size=len(hrv_pairs),
                    correlation_r=round(r_hrv, 2) if r_hrv is not None else None,
                    significance=significance,
                    good_band_label=f"HRV ≥ {median_hrv:.0f} ms",
                    good_band_avg=f"EF {(avg_ef_high * 1000):.1f} ({avg_hr_high:.0f} bpm)",
                    bad_band_label=f"HRV < {median_hrv:.0f} ms",
                    bad_band_avg=f"EF {(avg_ef_low * 1000):.1f} ({avg_hr_low:.0f} bpm)",
                    delta_pct=delta_hrv_pct,
                )
            )

    # -------------------------------------------------------------
    # 3. CORRELAZIONE: FC Riposo (RHR) vs Deriva / Stanchezza
    # -------------------------------------------------------------
    rhr_pairs = [(p.resting_hr, p.ef, p.avg_hr) for p in paired if p.resting_hr is not None and p.resting_hr > 30]
    if len(rhr_pairs) >= MIN_PAIRED_SAMPLES:
        median_rhr = sorted(p[0] for p in rhr_pairs)[len(rhr_pairs) // 2]
        low_rhr = [p for p in rhr_pairs if p[0] <= median_rhr]
        elevated_rhr = [p for p in rhr_pairs if p[0] > median_rhr]

        x_rhr = [float(p[0]) for p in rhr_pairs]
        y_fc = [float(p[2]) for p in rhr_pairs]
        r_rhr = _pearson_correlation(x_rhr, y_fc)

        if low_rhr and elevated_rhr:
            avg_hr_clean = round(sum(p[2] for p in low_rhr) / len(low_rhr), 0)
            avg_hr_elevated = round(sum(p[2] for p in elevated_rhr) / len(elevated_rhr), 0)
            diff_hr = int(round(avg_hr_elevated - avg_hr_clean))

            insights.append(
                CorrelationInsight(
                    metric_x="rhr",
                    metric_y="battiti_corsa",
                    title="FC a Riposo & Frequenza in Corsa",
                    headline=f"Battiti a riposo elevati alzano la FC in corsa (+{diff_hr} bpm)",
                    finding=f"Quando la FC notturna supera la tua mediana ({median_rhr} bpm), corri a parità di passo con circa {diff_hr} battiti al minuto in più.",
                    action="Un aumento persistente di FC a riposo indica che il corpo sta ancora smaltendo fatica o stress metabolico.",
                    sample_size=len(rhr_pairs),
                    correlation_r=round(r_rhr, 2) if r_rhr is not None else None,
                    significance="moderata" if len(rhr_pairs) >= 12 else "preliminare",
                    good_band_label=f"RHR ≤ {median_rhr} bpm",
                    good_band_avg=f"{avg_hr_clean:.0f} bpm medi",
                    bad_band_label=f"RHR > {median_rhr} bpm",
                    bad_band_avg=f"{avg_hr_elevated:.0f} bpm medi",
                    delta_pct=float(diff_hr),
                )
            )

    status = "solido" if len(paired) >= 14 else "preliminare"
    label = "Correlazioni Convalidate" if status == "solido" else "Tendenze Preliminari"
    color = "#059669" if status == "solido" else "var(--azzurro)"

    headline = f"Analisi su {len(paired)} allenamenti incrociati con il sonno"
    summary = (
        "I tuoi dati mostrano una relazione misurabile tra le ore di riposo notturno, "
        "l'HRV e la tua efficienza di corsa sul campo."
    )

    return PersonalCorrelationsResult(
        status=status,
        status_label=label,
        status_color=color,
        headline=headline,
        summary=summary,
        total_paired_runs=len(paired),
        insights=insights,
        paired_runs=[
            {
                "date": p.date.isoformat(),
                "title": p.title,
                "sleep_hours": p.sleep_hours,
                "hrv_ms": p.hrv_ms,
                "pace_formatted": format_pace(p.pace_sec_km),
                "ef": p.ef,
            }
            for p in paired[:15]
        ],
    )
