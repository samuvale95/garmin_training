"""Multi-signal root-cause workout analysis and actionable post-workout diagnosis.

Analyzes running activities second-by-second using activity streams (time, distance,
velocity_smooth, heartrate, cadence, altitude, watts) crossed with historical baseline,
overnight biometrics (wellness_day), and pre-run nutrition (food_entry).

Detects exact changepoints (breakpoints), investigates multi-signal correlations
(e.g., cadence lock vs hill debt vs pacing trap vs stride degradation vs metabolic wall),
and produces honest, deterministic coaching findings on what happened and how to improve.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date as date_type, timedelta
from typing import Any, Literal, Sequence

from . import db, history, hr_reliability, intensity, nutrition, race_analysis
from .hr_cleaning import clean_heart_rate_stream


@dataclass
class StreamBreakpoint:
    """An exact moment during the activity where a notable shift occurred."""
    time_sec: int
    distance_km: float
    kind: Literal[
        "hr_step_jump",
        "cadence_lock",
        "pace_collapse",
        "stride_degradation",
        "cadence_drop",
        "hill_surge",
        "metabolic_wall",
        "pacing_trap",
        "hr_sensor_step",
    ]
    headline: str
    detail: str
    before_metrics: dict[str, str | float]
    after_metrics: dict[str, str | float]


@dataclass
class CausalFinding:
    """A verified correlation / root-cause finding with concrete improvement action."""
    key: str
    category: Literal["sensore", "meccanica", "pacing", "metabolica", "fisiologica", "salita"]
    confidence: Literal["alta", "media", "ipotesi"]
    evidence_badge: Literal["stream secondo-per-secondo", "incrocio vigilia", "confronto storico"]
    title: str
    what_happened: str
    why_it_happened: str
    how_to_improve: str
    supporting_metrics: list[dict[str, str]] = field(default_factory=list)


@dataclass
class WorkoutSegment:
    """A distance-based split summarizing progression across the workout."""
    label: str
    start_km: float
    end_km: float
    duration_min: float
    avg_pace_formatted: str
    avg_pace_sec: int
    avg_hr: int | None
    avg_cadence: int | None
    avg_stride_m: float | None
    elevation_gain_m: float | None


@dataclass
class WorkoutAnalysisResult:
    activity_id: int
    date: date_type
    title: str
    sport: str
    duration_min: float
    distance_km: float
    avg_pace_formatted: str
    avg_hr: int | None
    verdict_status: Literal["ottimo", "da_rivedere", "anomalia_rilevata"]
    headline: str
    summary_deterministic: str
    coach_narrative: str | None = None
    breakpoints: list[StreamBreakpoint] = field(default_factory=list)
    findings: list[CausalFinding] = field(default_factory=list)
    segments: list[WorkoutSegment] = field(default_factory=list)
    mechanics_summary: dict[str, Any] = field(default_factory=dict)
    vigilia_context: dict[str, Any] = field(default_factory=dict)
    # `hr_reliability.assess`, flattened for the screen; None without a heart rate.
    hr_reliability: dict[str, Any] | None = None
    # `race_analysis.analyze` for runs long enough to have one.
    race_analysis: dict[str, Any] | None = None


def format_pace(sec_per_km: int | float | None) -> str:
    if sec_per_km is None or sec_per_km <= 0 or math.isnan(sec_per_km):
        return "—"
    total_sec = int(round(sec_per_km))
    m = total_sec // 60
    s = total_sec % 60
    return f"{m}:{s:02d}/km"


def _rolling_mean(series: list[float | None], window: int) -> list[float | None]:
    """Compute rolling mean over a window, ignoring None."""
    n = len(series)
    out: list[float | None] = [None] * n
    if window <= 0:
        return out

    for i in range(n):
        start = max(0, i - window + 1)
        chunk = [x for x in series[start : i + 1] if x is not None]
        if chunk:
            out[i] = sum(chunk) / len(chunk)
        else:
            out[i] = None
    return out


def _compute_grade_pct(
    altitudes: list[float | None],
    distances: list[float | None],
    window_pts: int = 15,
) -> list[float | None]:
    """Calculate slope grade in percent from altitude and distance streams."""
    n = len(altitudes)
    grades: list[float | None] = [0.0] * n
    for i in range(n):
        prev_idx = max(0, i - window_pts)
        next_idx = min(n - 1, i + window_pts)
        alt_prev = altitudes[prev_idx]
        alt_next = altitudes[next_idx]
        dist_prev = distances[prev_idx]
        dist_next = distances[next_idx]

        if (
            alt_prev is not None
            and alt_next is not None
            and dist_prev is not None
            and dist_next is not None
        ):
            delta_dist = dist_next - dist_prev
            if delta_dist >= 20.0:  # at least 20m distance span to avoid GPS jitter
                delta_alt = alt_next - alt_prev
                grades[i] = round((delta_alt / delta_dist) * 100.0, 1)
            else:
                grades[i] = 0.0
        else:
            grades[i] = 0.0
    return grades


def analyze_workout_streams(
    activity_id: int,
    date: date_type,
    title: str,
    sport: str,
    streams: dict[str, list[float | None]],
    zones: intensity.Zones | None = None,
    wellness: dict[str, Any] | None = None,
    baseline_hrv: float | None = None,
    baseline_rhr: float | None = None,
    carbs_prev_day_g: float | None = None,
    carbs_target_g: float | None = None,
    level: int = 1,
    hr_source: str | None = None,
) -> WorkoutAnalysisResult:
    """Core deterministic analyzer for a single workout's streams."""
    time_stream = [float(t) for t in streams.get("time", []) if t is not None]
    n = len(time_stream)
    if n < 120:
        return WorkoutAnalysisResult(
            activity_id=activity_id,
            date=date,
            title=title,
            sport=sport,
            duration_min=0.0,
            distance_km=0.0,
            avg_pace_formatted="—",
            avg_hr=None,
            verdict_status="da_rivedere",
            headline="Dati insufficienti per l'analisi dettagliata",
            summary_deterministic="La traccia dell'allenamento è troppo breve o priva di dati continui.",
        )

    dur_sec = time_stream[-1] - time_stream[0]
    duration_min = round(dur_sec / 60.0, 1)

    dist_stream = [
        float(d) if d is not None else 0.0 for d in streams.get("distance", [0.0] * n)
    ]
    tot_dist_m = dist_stream[-1] - dist_stream[0] if dist_stream else 0.0
    distance_km = round(tot_dist_m / 1000.0, 2)

    raw_hr = streams.get("heartrate", [None] * n)
    speeds = streams.get("velocity_smooth", [None] * n)
    raw_cads = streams.get("cadence", [None] * n)
    altitudes = streams.get("altitude", [None] * n)

    # 1. Clean and normalize cadences (convert half-cadence 85 -> 170 spm)
    cadences: list[float | None] = []
    for c in raw_cads:
        if c is not None and c > 0:
            eff = c * 2 if c < 110 else c
            cadences.append(eff)
        else:
            cadences.append(None)

    # 2. Heart rate cleaning
    cleaned_hr_res = clean_heart_rate_stream(
        raw_hr,
        times=time_stream,
        cadences=cadences,
        speeds=speeds,
        max_hr=zones.threshold_hr * 1.15 if zones else None,
    )
    hr_stream = cleaned_hr_res.cleaned_heart_rates

    # 2b. Whether the heart rate is the heart at all. A sensor that locked onto the step
    # rhythm is excluded from everything downstream -- halves, splits, decoupling -- from
    # the moment it locked, instead of being read as a 20 bpm effort.
    reliability = hr_reliability.assess(streams)
    unreliable_from = (
        reliability.unreliable_from_s
        if reliability is not None and reliability.verdict == "inaffidabile"
        else None
    )
    if unreliable_from is not None:
        hr_stream = [
            None if t >= time_stream[0] + unreliable_from else h
            for t, h in zip(time_stream, hr_stream)
        ]

    # 3. Derive stride length (meters per stride = speed (m/s) * 60 / cadence (spm))
    stride_lengths: list[float | None] = []
    for s, c in zip(speeds, cadences):
        if s is not None and s > 1.0 and c is not None and c > 120:
            stride_lengths.append(round((s * 60.0) / c, 3))
        else:
            stride_lengths.append(None)

    # 4. Derive grades (%)
    grades = _compute_grade_pct(altitudes, dist_stream)

    # 5. Global workout averages
    valid_speeds = [s for s in speeds if s is not None and s > 0.5]
    avg_speed = sum(valid_speeds) / len(valid_speeds) if valid_speeds else 0.0
    avg_pace_sec = int(round(1000.0 / avg_speed)) if avg_speed > 0 else 0
    avg_pace_fmt = format_pace(avg_pace_sec)

    valid_hrs = [h for h in hr_stream if h is not None and h > 30]
    avg_hr = int(round(sum(valid_hrs) / len(valid_hrs))) if valid_hrs else None

    valid_cads = [c for c in cadences if c is not None and c > 120]
    avg_cad = int(round(sum(valid_cads) / len(valid_cads))) if valid_cads else None

    valid_strides = [st for st in stride_lengths if st is not None]
    avg_stride = (
        round(sum(valid_strides) / len(valid_strides), 2) if valid_strides else None
    )

    # -------------------------------------------------------------
    # 6. Breakpoint & Changepoint Detection (The "+20 bpm at min 50" logic)
    # -------------------------------------------------------------
    breakpoints: list[StreamBreakpoint] = []
    findings: list[CausalFinding] = []

    # Window of 90 seconds in index steps (assuming approx 1 sample/sec or dt)
    # Look for sharp step jumps in HR that stay elevated for at least 3 minutes
    step_window = 90
    min_elevated_window = 180

    i = step_window
    while i < n - min_elevated_window:
        t_now = time_stream[i]
        d_now = dist_stream[i] / 1000.0
        # Past the point the sensor stopped reading the heart, no heart-rate step means
        # anything; the reliability finding below stands for all of it.
        if unreliable_from is not None and t_now - time_stream[0] >= unreliable_from - step_window:
            break

        before_hr_chunk = [
            h for h in raw_hr[i - step_window : i] if h is not None and h > 30
        ]
        after_hr_chunk = [
            h for h in raw_hr[i : i + step_window] if h is not None and h > 30
        ]
        sustained_hr_chunk = [
            h
            for h in raw_hr[i : i + min_elevated_window]
            if h is not None and h > 30
        ]

        if (
            len(before_hr_chunk) >= 40
            and len(after_hr_chunk) >= 40
            and len(sustained_hr_chunk) >= 80
        ):
            hr_before = sum(before_hr_chunk) / len(before_hr_chunk)
            hr_after = sum(after_hr_chunk) / len(after_hr_chunk)
            hr_sustained = sum(sustained_hr_chunk) / len(sustained_hr_chunk)
            delta_hr = hr_after - hr_before

            # Detected an acute step jump of >= 13 bpm that remains sustained
            if delta_hr >= 13.0 and (hr_sustained - hr_before) >= 11.0:
                # Analyze other channels in the exact same window
                before_cad_chunk = [
                    c
                    for c in cadences[i - step_window : i]
                    if c is not None and c > 120
                ]
                after_cad_chunk = [
                    c
                    for c in cadences[i : i + step_window]
                    if c is not None and c > 120
                ]
                cad_before = (
                    sum(before_cad_chunk) / len(before_cad_chunk)
                    if before_cad_chunk
                    else None
                )
                cad_after = (
                    sum(after_cad_chunk) / len(after_cad_chunk)
                    if after_cad_chunk
                    else None
                )

                before_spd_chunk = [
                    s for s in speeds[i - step_window : i] if s is not None
                ]
                after_spd_chunk = [
                    s for s in speeds[i : i + step_window] if s is not None
                ]
                spd_before = (
                    sum(before_spd_chunk) / len(before_spd_chunk)
                    if before_spd_chunk
                    else 0.0
                )
                spd_after = (
                    sum(after_spd_chunk) / len(after_spd_chunk)
                    if after_spd_chunk
                    else 0.0
                )

                before_alt_chunk = [
                    a for a in altitudes[i - step_window : i] if a is not None
                ]
                after_alt_chunk = [
                    a for a in altitudes[i : i + step_window] if a is not None
                ]
                grade_in_window = 0.0
                if (
                    before_alt_chunk
                    and after_alt_chunk
                    and dist_stream[i + step_window] - dist_stream[i - step_window]
                    > 50
                ):
                    delta_a = after_alt_chunk[-1] - before_alt_chunk[0]
                    delta_d = (
                        dist_stream[i + step_window]
                        - dist_stream[i - step_window]
                    )
                    grade_in_window = (delta_a / delta_d) * 100.0

                min_mark = int(round(t_now / 60.0))

                # CHECK B: Hill Surge (Debito da salita)
                if (
                    grade_in_window >= 2.5
                    or (
                        before_alt_chunk
                        and after_alt_chunk
                        and (after_alt_chunk[-1] - before_alt_chunk[0]) >= 8.0
                    )
                ):
                    bp = StreamBreakpoint(
                        time_sec=int(t_now),
                        distance_km=round(d_now, 2),
                        kind="hill_surge",
                        headline=f"Fuorigiri da pendenza al minuto {min_mark}",
                        detail=(
                            f"Al min {min_mark} una salita ({grade_in_window:+.1f}%) ha fatto salire i battiti da {round(hr_before)} a {round(hr_after)} bpm. "
                            f"Lo sforzo sopra soglia ha innescato un debito che il corpo non è più riuscito a smaltire."
                        ),
                        before_metrics={
                            "hr": round(hr_before),
                            "pendenza": f"{grade_in_window:+.1f}%",
                        },
                        after_metrics={
                            "hr": round(hr_after),
                            "pendenza": "0.0%",
                        },
                    )
                    breakpoints.append(bp)
                    findings.append(
                        CausalFinding(
                            key="hill_surge",
                            category="salita",
                            confidence="alta",
                            evidence_badge="stream secondo-per-secondo",
                            title=f"Impennata cardiaca al minuto {min_mark} innescata da pendenza",
                            what_happened=(
                                f"In corrispondenza del km {d_now:.1f} il cuore è salito di +{round(delta_hr)} bpm rimanendo alto anche una volta tornati in piano."
                            ),
                            why_it_happened=(
                                f"La pendenza ({grade_in_window:+.1f}%) ha alzato bruscamente la richiesta di potenza. "
                                f"Invece di rallentare per mantenere costante l'impegno, hai mantenuto quasi la stessa velocità, "
                                f"passando in regime anaerobico da cui non sei più rientrato in tempo."
                            ),
                            how_to_improve=(
                                "Sulle salite (anche brevi del 2-3%), accorcia il passo e lascia calare il ritmo di 15-25\"/km: "
                                "lo sforzo percepito deve restare identico al piano, altrimenti accumuli lattato precoce."
                            ),
                            supporting_metrics=[
                                {
                                    "label": "Dislivello nel tratto",
                                    "value": (
                                        f"+{round(after_alt_chunk[-1] - before_alt_chunk[0])} m"
                                        if before_alt_chunk
                                        else "—"
                                    ),
                                },
                                {
                                    "label": "Battiti prima -> dopo",
                                    "value": (
                                        f"{round(hr_before)} → {round(hr_after)}"
                                        " bpm"
                                    ),
                                },
                            ],
                        )
                    )
                    i += min_elevated_window
                    continue

                # CHECK C: Pace surge (accelerazione/strappo di ritmo)
                if spd_before > 0 and (spd_after - spd_before) / spd_before >= 0.15:
                    bp = StreamBreakpoint(
                        time_sec=int(t_now),
                        distance_km=round(d_now, 2),
                        kind="hr_step_jump",
                        headline=f"Strappo di ritmo al minuto {min_mark}",
                        detail=f"Accelerazione netta da {format_pace(1000.0/spd_before)} a {format_pace(1000.0/spd_after)} che ha alzato la FC di +{round(delta_hr)} bpm.",
                        before_metrics={
                            "hr": round(hr_before),
                            "pace": format_pace(1000.0 / spd_before),
                        },
                        after_metrics={
                            "hr": round(hr_after),
                            "pace": format_pace(1000.0 / spd_after),
                        },
                    )
                    breakpoints.append(bp)
                    i += min_elevated_window
                    continue

        i += 30  # evaluate every 30 seconds

    if reliability is not None:
        for step in reliability.steps[:2]:
            breakpoints.append(_sensor_breakpoint(step, time_stream, dist_stream))
        if reliability.steps:
            findings.insert(0, _sensor_finding(reliability, hr_source))

    # -------------------------------------------------------------
    # 7. Mechanics & Pacing Breakdown (First Half vs Second Half vs Final Third)
    # -------------------------------------------------------------
    mid_idx = n // 2
    final_third_idx = int(n * 0.70)

    # First half metrics
    fh_speeds = [
        s for s in speeds[:mid_idx] if s is not None and s > 0.5
    ]
    sh_speeds = [
        s for s in speeds[mid_idx:] if s is not None and s > 0.5
    ]
    ft_speeds = [
        s for s in speeds[final_third_idx:] if s is not None and s > 0.5
    ]

    fh_pace_sec = (
        int(round(1000.0 / (sum(fh_speeds) / len(fh_speeds))))
        if fh_speeds
        else 0
    )
    sh_pace_sec = (
        int(round(1000.0 / (sum(sh_speeds) / len(sh_speeds))))
        if sh_speeds
        else 0
    )
    ft_pace_sec = (
        int(round(1000.0 / (sum(ft_speeds) / len(ft_speeds))))
        if ft_speeds
        else 0
    )

    fh_cads = [c for c in cadences[:mid_idx] if c is not None and c > 120]
    sh_cads = [c for c in cadences[mid_idx:] if c is not None and c > 120]
    ft_cads = [
        c for c in cadences[final_third_idx:] if c is not None and c > 120
    ]

    avg_cad_fh = round(sum(fh_cads) / len(fh_cads), 1) if fh_cads else None
    avg_cad_sh = round(sum(sh_cads) / len(sh_cads), 1) if sh_cads else None
    avg_cad_ft = round(sum(ft_cads) / len(ft_cads), 1) if ft_cads else None

    fh_strides = [st for st in stride_lengths[:mid_idx] if st is not None]
    sh_strides = [st for st in stride_lengths[mid_idx:] if st is not None]
    ft_strides = [
        st for st in stride_lengths[final_third_idx:] if st is not None
    ]

    avg_stride_fh = (
        round(sum(fh_strides) / len(fh_strides), 2) if fh_strides else None
    )
    avg_stride_sh = (
        round(sum(sh_strides) / len(sh_strides), 2) if sh_strides else None
    )
    avg_stride_ft = (
        round(sum(ft_strides) / len(ft_strides), 2) if ft_strides else None
    )

    fh_hrs = [h for h in hr_stream[:mid_idx] if h is not None and h > 30]
    sh_hrs = [h for h in hr_stream[mid_idx:] if h is not None and h > 30]
    ft_hrs = [
        h for h in hr_stream[final_third_idx:] if h is not None and h > 30
    ]

    avg_hr_fh = round(sum(fh_hrs) / len(fh_hrs), 0) if fh_hrs else None
    avg_hr_sh = round(sum(sh_hrs) / len(sh_hrs), 0) if sh_hrs else None
    avg_hr_ft = round(sum(ft_hrs) / len(ft_hrs), 0) if ft_hrs else None

    mechanics_summary = {
        "pace_fh": format_pace(fh_pace_sec),
        "pace_sh": format_pace(sh_pace_sec),
        "pace_ft": format_pace(ft_pace_sec),
        "cadence_fh": round(avg_cad_fh) if avg_cad_fh else None,
        "cadence_sh": round(avg_cad_sh) if avg_cad_sh else None,
        "cadence_ft": round(avg_cad_ft) if avg_cad_ft else None,
        "stride_fh_m": avg_stride_fh,
        "stride_sh_m": avg_stride_sh,
        "stride_ft_m": avg_stride_ft,
        "hr_fh": round(avg_hr_fh) if avg_hr_fh else None,
        "hr_sh": round(avg_hr_sh) if avg_hr_sh else None,
        "hr_ft": round(avg_hr_ft) if avg_hr_ft else None,
    }

    # CHECK D: Stride Degradation vs Cadence Drop
    if (
        fh_pace_sec > 0
        and ft_pace_sec > 0
        and avg_stride_fh
        and avg_stride_ft
        and avg_cad_fh
        and avg_cad_ft
    ):
        pace_slowdown_sec = ft_pace_sec - fh_pace_sec
        stride_delta_pct = (
            (avg_stride_ft - avg_stride_fh) / avg_stride_fh
        ) * 100.0
        cadence_delta = avg_cad_ft - avg_cad_fh

        # Case 1: Stride collapse with preserved cadence (Eccentric muscular fatigue)
        if (
            pace_slowdown_sec >= 10
            and stride_delta_pct <= -5.0
            and abs(cadence_delta) <= 3.5
        ):
            findings.append(
                CausalFinding(
                    key="stride_degradation",
                    category="meccanica",
                    confidence="alta",
                    evidence_badge="stream secondo-per-secondo",
                    title="Perdita di spinta nel finale: cedimento della falcata",
                    what_happened=(
                        f"Nel finale il passo è calato di +{pace_slowdown_sec} s/km ({format_pace(fh_pace_sec)} → {format_pace(ft_pace_sec)}). "
                        f"La cadenza è rimasta costante ({round(avg_cad_fh)} → {round(avg_cad_ft)} spm), ma la falcata si è accorciata da {avg_stride_fh:.2f} m a {avg_stride_ft:.2f} m ({stride_delta_pct:+.1f}%)."
                    ),
                    why_it_happened=(
                        "Non è mancato il fiato o la frequenza di passo: i muscoli propulsori (polpacci, quadricipiti e glutei) "
                        "hanno perso reattività elastica nella fase di spinta a terra a causa della fatica muscolare eccentrica cumulativa."
                    ),
                    how_to_improve=(
                        "Per proteggere la falcata nei chilometri finali: inserisci nei lunghi 3-4 tratti da 1 km al ritmo medio su gambe già stanche, "
                        "ed esegui allunghi in leggera salita (4 × 15\") due volte a settimana per potenziare la stiffness muscolo-tendinea."
                    ),
                    supporting_metrics=[
                        {
                            "label": "Lunghezza falcata",
                            "value": (
                                f"{avg_stride_fh:.2f} m → {avg_stride_ft:.2f}"
                                f" m ({stride_delta_pct:+.1f}%)"
                            ),
                        },
                        {
                            "label": "Cadenza passi",
                            "value": (
                                f"{round(avg_cad_fh)} spm →"
                                f" {round(avg_cad_ft)} spm (invariata)"
                            ),
                        },
                        {
                            "label": "Calo passo",
                            "value": f"+{pace_slowdown_sec} s/km nel finale",
                        },
                    ],
                )
            )

        # Case 2: Cadence drop (Neuromuscular fatigue)
        elif pace_slowdown_sec >= 12 and cadence_delta <= -5.0:
            findings.append(
                CausalFinding(
                    key="cadence_drop",
                    category="meccanica",
                    confidence="alta",
                    evidence_badge="stream secondo-per-secondo",
                    title="Affaticamento neuromuscolare: crollo della frequenza passi",
                    what_happened=(
                        f"Negli ultimi chilometri la cadenza è calata da {round(avg_cad_fh)} a {round(avg_cad_ft)} passi/min "
                        f"({cadence_delta:+.0f} spm), provocando un rallentamento di +{pace_slowdown_sec} s/km."
                    ),
                    why_it_happened=(
                        "Con l'aumentare della fatica il contatto al suolo si è allungato e la frequenza è calata. "
                        "L'atleta tende a 'sedersi' sull'appoggio anziché mantenere una transizione rapida del piede sotto il bacino."
                    ),
                    how_to_improve=(
                        "Quando avverti stanchezza nel finale di una seduta, concentra l'attenzione solo sul ritmo dei gomiti "
                        "e su passi rapidi e leggeri. Esegui 4 allunghi da 80 metri alla fine dei fondi lenti per mantenere attiva la coordinazione."
                    ),
                    supporting_metrics=[
                        {
                            "label": "Cadenza",
                            "value": (
                                f"{round(avg_cad_fh)} spm →"
                                f" {round(avg_cad_ft)} spm ({cadence_delta:+.0f}"
                                " spm)"
                            ),
                        },
                        {
                            "label": "Passo",
                            "value": (
                                f"{format_pace(fh_pace_sec)} →"
                                f" {format_pace(ft_pace_sec)}"
                            ),
                        },
                    ],
                )
            )

    # CHECK E: Metabolic Wall (Il Muro - Passo crolla e FC scende)
    if (
        duration_min >= 60.0
        and distance_km >= 12.0
        and fh_pace_sec > 0
        and ft_pace_sec > 0
        and avg_hr_fh
        and avg_hr_ft
    ):
        pace_slowdown_sec = ft_pace_sec - fh_pace_sec
        hr_change = avg_hr_ft - avg_hr_fh
        # If pace slows significantly (> 20 s/km) but HR actually falls (> 4 bpm)
        if pace_slowdown_sec >= 20 and hr_change <= -4.0:
            findings.append(
                CausalFinding(
                    key="metabolic_wall",
                    category="metabolica",
                    confidence="alta",
                    evidence_badge="stream secondo-per-secondo",
                    title="Segnale metabolico: calo simultaneo di ritmo e battiti",
                    what_happened=(
                        f"Nel finale il passo è peggiorato di +{pace_slowdown_sec} s/km ma la frequenza cardiaca è scesa da {round(avg_hr_fh)} a {round(avg_hr_ft)} bpm ({hr_change:+.0f} bpm)."
                    ),
                    why_it_happened=(
                        "Quando il passo crolla e il cuore scende anziché salire (l'opposto della normale deriva), "
                        "il corpo non ha più glicogeno da bruciare. La combustione esclusiva di lipidi non riesce ad alimentare "
                        "una richiesta di potenza elevata, 'spegnendo' la capacità del cuore di salire di giri."
                    ),
                    how_to_improve=(
                        "Cura l'assunzione di carboidrati durante la corsa (almeno 40-60 g/ora di carboidrati liquidi o gel dopo i primi 45') "
                        "e assicurati di fare il pieno di carboidrati nelle 24 ore prima delle sedute lunghe."
                    ),
                    supporting_metrics=[
                        {
                            "label": "Variazione passo finale",
                            "value": (
                                f"{format_pace(fh_pace_sec)} →"
                                f" {format_pace(ft_pace_sec)} (+{pace_slowdown_sec}"
                                " s/km)"
                            ),
                        },
                        {
                            "label": "Variazione battiti",
                            "value": (
                                f"{round(avg_hr_fh)} → {round(avg_hr_ft)} bpm"
                                f" ({hr_change:+.0f} bpm)"
                            ),
                        },
                    ],
                )
            )

    # CHECK F: Pacing Trap (La tassa dei primi km)
    # Check first 3km vs total workout
    early_km_pts = [i for i, d in enumerate(dist_stream) if d <= 3000.0]
    if early_km_pts and len(early_km_pts) >= 60 and distance_km >= 8.0:
        early_speeds = [
            speeds[idx]
            for idx in early_km_pts
            if speeds[idx] is not None and speeds[idx] > 0.5
        ]
        if early_speeds:
            early_pace_sec = int(
                round(1000.0 / (sum(early_speeds) / len(early_speeds)))
            )
            # If started > 15 s/km faster than global average, and final third slowed > 20 s/km
            if (
                avg_pace_sec - early_pace_sec >= 14
                and ft_pace_sec - avg_pace_sec >= 15
            ):
                cost_sec = ft_pace_sec - early_pace_sec
                findings.append(
                    CausalFinding(
                        key="pacing_trap",
                        category="pacing",
                        confidence="alta",
                        evidence_badge="stream secondo-per-secondo",
                        title="Partenza troppo rapida: la tassa dei primi chilometri",
                        what_happened=(
                            f"I primi 3 km sono stati corsi a {format_pace(early_pace_sec)}, molto più veloci della media ({avg_pace_fmt}). "
                            f"Nel finale il ritmo è calato a {format_pace(ft_pace_sec)} (un divario di {cost_sec} s/km)."
                        ),
                        why_it_happened=(
                            "Nei primi minuti il sistema cardiovascolare e metabolico ha una latenza di adattamento di 3-5 minuti: "
                            "correre troppo forte all'inizio accumula un debito di lattato precoce e consuma glicogeno prezioso che viene pagato a caro prezzo nel finale."
                        ),
                        how_to_improve=(
                            f"Nelle prossime uscite imponiti di percorrere i primi 2 km 10-15\"/km più lenti del ritmo target "
                            f"(almeno a {format_pace(avg_pace_sec + 10)}): una partenza conservativa consente una seconda metà in spinta."
                        ),
                        supporting_metrics=[
                            {
                                "label": "Passo primi 3 km",
                                "value": format_pace(early_pace_sec),
                            },
                            {
                                "label": "Passo medio seduta",
                                "value": avg_pace_fmt,
                            },
                            {
                                "label": "Passo finale",
                                "value": format_pace(ft_pace_sec),
                            },
                        ],
                    )
                )

    # -------------------------------------------------------------
    # 8. External Contextual Attribution (Wellness & Nutrition)
    # -------------------------------------------------------------
    vigilia_context: dict[str, Any] = {}
    if wellness:
        sleep_hours = (
            round(wellness["sleep_total_min"] / 60.0, 1)
            if wellness.get("sleep_total_min")
            else None
        )
        sleep_score = wellness.get("sleep_score")
        hrv_ms = wellness.get("hrv_ms")
        resting_hr = wellness.get("resting_hr")

        vigilia_context = {
            "sleep_hours": sleep_hours,
            "sleep_score": sleep_score,
            "hrv_ms": hrv_ms,
            "resting_hr": resting_hr,
        }

        # Correlate elevated HR with night biometrics
        if (
            resting_hr
            and baseline_rhr
            and (resting_hr - baseline_rhr) >= 4
            and avg_hr
        ):
            vigilia_context["rhr_elevated"] = True
            findings.append(
                CausalFinding(
                    key="elevated_rhr_vigilia",
                    category="fisiologica",
                    confidence="media",
                    evidence_badge="incrocio vigilia",
                    title="Frequenza cardiaca di base più alta per recupero notturno incompleto",
                    what_happened=(
                        f"La FC media della seduta ({avg_hr} bpm) è risultata superiore all'atteso. "
                        f"Nella notte la tua FC a riposo è stata di {resting_hr} bpm (+{int(resting_hr - baseline_rhr)} bpm rispetto alla tua media)."
                    ),
                    why_it_happened=(
                        "Il battito a riposo elevato al risveglio segnala che il sistema cardiovascolare stava ancora smaltendo "
                        "fatica cumulativa, stress metabolico o digestione pesante della sera prima."
                    ),
                    how_to_improve=(
                        "Quando noti la FC a riposo sopra la tua media abituale, non forzare i ritmi: accetta che il cuore sia 5-8 battiti più alto del solito "
                        "e mantieniti in Zona 1/2 senza rincorrere il cronometro."
                    ),
                    supporting_metrics=[
                        {
                            "label": "FC a riposo notte",
                            "value": (
                                f"{resting_hr} bpm (baseline:"
                                f" {round(baseline_rhr)} bpm)"
                            ),
                        },
                        {
                            "label": "Ore di sonno",
                            "value": f"{sleep_hours}h" if sleep_hours else "—",
                        },
                    ],
                )
            )

        if (
            hrv_ms
            and baseline_hrv
            and (baseline_hrv - hrv_ms) / baseline_hrv >= 0.18
        ):
            vigilia_context["hrv_suppressed"] = True
            findings.append(
                CausalFinding(
                    key="hrv_suppressed_vigilia",
                    category="fisiologica",
                    confidence="media",
                    evidence_badge="incrocio vigilia",
                    title="Tono parasimpatico depresso (HRV -18% sotto media)",
                    what_happened=(
                        f"L'HRV notturno registrato ({hrv_ms} ms) era sensibilmente inferiore alla tua baseline ({round(baseline_hrv)} ms)."
                    ),
                    why_it_happened=(
                        "Una caduta dell'HRV indica una prevalenza del sistema nervoso simpatico (stress, fatica sistemica o sonno disturbato), "
                        "rendendo il corpo meno resiliente e provocando una sensazione di gambe pesanti."
                    ),
                    how_to_improve=(
                        "Dedica 10 minuti di stretching e respirazione prima di dormire, e proteggi almeno 7h di riposo per favorire il recupero."
                    ),
                    supporting_metrics=[
                        {
                            "label": "HRV notturno",
                            "value": (
                                f"{hrv_ms} ms (baseline:"
                                f" {round(baseline_hrv)} ms)"
                            ),
                        }
                    ],
                )
            )

    # Nutrition check
    if (
        carbs_prev_day_g
        and carbs_target_g
        and carbs_prev_day_g < carbs_target_g * 0.75
        and duration_min >= 65.0
    ):
        vigilia_context["carbs_under_target"] = True
        findings.append(
            CausalFinding(
                key="carbs_depleted_vigilia",
                category="metabolica",
                confidence="media",
                evidence_badge="incrocio vigilia",
                title="Rifornimento incompleto: carboidrati sotto target prima del lungo",
                what_happened=(
                    f"Nelle 24 ore precedenti hai registrato {round(carbs_prev_day_g)} g di carboidrati contro un target di {round(carbs_target_g)} g per il carico previsto."
                ),
                why_it_happened=(
                    "Partire con le scorte epatiche e muscolari di glicogeno parzialmente scariche anticipa l'insorgenza della fatica "
                    "e costringe il corpo a consumare grassi precocemente, con conseguente deriva dei battiti cardiaci."
                ),
                how_to_improve=(
                    "Il giorno prima di una sessione superiore a 75 minuti, arricchisci i pasti con carboidrati complessi (pasta, riso, pane, patate)."
                ),
                supporting_metrics=[
                    {
                        "label": "Carboidrati registrati",
                        "value": (
                            f"{round(carbs_prev_day_g)} g /"
                            f" {round(carbs_target_g)} g target"
                        ),
                    }
                ],
            )
        )

    # -------------------------------------------------------------
    # 9. Distance-Based Splits / Segments (e.g. 5km blocks or halves)
    # -------------------------------------------------------------
    segments: list[WorkoutSegment] = []
    split_step_km = 5.0 if distance_km >= 12.0 else (2.0 if distance_km >= 4.0 else 1.0)
    current_start_m = 0.0

    while current_start_m < tot_dist_m:
        current_end_m = min(tot_dist_m, current_start_m + (split_step_km * 1000.0))
        seg_indices = [
            i
            for i, d in enumerate(dist_stream)
            if current_start_m <= d <= current_end_m
        ]
        if len(seg_indices) >= 20:
            t0 = time_stream[seg_indices[0]]
            t1 = time_stream[seg_indices[-1]]
            seg_dur_min = (t1 - t0) / 60.0
            seg_dist_km = (current_end_m - current_start_m) / 1000.0

            seg_spds = [
                speeds[idx]
                for idx in seg_indices
                if speeds[idx] is not None and speeds[idx] > 0.5
            ]
            seg_avg_spd = (
                sum(seg_spds) / len(seg_spds) if seg_spds else 0.0
            )
            seg_pace_sec = (
                int(round(1000.0 / seg_avg_spd)) if seg_avg_spd > 0 else 0
            )

            seg_hrs = [
                hr_stream[idx]
                for idx in seg_indices
                if hr_stream[idx] is not None and hr_stream[idx] > 30
            ]
            seg_avg_hr = (
                int(round(sum(seg_hrs) / len(seg_hrs))) if seg_hrs else None
            )

            seg_cads = [
                cadences[idx]
                for idx in seg_indices
                if cadences[idx] is not None and cadences[idx] > 120
            ]
            seg_avg_cad = (
                int(round(sum(seg_cads) / len(seg_cads))) if seg_cads else None
            )

            seg_strides = [
                stride_lengths[idx]
                for idx in seg_indices
                if stride_lengths[idx] is not None
            ]
            seg_avg_stride = (
                round(sum(seg_strides) / len(seg_strides), 2)
                if seg_strides
                else None
            )

            # Elevation gain
            seg_elev = 0.0
            for k in range(seg_indices[0] + 1, seg_indices[-1] + 1):
                a_prev = altitudes[k - 1]
                a_curr = altitudes[k]
                if a_prev is not None and a_curr is not None and a_curr > a_prev:
                    seg_elev += a_curr - a_prev

            s_km = round(current_start_m / 1000.0, 1)
            e_km = round(current_end_m / 1000.0, 1)
            segments.append(
                WorkoutSegment(
                    label=f"Km {s_km:.0f}–{e_km:.0f}",
                    start_km=s_km,
                    end_km=e_km,
                    duration_min=round(seg_dur_min, 1),
                    avg_pace_formatted=format_pace(seg_pace_sec),
                    avg_pace_sec=seg_pace_sec,
                    avg_hr=seg_avg_hr,
                    avg_cadence=seg_avg_cad,
                    avg_stride_m=seg_avg_stride,
                    elevation_gain_m=round(seg_elev, 1),
                )
            )

        current_start_m = current_end_m
        if current_end_m >= tot_dist_m:
            break

    race = race_analysis.analyze(
        streams, hr=hr_stream, reliability=reliability, level=level
    ) if sport_is_running(sport) else None

    # Determine status and headline
    sensor_only = bool(breakpoints) and all(b.kind == "cadence_lock" or b.kind == "hr_sensor_step" for b in breakpoints)
    if sensor_only and race is not None:
        # The run itself may have been a good one; the headline says both things.
        verdict_status = "anomalia_rilevata"
        lead = race["insights"][0]["title"] if race["insights"] else "Corsa completata"
        key = reliability.key_step if reliability is not None else None
        where = key.distance_km if key is not None and key.distance_km is not None else breakpoints[0].distance_km
        headline = f"{lead} — ma il battito dal km {where:.0f} non è affidabile"
    elif breakpoints:
        verdict_status = "anomalia_rilevata"
        headline = (
            f"Rilevata anomalia al minuto {int(round(breakpoints[0].time_sec/60.0))}: "
            f"{breakpoints[0].headline}"
        )
    elif findings:
        verdict_status = "da_rivedere"
        headline = findings[0].title
    else:
        verdict_status = "ottimo"
        headline = "Esecuzione solida ed equilibrata dall'inizio alla fine"

    summary_deterministic = (
        f"{distance_km} km a {avg_pace_fmt} medio in {duration_min:.0f} minuti."
    )
    if avg_hr:
        summary_deterministic += f" FC media {avg_hr} bpm."
    if breakpoints:
        summary_deterministic += f" {len(breakpoints)} punto di rottura individuato."

    return WorkoutAnalysisResult(
        activity_id=activity_id,
        date=date,
        title=title,
        sport=sport,
        duration_min=duration_min,
        distance_km=distance_km,
        avg_pace_formatted=avg_pace_fmt,
        avg_hr=avg_hr,
        verdict_status=verdict_status,
        headline=headline,
        summary_deterministic=summary_deterministic,
        breakpoints=breakpoints,
        findings=findings[:4],  # Top actionable findings
        segments=segments,
        mechanics_summary=mechanics_summary,
        vigilia_context=vigilia_context,
        hr_reliability=_reliability_dict(reliability, hr_source),
        race_analysis=race,
    )


