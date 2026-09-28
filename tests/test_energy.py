"""The day's energy: every activity, Garmin's figures, the estimate, the food."""

from datetime import date, datetime

from training_plan import energy

DAY = date(2026, 9, 26)
EVENING = datetime(2026, 9, 26, 21, 0)
MORNING = datetime(2026, 9, 26, 9, 0)


def row(sport, minutes, calories=None, source=None, title=None):
    return {"sport": sport, "duration_min": minutes, "calories": calories, "calories_source": source, "title": title, "distance_km": None}


def day(activities, garmin=None, intake=0, entries=0, now=EVENING, d=DAY):
    return energy.day_energy(
        day=d, activities=activities, weight_kg=83, bmr_kcal=None, garmin=garmin, intake_kcal=intake, entries=entries, now=now
    )


def test_garmin_calories_are_used_and_labelled():
    a = energy.activity_energy(row("running", 122, 1632, "garmin"), 83)
    assert (a.kcal, a.source, a.label) == (1632, "garmin", "corsa")


def test_a_strava_only_ride_is_estimated():
    a = energy.activity_energy(row("Ride", 60), 80)
    assert a.source == "stima" and a.kcal == 600 and a.label == "bici"


def test_garmin_day_total_is_trusted_and_the_estimate_shown():
    garmin = energy.GarminDay(total_kcal=4306, active_kcal=2104, bmr_kcal=2202, steps=37941)
    e = day([row("running", 122, 1632, "garmin")], garmin=garmin)
    assert (e.spent_kcal, e.spent_source) == (4306, "garmin")
    assert 3500 < e.estimate_kcal < 5000


def test_without_garmin_the_estimate_is_the_answer():
    e = day([row("running", 60)])
    assert e.spent_source == "stima" and e.spent_kcal == e.estimate_kcal


def test_a_long_day_with_little_food_says_what_is_missing():
    garmin = energy.GarminDay(total_kcal=4300, active_kcal=2100, bmr_kcal=2200, steps=None)
    e = day([row("running", 122, 1632, "garmin")], garmin=garmin, intake=2100, entries=3)
    assert e.missing_kcal == 2200
    assert "Mancano circa 2200 kcal per ricaricare" in e.message
    assert "kcal" not in e.words and "ricarica" in e.words


def test_morning_is_too_early_to_say_anything_is_missing():
    e = day([row("running", 60, 700, "garmin")], intake=300, entries=1, now=MORNING)
    assert e.missing_kcal is None


def test_run_and_ride_are_one_long_day_for_the_fuel():
    assert energy.endurance_minutes([row("running", 40), row("road_biking", 90), row("strength_training", 45)]) == 130


def test_a_rest_day_in_words():
    e = day([])
    assert not e.training_day and "riposo" in e.words
