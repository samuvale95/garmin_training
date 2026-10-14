from dataclasses import replace
from datetime import date, timedelta

import pytest

from training_plan import race_prediction as rp
from training_plan.models import RaceGoal, Step, TrainingSession

TODAY = date(2026, 9, 20)  # a Sunday
RACE_DATE = date(2026, 10, 25)  # five weeks out

GOAL_MARATHON = RaceGoal(
    name="Maratona di Venezia",
    race_date=RACE_DATE,
    distance_km=42.195,
    target_time_seconds=12600,  # 3:30:00
)


def run(days_ago: int, km: float, minutes: float, title: str = "Corsa", hr: int | None = 150) -> dict:
    return {
        "activity_id": 1000 + days_ago,
        "day": (TODAY - timedelta(days=days_ago)).isoformat(),
        "sport": "running",
        "title": title,
        "distance_km": km,
        "duration_min": minutes,
        "avg_hr": hr,
    }


def planned(days_from_today: int, km: float, title: str = "Corsa") -> TrainingSession:
    return TrainingSession(
        date=TODAY + timedelta(days=days_from_today),
        sport="running",
        title=title,
        steps=[Step(type="interval", duration_type="distance", duration_value=km)],
    )


def goal(**over) -> RaceGoal:
    return replace(GOAL_MARATHON, **over)


# A 15 km at 4:40/km projects to a marathon of about 3:28.
QUALITY = [run(14, 15.0, 70.0, "Medio 15k", 158), run(7, 30.0, 160.0, "Lungo 30k", 142)]


def test_riegel_formula():
    # 10 km in 45 min -> marathon of about 3h27
    t = rp.calculate_riegel_time(10.0, 2700.0, 42.195)
    assert 12000 <= t <= 13000


@pytest.mark.parametrize(
    ("gap", "band"),
    [(-0.05, rp.BAND_AHEAD), (-0.01, rp.BAND_AHEAD), (0.0, rp.BAND_ON_TRACK), (0.02, rp.BAND_ON_TRACK),
     (0.04, rp.BAND_AMBITIOUS), (0.06, rp.BAND_AMBITIOUS), (0.061, rp.BAND_OUT_OF_REACH)],
)
def test_the_band_is_the_gap_and_nothing_else(gap, band):
    assert rp.band_for_gap(gap) == band


def test_no_hard_effort_means_no_prediction_and_no_band():
    res = rp.assess_race_prediction([run(5, 3.0, 20.0, "Trotto", 125)], GOAL_MARATHON, today=TODAY)
    assert res.status == rp.STATUS_NO_DATA
    assert res.predicted_time_seconds is None
    assert res.band is None
    assert any(f.key == "no_efforts" for f in res.factors)
    assert res.headline == "Non ho una prestazione recente su cui basarmi"
    assert "riferimento" in res.summary


def test_without_an_effort_vo2max_is_offered_only_as_a_weak_estimate():
    res = rp.assess_race_prediction([run(5, 3.0, 20.0)], GOAL_MARATHON, today=TODAY, vo2max=50.0)
    assert res.predicted_time_seconds is None
    assert res.band is None
    assert res.vo2max_time_seconds is not None
    assert "debole" in res.summary


def test_a_prediction_close_to_the_target_is_in_line():
    res = rp.assess_race_prediction(QUALITY, GOAL_MARATHON, today=TODAY)
    assert res.status == rp.STATUS_ASSESSED
    assert 12000 <= res.predicted_time_seconds <= 13000
    assert res.reference_effort.distance_km == 15.0
    assert res.prediction_basis == "dal tuo Medio 15k del 6 settembre"
    assert res.gap_seconds == res.predicted_time_seconds - 12600
    assert res.band == rp.band_for_gap(res.gap_pct)
    assert res.band in (rp.BAND_AHEAD, rp.BAND_ON_TRACK)
    assert res.longest_completed_km == 30.0


