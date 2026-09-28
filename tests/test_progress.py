"""Progress: every scenario of the progress spec."""

from datetime import date, timedelta

from training_plan import progress as pg
from training_plan.checkin import CheckIn
from training_plan.levels import DayTraining

TODAY = date(2026, 9, 30)  # Wednesday
THIS_MONDAY = date(2026, 9, 28)


def week(k):
    """Monday of the week `k` weeks before this one."""
    return THIS_MONDAY - timedelta(weeks=k)


def active(monday, minutes=40.0):
    return [DayTraining(monday + timedelta(days=1), 1, 1, minutes), DayTraining(monday + timedelta(days=4), 1, 1, minutes)]


def planned(day, title="Corsa", minutes=40, hard=False):
    steps = (
        [{"reps": 6, "steps": [{"type": "interval", "duration_type": "time", "duration_value": 3, "target_pace": None}]}]
        if hard
        else [{"type": "interval", "duration_type": "time", "duration_value": minutes, "target_pace": None}]
    )
    return {"id": str(day), "date": day.isoformat(), "sport": "running", "title": title, "description": None, "steps": steps, "origin": "ai", "locked": False}


def build(days=(), planned_=(), checkins=(), level=1, today=TODAY):
    return pg.build_progress(today=today, days=list(days), planned=list(planned_), checkins=list(checkins), reached_level=level)


def states(days=(), checkins=()):
    return pg.walk_weeks(pg._inputs(TODAY, list(days), [], list(checkins)))


def test_a_token_saves_a_week():
    days = [*active(week(6)), *active(week(5)), *active(week(4)), *active(week(3)), *active(week(1))]
    weeks = states(days)
    last = next(w for w in weeks if w.monday == week(1))
    assert last.streak == 5 and last.tokens == 0
    assert next(w for w in weeks if w.monday == week(2)).token_spent


def test_an_injured_week_is_protected_without_a_token():
    days = [*active(week(3)), *active(week(2))]
    pain = [CheckIn(week(1) + timedelta(days=2), "dolore", None, "ginocchio")]
    weeks = states(days, pain)
    injured = next(w for w in weeks if w.monday == week(1))
    assert injured.protected and not injured.token_spent and injured.streak == 2


def test_no_token_breaks_the_streak():
    days = [*active(week(3)), *active(week(2))]
    weeks = states(days)
    assert next(w for w in weeks if w.monday == week(1)).streak == 0


def test_the_week_in_progress_does_not_break_the_streak():
    days = [*active(week(2)), *active(week(1))]
    assert build(days).streak == 2


def test_running_more_than_planned_loses_points():
    monday = week(1)
    plan = [planned(monday + timedelta(days=d), minutes=50) for d in (1, 3, 5)]
    days = [DayTraining(monday + timedelta(days=d), 1, 1, 70.0) for d in (1, 3, 5)]
    inputs = pg._inputs(TODAY, days, plan, [])
    lines = pg.week_points(inputs, monday, pg.walk_weeks(inputs))
    over = [l for l in lines if l.points == pg.POINTS_OVER_PLAN]
    assert len(over) == 1 and "oltre il piano del 40%" in over[0].reason
    assert not any("minuti" in l.reason and l.points > 0 for l in lines)


def test_listening_to_the_body_is_a_smart_choice():
    monday = week(1)
    thursday = monday + timedelta(days=3)
    plan = [planned(thursday, "Ripetute 6x3'", hard=True), planned(monday + timedelta(days=1))]
    days = [DayTraining(monday + timedelta(days=1), 1, 1, 40.0)]
    pain = [CheckIn(thursday - timedelta(days=1), "dolore", "giusta", "ginocchio")]
    inputs = pg._inputs(TODAY, days, plan, pain)
    lines = pg.week_points(inputs, monday, pg.walk_weeks(inputs))
    smart = [l for l in lines if l.date == thursday and l.points == pg.POINTS_SMART_CHOICE]
    assert smart and "dolore al ginocchio" in smart[0].reason


def test_points_for_the_plan_rest_and_check_in():
    monday = week(1)
    plan = [planned(monday + timedelta(days=d)) for d in (1, 3, 5)]
    days = [DayTraining(monday + timedelta(days=d), 1, 1, 40.0) for d in (1, 3, 5)]
    checkins = [CheckIn(monday + timedelta(days=1), "bene", "facile")]
    inputs = pg._inputs(TODAY, days, plan, checkins)
    lines = pg.week_points(inputs, monday, pg.walk_weeks(inputs))
    total = sum(l.points for l in lines)
    # 3 planned days (30) + 2 rest days (10) + check-in (3) + active (20) + all planned (20)
    assert total == 83


def test_without_a_plan_training_days_count_up_to_five():
    monday = week(1)
    days = [DayTraining(monday + timedelta(days=d), 1, 1, 30.0) for d in range(7)]
    inputs = pg._inputs(TODAY, days, [], [])
    lines = pg.week_points(inputs, monday, pg.walk_weeks(inputs))
    assert sum(1 for l in lines if l.points == pg.POINTS_UNPLANNED_DAY) == 5


def test_four_in_a_row_badge_has_the_sunday():
    days = [*active(week(4)), *active(week(3)), *active(week(2)), *active(week(1))]
    badge = next(b for b in build(days).badges if b.key == "serie_4")
    assert badge.earned and badge.earned_on == week(1) + timedelta(days=6)
    assert next(b for b in build(days).badges if b.key == "serie_12").progress == 4


def test_the_mascot_rests_after_pain():
    pain = [CheckIn(TODAY - timedelta(days=1), "dolore", None, "caviglia")]
    assert build(checkins=pain, days=active(week(5))).mascot.state == "riposo"


def test_the_mascot_runs_on_a_training_day():
    assert build(days=[*active(week(5)), DayTraining(TODAY, 1, 1, 30.0)]).mascot.state == "corsa"


def test_the_mascot_celebrates_a_new_badge():
    assert build(days=[DayTraining(TODAY - timedelta(days=1), 1, 1, 30.0)]).mascot.state == "esultanza"
