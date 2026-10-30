from training_plan import hr_reliability
from training_plan.garmin_sync import parse_hr_source


def _run(hr_at, *, seconds=90 * 60, dt=15, speed=2.7, cadence=86, speed_at=None, alt_at=None):
    """A flat steady run sampled like a Strava stream (one sample every `dt` s)."""
    times = list(range(0, seconds, dt))
    speeds = [speed_at(t) if speed_at else speed for t in times]
    dist, total = [], 0.0
    for i, t in enumerate(times):
        total += speeds[i] * (dt if i else 0)
        dist.append(total)
    return {
        "time": times,
        "heartrate": [hr_at(t) for t in times],
        "cadence": [cadence] * len(times),
        "velocity_smooth": speeds,
        "distance": dist,
        "altitude": [alt_at(t) if alt_at else 5.0 for t in times],
    }


def _ramp(t, start=50 * 60, length=4 * 60, low=148, high=170):
    if t < start:
        return low
    if t > start + length:
        return high
    return low + (high - low) * (t - start) / length


def test_gradual_rise_onto_cadence_at_steady_pace_is_a_cadence_lock():
    # The marathon of 2026-10-25: ~148 bpm, then +20 over four minutes at an unchanged
    # 6:10/km, landing on the 172 steps/min cadence.
    result = hr_reliability.assess(_run(lambda t: _ramp(t, high=171)))
    assert result.verdict == "inaffidabile"
    assert len(result.steps) == 1
    step = result.steps[0]
    assert step.locked_to_cadence
    assert 45 * 60 <= step.time_s <= 51 * 60
    assert step.hr_before == 148 and step.hr_after >= 168
    assert result.unreliable_from_s == step.time_s


def test_same_rise_away_from_cadence_is_only_dubious():
    result = hr_reliability.assess(_run(lambda t: _ramp(t, high=162), cadence=90))
    assert result.verdict == "dubbia"
    assert result.steps and not result.steps[0].locked_to_cadence


def test_steady_run_with_slow_drift_is_reliable():
    result = hr_reliability.assess(_run(lambda t: 140 + t / 3600 * 5))
    assert result.verdict == "affidabile"
    assert result.steps == []
    assert result.unreliable_from_s is None


def test_rise_that_comes_with_a_faster_pace_is_not_a_sensor_step():
    fast = lambda t: 3.3 if t >= 50 * 60 else 2.7
    result = hr_reliability.assess(_run(lambda t: _ramp(t, high=168), speed_at=fast))
    assert result.steps == []


def test_rise_on_a_climb_is_not_a_sensor_step():
    climb = lambda t: 5.0 + max(0, t - 46 * 60) * 0.15
    result = hr_reliability.assess(_run(lambda t: _ramp(t, high=165), alt_at=climb))
    assert result.steps == []


def test_warm_up_rise_is_ignored():
    result = hr_reliability.assess(_run(lambda t: _ramp(t, start=60, length=240, low=110, high=145)))
    assert result.steps == []


def test_long_dropouts_make_it_dubious():
    streams = _run(lambda t: 145)
    streams["heartrate"] = [None if 20 * 60 <= t < 35 * 60 else hr for t, hr in zip(streams["time"], streams["heartrate"])]
    result = hr_reliability.assess(streams)
    assert result.verdict == "dubbia"
    assert result.dropout_share > 0.1


def test_no_heart_rate_is_none():
    assert hr_reliability.assess({"time": [0, 1], "heartrate": []}) is None
    assert hr_reliability.assess(None) is None


def test_hr_source_from_paired_sensors():
    strap = {"metadataDTO": {"sensors": [{"sourceType": "ANTPLUS", "antplusDeviceType": "HEART_RATE"}]}}
    ble = {"metadataDTO": {"sensors": [{"sourceType": "BLUETOOTH_LOW_ENERGY", "bleDeviceType": "HEART_RATE"}]}}
    other = {"metadataDTO": {"sensors": [{"antplusDeviceType": "FOOT_POD"}]}}
    assert parse_hr_source(strap) == "chest_strap"
    assert parse_hr_source(ble) == "chest_strap"
    assert parse_hr_source(other) == "wrist"
    assert parse_hr_source({"metadataDTO": {"sensors": []}}) == "wrist"
    assert parse_hr_source({"metadataDTO": {}}) is None
    assert parse_hr_source(None) is None