def sport_is_running(sport: str | None) -> bool:
    key = (sport or "").lower()
    return "run" in key or key in intensity.RUNNING_SPORTS


def _reliability_dict(reliability: hr_reliability.HrReliability | None, hr_source: str | None) -> dict[str, Any] | None:
    if reliability is None:
        return None
    return {
        "verdict": reliability.verdict,
        "unreliable_from_s": reliability.unreliable_from_s,
        "unreliable_from_km": reliability.key_step.distance_km if reliability.key_step else None,
        "locked_share": reliability.locked_share,
        "dropout_share": reliability.dropout_share,
        "reasons": reliability.reasons,
        "hr_source": hr_source,
        "steps": [
            {
                "time_s": s.time_s,
                "distance_km": s.distance_km,
                "hr_before": s.hr_before,
                "hr_after": s.hr_after,
                "cadence_after": s.cadence_after,
                "pace_change_pct": s.pace_change_pct,
                "locked_to_cadence": s.locked_to_cadence,
            }
            for s in reliability.steps
        ],
    }


def _sensor_breakpoint(
    step: hr_reliability.SensorStep, time_stream: list[float], dist_stream: list[float]
) -> StreamBreakpoint:
    minute = int(round(step.time_s / 60.0))
    where = f"km {step.distance_km:.1f}" if step.distance_km is not None else f"minuto {minute}"
    if step.locked_to_cadence:
        return StreamBreakpoint(
            time_sec=step.time_s,
            distance_km=step.distance_km or 0.0,
            kind="cadence_lock",
            headline=f"Aggancio alla cadenza al {where}",
            detail=(
                f"Dal {where} il battito è passato da {step.hr_before} a {step.hr_after} bpm in pochi minuti, "
                f"a passo invariato ({step.pace_change_pct:+.1f}%), finendo sulla tua cadenza ({step.cadence_after} passi/min)."
            ),
            before_metrics={"hr": step.hr_before},
            after_metrics={"hr": step.hr_after, "cadence": step.cadence_after or "—"},
        )
    return StreamBreakpoint(
        time_sec=step.time_s,
        distance_km=step.distance_km or 0.0,
        kind="hr_sensor_step",
        headline=f"Salto del battito senza causa al {where}",
        detail=(
            f"Dal {where} il battito è passato da {step.hr_before} a {step.hr_after} bpm in pochi minuti "
            f"senza che cambiassero passo ({step.pace_change_pct:+.1f}%) o pendenza."
        ),
        before_metrics={"hr": step.hr_before},
        after_metrics={"hr": step.hr_after},
    )


