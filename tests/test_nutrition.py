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
    assert target.carb_g_per_kg == (8.0, 10.0)
    assert target.carb_g == (560, 700)
    assert target.protein_g == (112, 140)


def test_the_top_band_is_not_the_ultra_endurance_row():
    """The bug this table was rewritten for.

    Three hours of running is a big day; it is not four-to-five-hours-every-day, which
    is whose row 10-12 g/kg is. At 70 kg the old top band asked for 840 g of
    carbohydrate -- arithmetically correct, and not a thing a person eats.
    """
    assert max(high for _, high in nutrition.CARB_G_PER_KG.values()) <= 10.0


def test_without_a_weight_there_are_no_absolute_grams():
    target = nutrition.day_target(date(2026, 8, 10), None, None)
    assert target.carb_g is None
    assert target.protein_g is None
    assert target.carb_g_per_kg == (3.0, 4.0)


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
    tank the first emptied, so the day before them both carries more.

    A gram per kilo more, and the *load* is untouched -- promoting the whole load (what
    this used to do) moved an ordinary pair of two-hour days onto the ultra-endurance
    band.
    """
    sessions = [
        _session([_time_step(100, _pace(360))], day=date(2026, 8, 11), title="Medio"),
        _session([_time_step(120, _pace(360))], day=date(2026, 8, 12), title="Lungo"),
    ]
    fuelling = nutrition.daily_fuelling(date(2026, 8, 10), sessions, weight_kg=70.0)
    assert nutrition.classify_load(sessions[0]) == "duro"
    assert fuelling.tomorrow.load == "duro"
    assert fuelling.tomorrow.carb_g_per_kg == (7.0, 9.0)


def test_a_single_hard_day_is_not_raised():
    sessions = [_session([_time_step(100, _pace(360))], day=date(2026, 8, 11))]
    fuelling = nutrition.daily_fuelling(date(2026, 8, 10), sessions, weight_kg=70.0)
    assert fuelling.tomorrow.load == "duro"
    assert fuelling.tomorrow.carb_g_per_kg == nutrition.CARB_G_PER_KG["duro"]


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


# ---- energy cross-check -------------------------------------------------------------


def _profile():
    return nutrition.BodyProfile(height_cm=178.0, age_years=32, sex="male")


def test_without_a_profile_there_is_no_energy_estimate():
    """Height and age are what a metabolic rate is computed from. Without them the
    macros still stand -- they just lose the figure that checks them."""
    target = nutrition.day_target(date(2026, 8, 10), None, 70.0)
    assert target.energy is not None
    assert target.energy.need_kcal is None
    assert target.energy.target_kcal[0] > 0


def test_the_energy_estimate_counts_the_session_separately_from_living():
    rest = nutrition.day_target(date(2026, 8, 10), None, 70.0, profile=_profile())
    trained = nutrition.day_target(
        date(2026, 8, 10), _session([_time_step(90, _pace(330))]), 70.0, profile=_profile()
    )
    assert rest.energy.training_kcal == 0
    assert trained.energy.training_kcal > 800
    assert trained.energy.need_kcal > rest.energy.need_kcal


def test_a_band_the_day_cannot_justify_is_trimmed():
    """The check the old table had no way to fail, in the shape that actually broke it.

    A band raised above what the session costs -- which is exactly what the old
    back-to-back rule did, promoting a 95-minute day onto the three-hour row -- now
    comes back down to what the day plausibly spends.
    """
    profile = nutrition.BodyProfile(height_cm=165.0, age_years=45, sex="female")
    target = nutrition.day_target(
        date(2026, 8, 10), _session([_time_step(95, _pace(360))]), 60.0, load_override="molto_lungo", profile=profile
    )
    assert target.energy.trimmed
    assert target.carb_g_per_kg[1] < nutrition.CARB_G_PER_KG["molto_lungo"][1]
    assert target.carb_g_per_kg[0] >= nutrition.MIN_CARB_G_PER_KG


def test_a_band_the_day_does_justify_is_left_alone():
    """Three hours of running really does cost what the top band feeds. The trim is a
    guard against arithmetic that ran away, not a standing correction."""
    target = nutrition.day_target(
        date(2026, 8, 10), _session([_time_step(200, _pace(360))]), 70.0, profile=_profile()
    )
    assert not target.energy.trimmed
    assert target.carb_g_per_kg == nutrition.CARB_G_PER_KG["molto_lungo"]


def test_the_trim_never_goes_below_the_floor():
    absurd = nutrition.BodyProfile(height_cm=120.0, age_years=90, sex="female")
    target = nutrition.day_target(
        date(2026, 8, 10), _session([_time_step(30, _pace(360))]), 120.0, load_override="molto_lungo", profile=absurd
    )
    assert target.carb_g_per_kg[0] >= nutrition.MIN_CARB_G_PER_KG


# ---- the day as meals ---------------------------------------------------------------


def test_a_training_day_gets_a_meal_before_and_after_the_session():
    sessions = [_session([_time_step(100, _pace(360))], day=date(2026, 8, 10), title="Lungo")]
    fuelling = nutrition.daily_fuelling(date(2026, 8, 10), sessions, weight_kg=70.0, profile=_profile())
    keys = [meal.key for meal in fuelling.meals]
    assert "pre" in keys and "post" in keys


def test_a_rest_day_has_no_session_to_eat_around():
    fuelling = nutrition.daily_fuelling(date(2026, 8, 10), [], weight_kg=70.0, profile=_profile())
    keys = [meal.key for meal in fuelling.meals]
    assert "pre" not in keys and "post" not in keys
    assert "pranzo" in keys


def test_the_meals_spend_the_day_without_inventing_food():
    """The shares sum to the day, and each meal's portions carry roughly its own share
    -- the whole point of a plan you can check against the target above it."""
    fuelling = nutrition.daily_fuelling(date(2026, 8, 10), [], weight_kg=70.0, profile=_profile())
    planned = sum(meal.carb_g for meal in fuelling.meals)
    midpoint = sum(fuelling.today.carb_g) / 2
    assert abs(planned - midpoint) <= 5


def test_no_meal_asks_for_a_portion_nobody_would_serve():
    """The bug the per-food ceiling exists for: one anchor food scaled to a whole meal's
    carbohydrate produced "595 g di patate"."""
    sessions = [_session([_time_step(200, _pace(360))], day=date(2026, 8, 10))]
    fuelling = nutrition.daily_fuelling(date(2026, 8, 10), sessions, weight_kg=85.0, profile=_profile())
    for meal in fuelling.meals:
        for portion in meal.portions:
            if portion.grams is not None and portion.food in nutrition.CARB_FOODS:
                assert portion.grams <= nutrition.CARB_FOODS[portion.food][1]


def test_a_long_session_gets_carbohydrate_inside_it():
    sessions = [_session([_time_step(180, _pace(360))], day=date(2026, 8, 10))]
    fuelling = nutrition.daily_fuelling(date(2026, 8, 10), sessions, weight_kg=70.0)
    assert fuelling.during is not None
    assert fuelling.during.carb_g_per_hour == (60, 90)
    assert fuelling.recovery is not None


def test_a_short_session_gets_neither():
    sessions = [_session([_time_step(40, _pace(360))], day=date(2026, 8, 10))]
    fuelling = nutrition.daily_fuelling(date(2026, 8, 10), sessions, weight_kg=70.0)
    assert fuelling.during is None
    assert fuelling.recovery is None


def test_the_gym_is_not_fuelled_during():
    sessions = [_session([_time_step(100)], day=date(2026, 8, 10), sport="strength_training")]
    fuelling = nutrition.daily_fuelling(date(2026, 8, 10), sessions, weight_kg=70.0)
    assert fuelling.during is None
