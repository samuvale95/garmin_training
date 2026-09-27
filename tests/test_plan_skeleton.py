"""The skeleton of the plan: every scenario of the plan-generation spec about it."""

from datetime import date, timedelta

from training_plan import plan_rules
from training_plan.models import RaceGoal
from training_plan.plan_skeleton import SkeletonInputs, SkeletonWeek, build_skeleton

MONDAY = date(2026, 9, 28)


def inputs(level=3, weekly=181.0, days=4, goal=None):
    return SkeletonInputs(
        start=MONDAY, effective_level=level, recent_weekly_minutes=weekly, recent_running_days=days, goal=goal
    )


def marathon(weeks_out=20):
    return RaceGoal(race_date=MONDAY + timedelta(weeks=weeks_out, days=6), distance_km=42.195, name="Maratona")


def test_a_skeleton_to_a_race_ends_with_the_race_week():
    weeks = build_skeleton(inputs(goal=marathon()))
    assert len(weeks) == 21
    assert [w.monday for w in weeks] == [MONDAY + timedelta(weeks=k) for k in range(21)]
    assert weeks[-1].phase == "gara"
    assert weeks[-2].phase == "scarico"


def test_without_a_goal_there_are_three_weeks_of_costanza():
    weeks = build_skeleton(inputs())
    assert len(weeks) == 3
    assert {w.phase for w in weeks} == {"costanza"}


def test_an_athlete_builds_three_weeks_and_steps_back():
    weeks = build_skeleton(inputs(goal=marathon()))
    assert [w.target_minutes for w in weeks[:5]] == [200, 220, 240, 190, 265]
    assert weeks[3].lighter and not weeks[4].lighter
    assert "181" in weeks[0].reason


def test_a_beginner_with_no_history_starts_small():
    weeks = build_skeleton(inputs(level=1, weekly=None, days=None))
    assert [w.target_minutes for w in weeks] == [60, 65, 70]
    assert weeks[0].running_days == 3


def test_a_beginner_gets_no_quality():
    weeks = build_skeleton(inputs(level=1, weekly=120, goal=marathon()))
    assert {w.quality_sessions for w in weeks} == {0}


def test_the_habit_caps_the_running_days():
    weeks = build_skeleton(inputs(level=3, days=2))
    assert {w.running_days for w in weeks} == {3}


def test_the_taper_is_measured_on_the_highest_week():
    weeks = build_skeleton(inputs(goal=marathon(10)))
    peak = max(w.target_minutes for w in weeks[:-2])
    assert weeks[-2].target_minutes == int(peak * 0.75 / 5 + 0.5) * 5
    assert weeks[-1].target_minutes == int(peak * 0.5 / 5 + 0.5) * 5
    assert weeks[-1].quality_sessions == 0


def test_volume_stops_at_the_ceiling():
    weeks = build_skeleton(inputs(level=2, weekly=200, goal=RaceGoal(MONDAY + timedelta(weeks=30), 10.0)))
    # 270 at level 3, times 0.75 at level 2.
    assert max(w.target_minutes for w in weeks) == 205
    assert any("tetto" in w.reason for w in weeks)


def test_the_ceiling_never_cuts_below_where_the_user_already_is():
    weeks = build_skeleton(inputs(level=1, weekly=200))
    assert weeks[0].target_minutes == 200


def test_every_week_stays_inside_the_hard_session_limit():
    for level in (1, 2, 3):
        for week in build_skeleton(inputs(level=level, goal=marathon())):
            long_is_hard = week.long_run_minutes >= plan_rules.LONG_RUN_MINUTES
            assert week.quality_sessions + long_is_hard <= plan_rules.RULES["hard_per_week"].limit(level)


def test_the_skeleton_itself_respects_the_volume_rule():
    # Each building week over the highest before it, the lighter week and the return:
    # none of it may be something the validator would refuse.
    for level in (1, 2, 3):
        weeks = build_skeleton(inputs(level=level, weekly=150, goal=marathon()))
        ctx = plan_rules.RuleContext(level, 150, 120, MONDAY)
        earlier = {}
        for week in weeks:
            limit, _ = plan_rules.volume_limit(plan_rules.volume_base(ctx, earlier, week.monday), ctx)
            assert week.target_minutes <= limit, (level, week)
            earlier[week.monday] = week.target_minutes


def test_weeks_round_trip_through_a_dict():
    week = build_skeleton(inputs())[0]
    assert SkeletonWeek.from_dict(week.to_dict()) == week


def test_three_runs_a_week_are_not_all_hard():
    weeks = build_skeleton(inputs(level=3, days=2, goal=marathon()))
    assert all(w.running_days == 3 for w in weeks)
    assert max(w.quality_sessions for w in weeks) == 1
