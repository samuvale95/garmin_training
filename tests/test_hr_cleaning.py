import pytest
from training_plan.hr_cleaning import clean_heart_rate_stream


def test_empty_stream():
    res = clean_heart_rate_stream([])
    assert res.quality == "alta"
    assert res.valid_ratio == 1.0
    assert res.cleaned_heart_rates == []


def test_clean_stream_passes_unaltered():
    raw = [140.0, 141.0, 142.0, 143.0, 142.0, 141.0]
    res = clean_heart_rate_stream(raw)
    assert res.quality == "alta"
    assert res.valid_ratio == 1.0
    assert res.spikes_detected == 0
    assert res.cleaned_heart_rates == raw


def test_isolated_spike_is_interpolated():
    # Runner is at ~140 bpm, suddenly spikes to 215 bpm for 2 seconds, returns to 142
    raw = [140.0, 140.0, 215.0, 214.0, 142.0, 142.0]
    res = clean_heart_rate_stream(raw)
    assert res.spikes_detected == 1
    # Samples 2 and 3 should be interpolated between 140 and 142
    assert res.cleaned_heart_rates[2] == pytest.approx(140.7, abs=0.5)
    assert res.cleaned_heart_rates[3] == pytest.approx(141.3, abs=0.5)
    assert max(res.cleaned_heart_rates) < 150.0


def test_physiological_sprint_acceleration_not_flagged_when_speed_increases():
    # Heart rate climbs rapidly because speed increased by >30%
    raw = [135.0, 142.0, 150.0, 160.0, 168.0]
    speeds = [2.5, 3.8, 4.0, 4.2, 4.2]  # Surge from 2.5 m/s to 3.8+ m/s
    res = clean_heart_rate_stream(raw, speeds=speeds)
    assert res.spikes_detected == 0
    assert res.cleaned_heart_rates == raw


def test_cadence_lock_detection():
    # Optical sensor locks to 175 spm cadence for 25 seconds while running at 140 bpm
    raw = [140.0] * 5 + [175.0] * 25 + [142.0] * 5
    cadences = [175.0] * 35
    speeds = [3.0] * 35  # Constant speed
    res = clean_heart_rate_stream(raw, cadences=cadences, speeds=speeds)
    assert res.cadence_lock_seconds >= 20
    # Locked values should be filtered out
    assert res.cleaned_heart_rates[10] is None


def test_unphysiological_extreme_values_filtered():
    # Values below 35 or above 215 (e.g. sensor malfunction reporting 235 or 12)
    raw = [140.0, 240.0, 20.0, 142.0]
    res = clean_heart_rate_stream(raw)
    assert res.cleaned_heart_rates[1] != 240.0
    assert res.cleaned_heart_rates[2] != 20.0


def test_quality_rating():
    # Stream with > 30% bad values should report 'bassa' quality
    raw = [140.0] * 50 + [230.0] * 30 + [140.0] * 20
    res = clean_heart_rate_stream(raw)
    assert res.quality == "bassa"
    assert res.valid_ratio < 0.80