def test_a_far_target_is_out_of_reach():
    res = rp.assess_race_prediction(QUALITY, goal(target_time_seconds=10800), today=TODAY)  # 3:00
    assert res.band == rp.BAND_OUT_OF_REACH
    assert res.band_label == "Fuori portata a questo ritmo"


def test_low_session_adherence_drops_one_band():
    # Ten planned runs in the last six weeks, only the two quality ones done.
    plan = [planned(-d, 10.0) for d in (40, 37, 33, 30, 26, 23, 19, 16, 12, 9)]
    plan += [planned(-14, 15.0, "Medio 15k"), planned(-7, 30.0, "Lungo 30k")]
    base = rp.assess_race_prediction(QUALITY, GOAL_MARATHON, today=TODAY)
    res = rp.assess_race_prediction(QUALITY, GOAL_MARATHON, planned_sessions=plan, today=TODAY)
    assert res.adherence.sessions_planned == 12
    assert res.adherence.sessions_done == 2
    assert res.band_lowered
    assert rp.BANDS.index(res.band) == rp.BANDS.index(base.band) + 1
    assert "abbassato il giudizio" in res.summary


def test_a_run_a_day_off_the_plan_still_counts():
    plan = [planned(-15, 15.0), planned(-7, 30.0)]  # the medio was run a day later
    res = rp.assess_race_prediction(QUALITY, GOAL_MARATHON, planned_sessions=plan, today=TODAY)
    assert res.adherence.sessions_done == 2
    assert res.adherence.km_planned == 45.0
    assert res.adherence.km_done == 45.0
    assert not res.band_lowered


def test_todays_session_is_not_missed_yet():
    res = rp.assess_race_prediction(QUALITY, GOAL_MARATHON, planned_sessions=[planned(0, 10.0)], today=TODAY)
    assert res.adherence.sessions_planned == 0


def test_far_from_the_race_the_wording_softens():
    far = goal(race_date=TODAY + timedelta(weeks=20))
    res = rp.assess_race_prediction(QUALITY, far, today=TODAY)
    assert res.softened
    assert "settimane" in res.summary
    near = rp.assess_race_prediction(QUALITY, GOAL_MARATHON, today=TODAY)
    assert not near.softened


def test_no_target_time_means_no_band_but_the_inputs_stay():
    res = rp.assess_race_prediction(QUALITY, goal(target_time_seconds=None), today=TODAY)
    assert res.status == rp.STATUS_NO_TARGET
    assert res.band is None
    assert res.predicted_time_seconds is not None
    assert res.risk.signals


def test_runs_and_vo2max_that_disagree_become_a_range():
    res = rp.assess_race_prediction(QUALITY, GOAL_MARATHON, today=TODAY, vo2max=40.0)  # ~3:58
    assert res.predicted_low_seconds is not None and res.predicted_high_seconds is not None
    assert res.predicted_low_seconds < res.predicted_time_seconds < res.predicted_high_seconds
    assert any(f.key == "vo2max" and f.severity == rp.SEVERITY_WATCH for f in res.factors)


def test_runs_and_vo2max_that_agree_stay_a_single_time():
    riegel = int(round(rp.calculate_riegel_time(15.0, 70 * 60, 42.195)))
    vo2 = (25700 - riegel) / 286  # the VO2max whose marathon equals the Riegel figure
    res = rp.assess_race_prediction(QUALITY, GOAL_MARATHON, today=TODAY, vo2max=vo2)
    assert res.predicted_low_seconds is None
    assert res.predicted_time_seconds == riegel


def test_a_sudden_jump_in_load_is_a_risk():
    steady = [run(d, 8.0, 45.0) for d in range(8, 29, 2)]
    spike = [run(d, 12.0, 70.0) for d in range(0, 7)]
    res = rp.assess_race_prediction(steady + spike + QUALITY, GOAL_MARATHON, today=TODAY)
    acwr = next(s for s in res.risk.signals if s.key == "acwr")
    assert res.risk.acwr > 1.3
    assert acwr.severity == rp.SEVERITY_WATCH


