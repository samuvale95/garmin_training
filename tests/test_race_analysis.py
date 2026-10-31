from datetime import date

from training_plan import hr_reliability, race_analysis, workout_analysis


def _marathon(*, pace_at=lambda km: 370.0, hr_at=lambda t, km: 145.0, cadence=86, dt=5, alt_at=lambda km: 5.0):
    """A 42.2 km run sampled every `dt` s; `pace_at` gives s/km at each km."""
    times, dists, speeds, hrs, alts = [], [], [], [], []
    t, d = 0.0, 0.0
    while d < 42195:
        km = d / 1000
        v = 1000 / pace_at(km)
        times.append(t)
        dists.append(d)
        speeds.append(v)
        hrs.append(hr_at(t, km))
        alts.append(alt_at(km))
        t += dt
        d += v * dt
    return {"time": times, "distance": dists, "velocity_smooth": speeds, "heartrate": hrs,
            "cadence": [cadence] * len(times), "altitude": alts}


def _analyze(streams, level=1):
    rel = hr_reliability.assess(streams)
    return race_analysis.analyze(streams, hr=streams["heartrate"], reliability=rel, level=level)


def test_even_marathon_is_read_as_even_with_no_wall():
    res = _analyze(_marathon())
    assert res["is_marathon"]
    assert res["halves"]["kind"] == "pari"
    assert res["fade"]["kind"] == "tenuta"
    assert len(res["km_splits"]) == 42
    assert len(res["splits_5k"]) == 9
    assert res["consistency"]["rating"] == "ottima"
    assert res["decoupling"]["available"] and res["decoupling"]["pct"] < 1


def test_wall_after_km_30_is_found():
    res = _analyze(_marathon(pace_at=lambda km: 360.0 if km < 30 else 420.0), level=2)
    assert res["fade"]["kind"] == "muro"
    assert res["halves"]["kind"] in ("positivo", "crollo")
    assert any("muro" in i["title"].lower() for i in res["insights"])


def test_negative_split_is_praised():
    res = _analyze(_marathon(pace_at=lambda km: 375.0 if km < 21.1 else 365.0))
    assert res["halves"]["kind"] == "negativo"
    assert res["insights"][0]["tone"] == "good"


def test_decoupling_is_withheld_when_the_sensor_locked():
    def hr(t, km):
        return 148.0 if t < 3000 else 148.0 + min(1.0, (t - 3000) / 240) * 24
    res = _analyze(_marathon(hr_at=hr), level=3)
    assert res["decoupling"]["available"] is False
    assert any("non affidabile" in i["title"] for i in res["insights"])


def test_level_decides_what_is_shown_first():
    streams = _marathon()
    assert "km_splits" not in _analyze(streams, level=1)["visible_sections"]
    assert "km_splits" in _analyze(streams, level=2)["visible_sections"]
    assert "patterns" in _analyze(streams, level=3)["visible_sections"]
    assert len(_analyze(streams, level=1)["insights"]) <= 3


def test_short_run_has_no_race_analysis():
    streams = _marathon()
    cut = next(i for i, d in enumerate(streams["distance"]) if d > 5000)
    short = {k: v[:cut] for k, v in streams.items()}
    assert _analyze(short) is None


def test_workout_analysis_says_good_race_but_unreliable_heart_rate():
    def hr(t, km):
        return 148.0 if t < 3000 else 148.0 + min(1.0, (t - 3000) / 240) * 24
    streams = _marathon(hr_at=hr, pace_at=lambda km: 372.0 if km < 21.1 else 366.0)
    res = workout_analysis.analyze_workout_streams(
        activity_id=1, date=date(2026, 10, 25), title="Maratona", sport="running", streams=streams, level=1,
    )
    assert res.verdict_status == "anomalia_rilevata"
    assert "non è affidabile" in res.headline
    assert res.hr_reliability["verdict"] == "inaffidabile"
    assert 7 <= res.hr_reliability["unreliable_from_km"] <= 9
    assert res.race_analysis["halves"]["kind"] == "negativo"
    # Splits after the lock carry no heart rate rather than a wrong one.
    assert res.race_analysis["splits_5k"][-1]["hr"] is None
    assert res.findings[0].key == "cadence_lock"
