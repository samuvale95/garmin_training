from datetime import date

import pytest

from training_plan import nutrition
from training_plan.models import PaceTarget, RepeatBlock, Step, TrainingSession


def _pace(sec: int) -> PaceTarget:
    return PaceTarget(slower_sec_per_km=sec, faster_sec_per_km=sec)


def _session(steps, *, day=date(2026, 8, 10), sport="running", title="Sessione"):
    return TrainingSession(date=day, sport=sport, title=title, steps=steps)


def _time_step(minutes, pace=None, step_type="interval"):
    return Step(type=step_type, duration_type="time", duration_value=minutes, target_pace=pace)


def _distance_step(km, pace=None, step_type="interval"):
    return Step(type=step_type, duration_type="distance", duration_value=km, target_pace=pace)


# ---- load classification ------------------------------------------------------------


def test_no_session_is_a_rest_day():
    assert nutrition.classify_load(None) == "riposo"


def test_a_short_easy_run_is_light():
    assert nutrition.classify_load(_session([_time_step(40, _pace(360))])) == "facile"


def test_an_hour_at_one_pace_is_moderate():
    assert nutrition.classify_load(_session([_time_step(70, _pace(360))])) == "moderato"


def test_intervals_make_a_short_session_hard():
    """The point of reading paces instead of step types.

    Fifty minutes total, which on duration alone would be a light day -- but a third of
    it is 40 s/km faster than the warmup, and that is a session the body has to be
    fuelled for.
    """
    session = _session(
        [
            _time_step(15, _pace(360), "warmup"),
            RepeatBlock(reps=6, steps=[_time_step(3, _pace(310)), _time_step(2, None, "recovery")]),
            _time_step(5, _pace(360), "cooldown"),
        ]
    )
    assert nutrition.classify_load(session) == "duro"


def test_a_steady_run_written_as_one_interval_step_is_not_hard():
    """Every plan writes its working portion as `interval`, including the 40-minute
    steady run. Classifying on the step type alone would make every session a hard one."""
    session = _session([_time_step(45, _pace(330), "interval")])
    assert nutrition.classify_load(session) == "facile"


def test_a_long_easy_run_is_hard_on_duration_alone():
    assert nutrition.classify_load(_session([_time_step(110, _pace(360))])) == "duro"


def test_over_three_hours_is_very_long():
    assert nutrition.classify_load(_session([_time_step(200, _pace(360))])) == "molto_lungo"


def test_a_plan_written_in_kilometres_is_not_read_as_a_rest_day():
    """`strava_sync._planned_summary` sums only the time-based steps, deliberately. A
    fuelling classifier that did the same would see a 25 km long run as zero minutes."""
    session = _session([_distance_step(25, _pace(330))])
    assert nutrition.classify_load(session) == "duro"  # 25 km at 5:30/km is 137 minutes
    assert nutrition.classify_load(_session([_distance_step(35, _pace(330))])) == "molto_lungo"


def test_strength_work_is_not_fuelled_like_running():
    session = _session([_time_step(70)], sport="strength_training")
    assert nutrition.classify_load(session) == "facile"


def test_a_session_with_no_steps_is_light_not_rest():
    """A workout read straight off the Garmin calendar carries no step detail. Something
    is planned, so it is not a rest day -- there is just nothing to size it by."""
    assert nutrition.classify_load(_session([])) == "facile"


# ---- targets ------------------------------------------------------------------------


def test_targets_are_the_range_times_the_weight():
    target = nutrition.day_target(date(2026, 8, 10), _session([_time_step(200, _pace(360))]), 70.0)
    assert target.load == "molto_lungo"
    assert target.carb_g_per_kg == (10.0, 12.0)
    assert target.carb_g == (700, 840)
    assert target.protein_g == (112, 140)


def test_without_a_weight_there_are_no_absolute_grams():
    target = nutrition.day_target(date(2026, 8, 10), None, None)
    assert target.carb_g is None
    assert target.protein_g is None
    assert target.carb_g_per_kg == (3.0, 5.0)