def test_a_low_load_in_the_last_three_weeks_is_the_taper():
    old = [run(d, 15.0, 80.0) for d in range(8, 29, 2)]
    res = rp.assess_race_prediction(old + [run(2, 15.0, 70.0, "Medio")], goal(race_date=TODAY + timedelta(days=10)), today=TODAY)
    acwr = next(s for s in res.risk.signals if s.key == "acwr")
    assert res.risk.acwr < 0.8
    assert acwr.severity == rp.SEVERITY_OK


def test_falling_readiness_is_a_risk():
    wellness = [{"day": TODAY - timedelta(days=d), "readiness_score": 45 if d < 7 else 70} for d in range(14)]
    res = rp.assess_race_prediction(QUALITY, GOAL_MARATHON, today=TODAY, wellness=wellness)
    assert res.risk.readiness_recent == 45 and res.risk.readiness_previous == 70
    trend = next(s for s in res.risk.signals if s.key == "readiness_trend")
    assert trend.severity == rp.SEVERITY_WATCH


def test_the_ramp_to_the_peak_week():
    # 20 km a week now; the plan peaks at 40 km three weeks from now.
    recent = [run(d, 10.0, 55.0) for d in (3, 6, 10, 13, 17, 20, 24, 27)]
    peak_monday = TODAY + timedelta(days=1 + 14)
    plan = [TrainingSession(date=peak_monday + timedelta(days=i), sport="running", title="Corsa",
                            steps=[Step(type="interval", duration_type="distance", duration_value=10.0)]) for i in range(4)]
    parsed = rp._runs(recent, TODAY - timedelta(days=60), TODAY)
    ramp, current, peak = rp.required_ramp_pct(parsed, plan, TODAY, RACE_DATE)
    assert current == 20.0 and peak == 40.0
    # three weeks to double: (2 ** (1/3) - 1) = 26%
    assert ramp == pytest.approx(26.0, abs=0.1)
    res = rp.assess_race_prediction(recent, GOAL_MARATHON, planned_sessions=plan, today=TODAY)
    assert next(s for s in res.risk.signals if s.key == "ramp").severity == rp.SEVERITY_WATCH


def test_risk_level_counts_the_flags():
    res = rp.assess_race_prediction(QUALITY, GOAL_MARATHON, today=TODAY)
    flagged = sum(1 for s in res.risk.signals if s.severity == rp.SEVERITY_WATCH)
    expected = {0: rp.RISK_LOW, 1: rp.RISK_MODERATE}.get(flagged, rp.RISK_HIGH)
    if all(s.severity == rp.SEVERITY_UNKNOWN for s in res.risk.signals):
        expected = rp.RISK_UNKNOWN
    assert res.risk.level == expected


def test_the_model_is_told_the_decision_not_the_data():
    res = rp.assess_race_prediction(QUALITY, GOAL_MARATHON, today=TODAY)
    facts = rp.prediction_facts(res, GOAL_MARATHON)
    assert facts["fascia"] == res.band_label
    assert facts["frase_di_riferimento"] == res.summary
    assert "activity_id" not in str(facts)


def test_durations_read_like_race_times():
    assert rp.format_duration(12605) == "3:30:05"
    assert rp.format_duration(2890) == "48:10"


def test_a_range_is_judged_on_its_slower_end():
    # VO2max 60 says ~2:38, the runs say ~3:28: a target of 3:15 sits inside the range.
    res = rp.assess_race_prediction(QUALITY, goal(target_time_seconds=11700), today=TODAY, vo2max=60.0)
    assert res.predicted_low_seconds < 11700 < res.predicted_high_seconds
    assert res.gap_seconds == res.predicted_high_seconds - 11700
    assert res.band == rp.BAND_OUT_OF_REACH
