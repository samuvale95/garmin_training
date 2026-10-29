"""Unit tests for the workout root-cause analysis engine."""

from datetime import date
from training_plan.workout_analysis import (
    analyze_workout_streams,
    format_pace,
)
from training_plan.intensity import Zones


def test_format_pace():
    assert format_pace(300) == "5:00/km"
    assert format_pace(285) == "4:45/km"
    assert format_pace(0) == "—"
    assert format_pace(None) == "—"


def test_cadence_lock_detection_at_min_50():
    """Test the exact scenario: 50 minutes of controlled HR (~148 bpm), then a sudden jump of +20 bpm

    matching cadence (170 spm) at constant speed and flat elevation.
    """
    total_seconds = 3600  # 60 minutes
    times = [float(t) for t in range(total_seconds)]
    # Constant 5:00/km pace = 3.333 m/s
    speed = 3.333
    speeds = [speed] * total_seconds
    distances = [t * speed for t in times]
    # Cadence = 170 spm throughout
    cadences = [170.0] * total_seconds
    # Flat elevation
    altitudes = [50.0] * total_seconds

    # HR: 148 bpm for first 50 minutes (3000 seconds), then jumps to 171 bpm for remaining 10 minutes
    heartrates = []
    for t in times:
        if t < 3000:
            heartrates.append(148.0)
        else:
            heartrates.append(171.0)  # Locked onto cadence (170)

    streams = {
        "time": times,
        "distance": distances,
        "velocity_smooth": speeds,
        "cadence": cadences,
        "altitude": altitudes,
        "heartrate": heartrates,
    }

    zones = Zones.from_threshold(170)
    result = analyze_workout_streams(
        activity_id=101,
        date=date(2026, 10, 25),
        title="Maratona / Corsa Lunga",
        sport="running",
        streams=streams,
        zones=zones,
    )

    assert result.distance_km == 12.0
    assert result.duration_min == 60.0
    assert len(result.breakpoints) >= 1

    # Check that a cadence lock breakpoint was detected around min 50
    lock_bp = next((b for b in result.breakpoints if b.kind == "cadence_lock"), None)
    assert lock_bp is not None
    assert 48 <= int(round(lock_bp.time_sec / 60.0)) <= 52

    # Check finding
    lock_finding = next((f for f in result.findings if f.key == "cadence_lock"), None)
    assert lock_finding is not None
    assert lock_finding.category == "sensore"
    assert "Cadence Lock" in lock_finding.why_it_happened
    assert "fascia cardio" in lock_finding.how_to_improve


def test_stride_degradation_fatigue():
    """Test mechanic fatigue: pace slows in the final third because stride length collapses

    while cadence stays high (muscular/elastic fatigue).
    """
    total_seconds = 3600
    times = [float(t) for t in range(total_seconds)]
    speeds = []
    cadences = []
    distances = []
    altitudes = [10.0] * total_seconds
    heartrates = [155.0] * total_seconds

    d = 0.0
    for t in times:
        if t < 2400:  # First 40 min: 4:30/km = 3.70 m/s, cadence 175 spm -> stride 1.27 m
            s = 3.70
            c = 175.0
        else:  # Final 20 min: 5:00/km = 3.33 m/s, cadence still 175 spm -> stride 1.14 m (-10%)
            s = 3.33
            c = 175.0
        speeds.append(s)
        cadences.append(c)
        d += s
        distances.append(d)

    streams = {
        "time": times,
        "distance": distances,
        "velocity_smooth": speeds,
        "cadence": cadences,
        "altitude": altitudes,
        "heartrate": heartrates,
    }

    result = analyze_workout_streams(
        activity_id=102,
        date=date(2026, 10, 26),
        title="Lungo Qualificato",
        sport="running",
        streams=streams,
    )

    stride_finding = next((f for f in result.findings if f.key == "stride_degradation"), None)
    assert stride_finding is not None
    assert stride_finding.category == "meccanica"
    assert "falcata" in stride_finding.title.lower()
    assert "spinta" in stride_finding.why_it_happened.lower()


def test_metabolic_wall_detection():
    """In a 20 km long run, pace collapses in the final 4 km AND heart rate drops

    (depletion of glycogen / metabolic wall).
    """
    total_seconds = 6000  # 100 min
    times = [float(t) for t in range(total_seconds)]
    speeds = []
    cadences = [170.0] * total_seconds
    distances = []
    altitudes = [20.0] * total_seconds
    heartrates = []

    d = 0.0
    for t in times:
        if t < 4500:  # First 75 min: 4:45/km = 3.51 m/s, HR 158 bpm
            s = 3.51
            hr = 158.0
        else:  # Final 25 min: 5:25/km = 3.08 m/s, HR drops to 148 bpm (fuel empty)
            s = 3.08
            hr = 148.0
        speeds.append(s)
        heartrates.append(hr)
        d += s
        distances.append(d)

    streams = {
        "time": times,
        "distance": distances,
        "velocity_smooth": speeds,
        "cadence": cadences,
        "altitude": altitudes,
        "heartrate": heartrates,
    }

    result = analyze_workout_streams(
        activity_id=103,
        date=date(2026, 10, 27),
        title="30 km Maratona",
        sport="running",
        streams=streams,
    )

    wall_finding = next((f for f in result.findings if f.key == "metabolic_wall"), None)
    assert wall_finding is not None
    assert wall_finding.category == "metabolica"
    assert "glicogeno" in wall_finding.why_it_happened.lower()


def test_pacing_trap():
    """First 3 km run 25 s/km faster than average, leading to late struggle."""
    total_seconds = 3600
    times = [float(t) for t in range(total_seconds)]
    speeds = []
    cadences = [170.0] * total_seconds
    distances = []
    altitudes = [10.0] * total_seconds
    heartrates = [160.0] * total_seconds

    d = 0.0
    for t in times:
        if d < 3000:  # Fast start: 4:30/km = 3.70 m/s
            s = 3.70
        elif t < 2600:  # Middle: 5:00/km = 3.33 m/s
            s = 3.33
        else:  # Final: 5:35/km = 2.98 m/s
            s = 2.98
        speeds.append(s)
        d += s
        distances.append(d)

    streams = {
        "time": times,
        "distance": distances,
        "velocity_smooth": speeds,
        "cadence": cadences,
        "altitude": altitudes,
        "heartrate": heartrates,
    }

    result = analyze_workout_streams(
        activity_id=104,
        date=date(2026, 10, 28),
        title="Gara 10K",
        sport="running",
        streams=streams,
    )

    trap_finding = next((f for f in result.findings if f.key == "pacing_trap"), None)
    assert trap_finding is not None
    assert trap_finding.category == "pacing"
    assert "partenza troppo rapida" in trap_finding.title.lower()
