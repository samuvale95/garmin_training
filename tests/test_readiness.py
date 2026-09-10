"""The day's verdict is the one place in this app that can tell someone not to train.

So these tests pin down the three things that would make that harmful: that a good
morning is never turned into a warning, that a bad one is never waved through, and that
"do something else instead" changes with how close the race is -- an easy day costs
nothing in July and costs the taper in November.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from training_plan import readiness
from training_plan.body_insights import BodySnapshot, SleepPhases
from training_plan.models import RaceGoal, RepeatBlock, Step, TrainingSession

TODAY = date(2026, 9, 10)


def _snapshot(**overrides) -> BodySnapshot:
    """A rested, unremarkable morning -- every test starts here and breaks one thing."""
    base = dict(
        date=TODAY,
        has_overnight_data=True,
        readiness_score=78,
        readiness_message=None,
        sleep=SleepPhases(deep_minutes=90, light_minutes=250, rem_minutes=90, awake_minutes=15, total_minutes=445),
        hrv_last_night_ms=60,
        hrv_seven_day=[(TODAY - timedelta(days=6 - i), 60) for i in range(7)],
        resting_heart_rate=48,
        resting_heart_rate_delta=0,
        battery_percent=82,
        stress_level=24,
    )
    base.update(overrides)
    return BodySnapshot(**base)


def _hrv_series(last_night: int, baseline: int = 60) -> list[tuple[date, int]]:
    return [(TODAY - timedelta(days=6 - i), baseline) for i in range(6)] + [(TODAY, last_night)]


REPEATS = TrainingSession(
    date=TODAY,
    sport="running",
    title="Ripetute 6 × 1000",
    steps=[
        Step(type="warmup", duration_type="time", duration_value=15),
        RepeatBlock(reps=6, steps=[Step(type="interval", duration_type="distance", duration_value=1.0)]),
    ],
)
EASY = TrainingSession(
    date=TODAY,
    sport="running",
    title="Corsa facile 35'",
    steps=[Step(type="interval", duration_type="time", duration_value=35)],
)
LONG = TrainingSession(
    date=TODAY,
    sport="running",
    title="Lungo 20 km",
    steps=[Step(type="interval", duration_type="distance", duration_value=20.0)],
)


def _marathon(days_out: int) -> RaceGoal:
    return RaceGoal(race_date=TODAY + timedelta(days=days_out), distance_km=42.195, name="Una maratona")


# ---- reading the morning ------------------------------------------------------------


def test_a_good_morning_produces_no_signals_and_no_alternative():
    verdict = readiness.assess_day(_snapshot(), REPEATS, today=TODAY)
    assert verdict.state == readiness.STATE_READY
    assert verdict.signals == []
    assert verdict.action == readiness.ACTION_CONFIRM
    assert verdict.alternative is None


def test_each_signal_carries_the_number_that_produced_it():
    """A signal the user cannot check against their watch is a signal taken on faith."""
    verdict = readiness.assess_day(_snapshot(hrv_last_night_ms=46, hrv_seven_day=_hrv_series(46)), EASY, today=TODAY)
    hrv = next(s for s in verdict.signals if s.key == "hrv")
    assert "46 ms" in hrv.detail
    assert "-23%" in hrv.detail


def test_a_small_hrv_dip_is_not_a_signal():
    """Overnight HRV wanders by a few percent for no reason; only a real drop counts."""
    verdict = readiness.assess_day(_snapshot(hrv_last_night_ms=57, hrv_seven_day=_hrv_series(57)), REPEATS, today=TODAY)
    assert verdict.state == readiness.STATE_READY


def test_one_moderate_signal_is_caution_not_a_stop():
    verdict = readiness.assess_day(_snapshot(sleep=SleepPhases(None, None, None, None, 340)), REPEATS, today=TODAY)
    assert verdict.state == readiness.STATE_CAUTIOUS
    assert verdict.action == readiness.ACTION_SOFTEN


def test_several_signals_at_once_is_a_body_saying_the_same_thing_twice():
    verdict = readiness.assess_day(
        _snapshot(
            hrv_last_night_ms=45,
            hrv_seven_day=_hrv_series(45),
            resting_heart_rate=56,
            resting_heart_rate_delta=8,
            readiness_score=34,
        ),
        REPEATS,
        today=TODAY,
    )
    assert verdict.state == readiness.STATE_DEPLETED
    assert len(verdict.signals) >= 3


def test_a_heavy_recent_load_counts_even_after_a_good_night():
    verdict = readiness.assess_day(_snapshot(), REPEATS, acute_chronic_ratio=1.6, today=TODAY)
    assert verdict.state == readiness.STATE_CAUTIOUS
    assert any(s.key == "carico" for s in verdict.signals)


def test_no_overnight_data_produces_no_verdict_at_all():
    """A guess dressed as a readout is worse than a blank."""
    verdict = readiness.assess_day(_snapshot(has_overnight_data=False), REPEATS, today=TODAY)
    assert verdict.state == readiness.STATE_UNKNOWN
    assert verdict.has_data is False
    assert verdict.alternative is None
    assert verdict.signals == []


def test_missing_fields_narrow_the_reading_instead_of_breaking_it():
    """Garmin's fields are undocumented and go null; every one of them is optional."""
    verdict = readiness.assess_day(
        _snapshot(readiness_score=None, stress_level=None, battery_percent=None, resting_heart_rate_delta=None),
        EASY,
        today=TODAY,
    )
    assert verdict.state == readiness.STATE_READY