def _sensor_finding(reliability: hr_reliability.HrReliability, hr_source: str | None) -> CausalFinding:
    step = reliability.key_step
    where = f"km {step.distance_km:.1f}" if step.distance_km is not None else f"minuto {round(step.time_s / 60)}"
    strap = hr_source == "chest_strap"
    if step.locked_to_cadence and not strap:
        why = (
            f"Al cuore non succede: a passo costante e in piano la frequenza sale di pochi battiti l'ora, non di "
            f"{step.hr_after - step.hr_before} in cinque minuti. Il sensore ottico al polso ha perso il segnale del sangue "
            f"e ha iniziato a contare i passi ({step.cadence_after} al minuto) come battiti: è il cosiddetto Cadence Lock. Succede più spesso col freddo, "
            "col cinturino lento o con il sudore."
        )
        how = (
            "Per le gare e i lunghi usa la fascia cardio. Con il solo orologio: cinturino stretto, due dita sopra "
            "l'osso del polso, e qualche minuto di riscaldamento prima della partenza."
        )
    elif strap:
        why = (
            "Con la fascia l'aggancio ai passi è raro: più spesso è il contatto degli elettrodi (pelle asciutta all'inizio, "
            "fascia che scivola) o la batteria scarica."
        )
        how = "Inumidisci gli elettrodi prima di partire, stringi la fascia sotto il petto e controlla la batteria."
    else:
        why = (
            "A passo e pendenza invariati il cuore non fa salti del genere: è molto più probabile un errore del sensore "
            "che uno sforzo vero."
        )
        how = "Confronta con una corsa fatta con la fascia cardio: se lì non succede, è il sensore dell'orologio."
    return CausalFinding(
        key="cadence_lock" if step.locked_to_cadence else "hr_sensor_step",
        category="sensore",
        confidence="alta" if step.locked_to_cadence else "media",
        evidence_badge="stream secondo-per-secondo",
        title=f"Il battito dal {where} non è affidabile",
        what_happened=(
            f"Dal {where} la frequenza è salita da {step.hr_before} a {step.hr_after} bpm in pochi minuti, "
            f"con il passo praticamente uguale ({step.pace_change_pct:+.1f}%)."
        ),
        why_it_happened=why,
        how_to_improve=how,
        supporting_metrics=[
            {"label": "Battito prima → dopo", "value": f"{step.hr_before} → {step.hr_after} bpm"},
            {"label": "Cadenza", "value": f"{step.cadence_after} passi/min" if step.cadence_after else "—"},
            {"label": "Variazione del passo", "value": f"{step.pace_change_pct:+.1f}%"},
            {"label": "Sensore", "value": {"chest_strap": "fascia cardio", "wrist": "polso"}.get(hr_source or "", "non noto")},
        ],
    )


