"""Nutrition: targets from the real load, and in-or-missing against them."""

from datetime import date, timedelta

from training_plan import nutrition, weekly_summary
from training_plan.models import Step, TrainingSession

DAY = date(2026, 10, 3)
TOMORROW = DAY + timedelta(days=1)


def run(day, minutes, title="Corsa"):
    return TrainingSession(day, "running", title, steps=[Step("interval", "time", minutes)])


def test_a_rest_day_that_became_a_long_run_is_fuelled_as_one():
    sessions = nutrition.with_real_load([], DAY, 100.0)
    fuelling = nutrition.daily_fuelling(DAY, sessions, weight_kg=70)
    assert fuelling.today.load in ("duro", "molto_lungo")
    assert fuelling.today.duration_minutes == 100


def test_a_shorter_run_keeps_the_planned_target():
    planned = [run(DAY, 90)]
    assert nutrition.with_real_load(planned, DAY, 40.0) == planned


def test_a_much_longer_run_replaces_the_planned_session():
    [session] = nutrition.with_real_load([run(DAY, 40)], DAY, 80.0)
    assert round(nutrition.session_duration_minutes(session)) == 80


def target(carb=(350, 450), protein=(112, 140), fat=(56, 84), load="facile", title=None):
    return nutrition.DayTarget(
        date=DAY, session_title=title, load=load, duration_minutes=None,
        carb_g_per_kg=(0, 0), protein_g_per_kg=(0, 0), fat_g_per_kg=(0, 0),
        carb_g=carb, protein_g=protein, fat_g=fat,
    )


def test_missing_carbohydrate_before_a_long_run_is_flagged():
    lines = nutrition.compliance(
        target(),
        {"entries": 2, "carb_g": 230, "protein_g": 120, "fat_g": 150},
        target(load="molto_lungo", title="Lungo lento 150'"),
        in_progress=True,
    )
    carb = next(l for l in lines if l.macro == "carb")
    assert carb.status == "sotto" and carb.missing_g == 120 and carb.flagged
    assert "finora" in carb.message and "Lungo lento 150'" in carb.message
    assert next(l for l in lines if l.macro == "protein").status == "dentro"
    fat = next(l for l in lines if l.macro == "fat")
    assert fat.status == "sopra" and "nessun problema" in fat.message and not fat.flagged


def test_a_few_grams_under_are_not_missing():
    [carb, *_] = nutrition.compliance(target(), {"entries": 1, "carb_g": 340, "protein_g": 120, "fat_g": 60}, target(), in_progress=False)
    assert carb.status == "dentro"


def test_nothing_logged_means_no_compliance():
    assert nutrition.compliance(target(), {"entries": 0}, target(), in_progress=True) == []


def test_the_summary_names_the_days_short_before_a_hard_session():
    s = weekly_summary.build_summary(
        monday=date(2026, 9, 28), today=date(2026, 10, 7), planned=[], days=[], checkins=[],
        food_days=4, carb_short_days=[DAY],
    )
    assert s.food_days == 4
    assert any("Carboidrati sotto il range sabato" in h for h in s.highlights)


def test_the_longest_session_of_the_day_sizes_the_fuel():
    sessions = [run(TOMORROW, 40, "Corsa costante 40'"), run(TOMORROW, 150, "Lungo")]
    fuelling = nutrition.daily_fuelling(DAY, sessions, weight_kg=70)
    assert fuelling.tomorrow.session_title == "Lungo"
    assert fuelling.tomorrow.load == "duro"
