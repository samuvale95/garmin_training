"""The weekly summary: counts anyone can redo by hand."""

from datetime import date, timedelta

from training_plan import weekly_summary as ws
from training_plan.checkin import CheckIn
from training_plan.levels import DayTraining
from training_plan.plan_skeleton import SkeletonInputs, build_skeleton

MONDAY = date(2026, 9, 21)
AFTER = MONDAY + timedelta(days=8)  # the following Tuesday: the week is complete


def planned(day, sport="running", minutes=40):
    return {
        "id": str(day), "date": day.isoformat(), "sport": sport, "title": "Corsa", "description": None,
        "origin": "ai", "locked": False,
        "steps": [{"type": "interval", "duration_type": "time", "duration_value": minutes, "target_pace": None}],
    }


def trained(day, minutes=40.0):
    return DayTraining(day, 1, 1, minutes)


def build(**kw):
    args = dict(monday=MONDAY, today=AFTER, planned=[], days=[], checkins=[])
    args.update(kw)
    return ws.build_summary(**args)


def test_three_of_four_planned_days():
    plan_days = [MONDAY + timedelta(days=d) for d in (1, 3, 5, 6)]
    s = build(planned=[planned(d) for d in plan_days], days=[trained(d) for d in plan_days[:3]])
    assert (s.planned_sessions, s.planned_days, s.planned_days_trained) == (4, 4, 3)
    assert s.planned_minutes == 160 and s.done_minutes == 120
    assert "3 giorni su 4" in s.headline
    assert any("1 saltati" in h for h in s.highlights)


def test_without_a_plan_the_plan_figure_is_absent_not_zero():
    s = build(days=[trained(MONDAY + timedelta(days=1))])
    assert s.planned_days_trained is None
    assert "1 allenamento" in s.headline


def test_the_streak_counts_active_weeks():
    days = []
    for w in range(5):
        week = MONDAY - timedelta(weeks=w)
        days += [trained(week + timedelta(days=1)), trained(week + timedelta(days=4))]
    s = build(days=days)
    assert s.streak_weeks == 5
    assert any("5ª settimana di fila" in h for h in s.highlights)


def test_a_week_in_progress_does_not_break_the_streak():
    days = [trained(MONDAY - timedelta(weeks=1) + timedelta(days=d)) for d in (1, 4)]
    s = build(days=days, today=MONDAY + timedelta(days=1))
    assert s.streak_weeks == 1
    assert not s.complete


def test_pain_comes_first_with_its_area():
    thursday = MONDAY + timedelta(days=3)
    checkins = [CheckIn(thursday, "dolore", "dura", "caviglia"), CheckIn(MONDAY, "bene", "facile")]
    s = build(checkins=checkins, days=[trained(thursday), trained(MONDAY)])
    assert [(p.date, p.area) for p in s.pain_days] == [(thursday, "caviglia")]
    assert s.highlights[0].startswith("Dolore alla caviglia giovedì")
    assert s.efforts == {"dura": 1, "facile": 1}
    assert s.checkin_days == 2


def test_next_week_comes_from_the_skeleton():
    skeleton = build_skeleton(SkeletonInputs(MONDAY, 3, 181.0, 4))
    s = build(skeleton=skeleton)
    assert s.next_week is not None and s.next_week.reason == skeleton[1].reason


def test_highlights_are_capped():
    days = [trained(MONDAY - timedelta(weeks=w) + timedelta(days=d)) for w in range(3) for d in (0, 2)]
    checkins = [CheckIn(MONDAY + timedelta(days=d), "dolore", "troppo", "piede") for d in (0, 2, 4, 5, 6)]
    assert len(build(days=days, checkins=checkins).highlights) == ws.MAX_HIGHLIGHTS


def test_the_default_week():
    assert ws.default_monday(date(2026, 9, 28)) == date(2026, 9, 21)  # Monday: last week
    assert ws.default_monday(date(2026, 10, 1)) == date(2026, 9, 28)  # Thursday: this week