def compute_workout_analysis(
    user_id: str,
    activity_id: int,
    zones: intensity.Zones | None = None,
    fallback_streams: dict[str, list[float | None]] | None = None,
    fallback_activity: dict[str, Any] | None = None,
) -> WorkoutAnalysisResult | None:
    """End-to-end analysis loading the activity, streams, wellness and nutrition."""
    activity = history.get_activity(user_id, activity_id) or fallback_activity
    if not activity:
        return None

    source = activity.get("source", "garmin")
    streams = history.load_workout_streams(user_id, source, activity_id) or fallback_streams
    if not streams or not streams.get("time"):
        return None

    act_day = activity["day"]
    if isinstance(act_day, str):
        act_date = date_type.fromisoformat(act_day)
    else:
        act_date = act_day

    # Load wellness on same day
    wellness_rows = history.wellness_between(user_id, act_date, act_date)
    wellness = wellness_rows[0] if wellness_rows else None

    # Load 30-day baseline for RHR & HRV
    past_wellness = history.wellness_between(
        user_id, act_date - timedelta(days=35), act_date - timedelta(days=1)
    )
    rhr_vals = [
        w["resting_hr"]
        for w in past_wellness
        if w.get("resting_hr") and w["resting_hr"] > 30
    ]
    baseline_rhr = sum(rhr_vals) / len(rhr_vals) if rhr_vals else None

    hrv_vals = [
        w["hrv_ms"]
        for w in past_wellness
        if w.get("hrv_ms") and w["hrv_ms"] > 10
    ]
    baseline_hrv = sum(hrv_vals) / len(hrv_vals) if hrv_vals else None

    # Load nutrition for previous day
    carbs_prev = None
    carbs_target = None
    try:
        prev_day = act_date - timedelta(days=1)
        prev_targets = nutrition.targets_for_day(user_id, prev_day)
        if prev_targets:
            carbs_target = float(prev_targets.carbs_target_g)
        day_meals = nutrition.get_meals_for_day(user_id, prev_day)
        if day_meals:
            carbs_prev = float(sum(m.carbs_g for m in day_meals))
    except Exception:
        pass

    level = 1
    try:
        level = int(history.load_profile(user_id)["reached_level"])
    except Exception:  # noqa: BLE001 - the analysis stands without the level; level 1 shows least
        pass

    return analyze_workout_streams(
        level=level,
        hr_source=activity.get("hr_source"),
        activity_id=activity_id,
        date=act_date,
        title=activity.get("title") or "Corsa",
        sport=activity.get("sport") or "running",
        streams=streams,
        zones=zones,
        wellness=wellness,
        baseline_hrv=baseline_hrv,
        baseline_rhr=baseline_rhr,
        carbs_prev_day_g=carbs_prev,
        carbs_target_g=carbs_target,
    )