# ---- what the session asks ----------------------------------------------------------


@pytest.mark.parametrize(
    "session,expected",
    [
        (REPEATS, readiness.DEMAND_HARD),
        (LONG, readiness.DEMAND_HARD),
        (EASY, readiness.DEMAND_EASY),
        (None, readiness.DEMAND_REST),
    ],
)
def test_session_demand(session, expected):
    assert readiness.session_demand(session) == expected


def test_a_session_with_no_steps_is_not_treated_as_nothing():
    """A live Garmin calendar entry carries only a title. Unknown is not easy."""
    bare = TrainingSession(date=TODAY, sport="running", title="Allenamento", steps=[])
    assert readiness.session_demand(bare) == readiness.DEMAND_MODERATE


# ---- what to do instead, and how the race changes it --------------------------------


def _rough_morning() -> BodySnapshot:
    return _snapshot(
        hrv_last_night_ms=45,
        hrv_seven_day=_hrv_series(45),
        resting_heart_rate=56,
        resting_heart_rate_delta=8,
        readiness_score=34,
    )


def test_far_from_the_race_a_hard_session_becomes_an_easy_one():
    verdict = readiness.assess_day(_rough_morning(), REPEATS, goal=_marathon(70), today=TODAY)
    assert verdict.phase == "costruzione"
    assert verdict.alternative.kind == "easy"


def test_close_to_the_race_the_same_session_is_moved_rather_than_lost():
    """In `picco` that session is the point of the week: postpone it, don't drop it."""
    verdict = readiness.assess_day(_rough_morning(), REPEATS, goal=_marathon(20), today=TODAY)
    assert verdict.phase == "picco"
    assert verdict.alternative.kind == "reschedule"
    assert verdict.action == readiness.ACTION_RESCHEDULE


def test_inside_the_taper_resting_is_the_point_not_a_loss():
    verdict = readiness.assess_day(_rough_morning(), REPEATS, goal=_marathon(5), today=TODAY)
    assert verdict.phase == "scarico"
    assert verdict.alternative.kind == "rest"
    assert verdict.action == readiness.ACTION_REST


def test_a_rough_morning_on_a_rest_day_asks_for_nothing():
    verdict = readiness.assess_day(_rough_morning(), None, today=TODAY)
    assert verdict.session_demand == readiness.DEMAND_REST
    assert verdict.alternative.kind == "rest"


def test_the_action_always_matches_the_alternative_offered():
    """The two used to be computed by separate ladders, which is how a verdict ends up
    saying "alleggerisci" over a button that reschedules."""
    for days_out in (70, 20, 5):
        verdict = readiness.assess_day(_rough_morning(), REPEATS, goal=_marathon(days_out), today=TODAY)
        assert verdict.action == readiness.ACTION_BY_ALTERNATIVE[verdict.alternative.kind]


def test_the_model_is_handed_a_decision_not_a_question():
    """`verdict_facts` is what the LLM sees: the conclusion is already in it, and there
    are no raw wellness values beyond the ones the screen shows anyway."""
    verdict = readiness.assess_day(_rough_morning(), REPEATS, goal=_marathon(70), today=TODAY)
    facts = readiness.verdict_facts(verdict, _marathon(70))
    assert facts["stato"] == readiness.STATE_DEPLETED
    assert facts["azione"] == verdict.action
    assert facts["alternativa"] == verdict.alternative.label
    assert facts["gara_fra_giorni"] == 70
    assert all(set(signal) == {"cosa", "misura", "peso"} for signal in facts["segnali"])