def test_a_missing_weight_falls_back_to_the_reference_and_says_so():
    fuelling = nutrition.daily_fuelling(date(2026, 8, 10), [], weight_kg=None)
    assert fuelling.weight_source == "reference"
    assert fuelling.weight_kg == nutrition.REFERENCE_WEIGHT_KG
    assert fuelling.today.carb_g is not None


def test_the_declared_source_survives_a_supplied_weight():
    fuelling = nutrition.daily_fuelling(date(2026, 8, 10), [], weight_kg=64.2, weight_source="scale")
    assert (fuelling.weight_kg, fuelling.weight_source) == (64.2, "scale")


# ---- the day as a whole -------------------------------------------------------------


def test_tomorrow_drives_the_advice():
    sessions = [_session([_time_step(200, _pace(360))], day=date(2026, 8, 11), title="Lungo 30 km")]
    fuelling = nutrition.daily_fuelling(date(2026, 8, 10), sessions, weight_kg=70.0)
    assert fuelling.tomorrow.load == "molto_lungo"
    assert "lungo 30 km" in fuelling.advice
    assert "carboidrati" in fuelling.advice


def test_back_to_back_hard_days_raise_the_night_before():
    """The flat table has no row for two hard days in a row: the second starts from a
    tank the first emptied, so the day before them both carries more."""
    sessions = [
        _session([_time_step(100, _pace(360))], day=date(2026, 8, 11), title="Medio"),
        _session([_time_step(120, _pace(360))], day=date(2026, 8, 12), title="Lungo"),
    ]
    fuelling = nutrition.daily_fuelling(date(2026, 8, 10), sessions, weight_kg=70.0)
    assert nutrition.classify_load(sessions[0]) == "duro"
    assert fuelling.tomorrow.load == "molto_lungo"


def test_a_single_hard_day_is_not_raised():
    sessions = [_session([_time_step(100, _pace(360))], day=date(2026, 8, 11))]
    fuelling = nutrition.daily_fuelling(date(2026, 8, 10), sessions, weight_kg=70.0)
    assert fuelling.tomorrow.load == "duro"


def test_a_rest_day_after_a_hard_one_talks_about_today():
    sessions = [_session([_time_step(150, _pace(360))], day=date(2026, 8, 10), title="Lungo")]
    fuelling = nutrition.daily_fuelling(date(2026, 8, 10), sessions, weight_kg=70.0)
    assert fuelling.tomorrow.load == "riposo"
    assert "reintegra" in fuelling.advice


@pytest.mark.parametrize(
    "sessions",
    [
        [],
        [_session([_time_step(200, _pace(360))], day=date(2026, 8, 11))],
        [_session([_time_step(30, _pace(360))], day=date(2026, 8, 11))],
    ],
)
def test_the_advice_never_mentions_restriction(sessions):
    """A design constraint, not a preference: a training app that scolds people about
    food does real harm to a non-trivial fraction of endurance runners."""
    fuelling = nutrition.daily_fuelling(date(2026, 8, 10), sessions, weight_kg=70.0)
    lowered = fuelling.advice.lower()
    assert not any(word in lowered for word in ("dieta", "calor", "deficit", "peso", "sgarr"))


def test_facts_carry_no_raw_training_data():
    """What the model is allowed to see: derived figures only, so it never needs the
    plan, the weight, or a photo to write its sentence."""
    fuelling = nutrition.daily_fuelling(date(2026, 8, 10), [], weight_kg=70.0)
    facts = nutrition.fuelling_facts(fuelling)
    assert "peso_kg" not in facts
    assert set(facts) <= {
        "domani_sessione",
        "domani_carico",
        "domani_minuti",
        "domani_carboidrati_g",
        "oggi_carico",
        "oggi_carboidrati_g",
        "peso_stimato",
        "oggi_assunto",
    }
