from training_plan import hr_sensor_report
from training_plan.hr_reliability import HrReliability, SensorStep


def _rel(verdict, locked=False):
    steps = [SensorStep(3000, 8.0, 148, 170, 172, 0.5, locked)] if verdict != "affidabile" else []
    return HrReliability(verdict=verdict, unreliable_from_s=3000 if steps else None, steps=steps)


def _rows(source, verdicts):
    return [(source, {"day": "2026-10-01", "title": "Corsa"}, _rel(v, v == "inaffidabile")) for v in verdicts]


def test_problems_only_on_the_wrist_blame_the_optical_sensor():
    rows = _rows("wrist", ["inaffidabile"] * 4 + ["affidabile"] * 6) + _rows("chest_strap", ["affidabile"] * 5)
    report = hr_sensor_report.summarize(rows)
    assert report.by_source["wrist"].with_cadence_lock == 4
    assert "segue l'orologio" in report.conclusion


def test_problems_on_both_are_not_the_watch():
    rows = _rows("wrist", ["dubbia"] * 3 + ["affidabile"] * 7) + _rows("chest_strap", ["dubbia"] * 3 + ["affidabile"] * 7)
    assert "non dipende dall'orologio" in hr_sensor_report.summarize(rows).conclusion


def test_too_few_strap_runs_says_so():
    rows = _rows("wrist", ["affidabile"] * 10) + _rows("chest_strap", ["affidabile"])
    assert "Troppo poche" in hr_sensor_report.summarize(rows).conclusion


def test_strava_only_history_has_no_sensor_to_compare():
    rows = _rows(None, ["affidabile"] * 5)
    report = hr_sensor_report.summarize(rows)
    assert report.by_source["unknown"].runs == 5
    assert "Garmin" in report.conclusion
