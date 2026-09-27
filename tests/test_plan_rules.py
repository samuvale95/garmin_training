"""The limits a plan must respect: every scenario of the plan-limits spec."""

from datetime import date, timedelta

from training_plan import plan_rules
from training_plan.models import PaceTarget, RepeatBlock, Step, TrainingSession
from training_plan.plan_rules import RuleContext

MONDAY = date(2026, 10, 5)
EASY = PaceTarget(slower_sec_per_km=370, faster_sec_per_km=350)
FAST = PaceTarget(slower_sec_per_km=290, faster_sec_per_km=280)


def run(day_offset, minutes=40, pace=EASY, title="Corsa", sport="running"):
    return TrainingSession(
        date=MONDAY + timedelta(days=day_offset),
        sport=sport,
        title=title,
        steps=[Step("interval", "time", minutes, pace)],
    )


def intervals(day_offset, reps=6, work=3, recovery=2, title="Ripetute"):
    return TrainingSession(
        date=MONDAY + timedelta(days=day_offset),
        sport="running",
        title=title,
        steps=[
            Step("warmup", "time", 15, EASY),
            RepeatBlock(reps=reps, steps=[Step("interval", "time", work, FAST), Step("recovery", "time", recovery, EASY)]),
            Step("cooldown", "time", 10, EASY),
        ],
    )


def ctx(level=1, weekly=None, longest=None):
    return RuleContext(effective_level=level, recent_weekly_minutes=weekly, recent_longest_run=longest, today=MONDAY)


def keys(violations):
    return [v.key for v in violations]


# ---- kinds ----------------------------------------------------------------------------------


def test_intervals_are_quality_and_hard():
    assert plan_rules.session_kind(intervals(1)) == "qualità"


def test_a_steady_run_is_easy():
    assert plan_rules.session_kind(run(1, 40)) == "facile"


def test_a_long_steady_run_is_long():
    assert plan_rules.session_kind(run(6, 100)) == "lungo"


def test_the_title_does_not_matter():
    tricky = intervals(1, reps=5, work=6, title="Corsa facile")
    assert plan_rules.session_kind(tricky) == "qualità"


def test_strength_and_other_sports():
    assert plan_rules.session_kind(run(1, sport="strength_training")) == "forza"
    assert plan_rules.session_kind(run(1, sport="cycling")) == "altro"


def test_easy_share_counts_the_working_steps_only():
    """15' + 6 × (3' fast + 2' jog) + 10': 18 hard minutes, 37 easy."""
    easy, hard = plan_rules.easy_and_hard_minutes(intervals(1))
    assert (round(easy), round(hard)) == (37, 18)


# ---- day order ------------------------------------------------------------------------------


def test_two_hard_days_in_a_row_break_the_beginner_limit():
    week = [intervals(1), run(2, 100)]
    violation = next(v for v in plan_rules.validate(week, ctx(level=1)) if v.key == "hard_in_a_row")
    assert violation.dates == [MONDAY + timedelta(days=1), MONDAY + timedelta(days=2)]


def test_the_same_days_are_fine_for_an_athlete():
    week = [intervals(1), run(2, 100)]
    assert "hard_in_a_row" not in keys(plan_rules.validate(week, ctx(level=3, weekly=400, longest=120)))


def test_a_hard_day_after_the_long_run():
    week = [run(0, 100), intervals(1)]
    assert "hard_after_long" in keys(plan_rules.validate(week, ctx(level=2, weekly=300, longest=110)))
    assert "hard_after_long" not in keys(plan_rules.validate(week, ctx(level=3, weekly=300, longest=110)))


def test_pause_lowers_the_thresholds():
    """Level 3 in `ripresa` is judged at effective level 2."""
    week = [intervals(0), intervals(2), run(4, 100)]
    violation = next(v for v in plan_rules.validate(week, ctx(level=2, weekly=400, longest=120)) if v.key == "hard_per_week")
    assert (violation.measured, violation.limit, violation.level) == (3, 2, 2)


# ---- volume ---------------------------------------------------------------------------------


def test_a_new_user_can_be_given_a_first_week():
    week = [run(0, 30), run(2, 30), run(4, 30)]
    assert not {"volume_growth", "long_run_growth"} & set(keys(plan_rules.validate(week, ctx(level=1))))


def test_the_volume_message_carries_the_numbers():
    week = [run(0, 40), run(2, 40), run(4, 40), run(6, 40)]
    violation = next(v for v in plan_rules.validate(week, ctx(level=1, weekly=120, longest=45)) if v.key == "volume_growth")
    assert (violation.measured, violation.limit) == (160, 140)  # max(120 × 1.10, 120 + 20)
    assert "160 minuti" in violation.message and "140" in violation.message and "livello 1" in violation.message


def test_a_small_base_can_still_grow():
    week = [run(0, 40), run(3, 50)]
    assert "volume_growth" not in keys(plan_rules.validate(week, ctx(level=1, weekly=80, longest=45)))


def test_the_long_run_grows_by_steps():
    week = [run(6, 120)]
    violation = next(v for v in plan_rules.validate(week, ctx(level=2, weekly=300, longest=90)) if v.key == "long_run_growth")
    assert round(violation.limit) == 104  # max(90 × 1.15, 90 + 10)


def test_rest_days_only_on_whole_weeks():
    busy = [run(d, 30) for d in range(7)]
    assert "rest_days" in keys(plan_rules.validate(busy, ctx(level=3, weekly=400, longest=100)))
    half = [run(d, 30) for d in range(3, 7)]
    assert "rest_days" not in keys(plan_rules.validate(half, ctx(level=3, weekly=400, longest=100)))


def test_an_interval_heavy_week_is_not_easy_enough_for_a_beginner():
    week = [intervals(0, reps=10, work=4, recovery=1), run(3, 30)]
    assert "easy_share" in keys(plan_rules.validate(week, ctx(level=1, weekly=200, longest=60)))


def test_the_fourth_week_after_three_building_ones_is_lighter():
    weeks = []
    for w, minutes in enumerate((150, 170, 190, 190)):
        weeks += [run(w * 7 + d, minutes / 3) for d in (0, 2, 4)]
    violations = plan_rules.validate(
        weeks, ctx(level=3, weekly=150, longest=70), start=MONDAY, end=MONDAY + timedelta(days=27)
    )
    deload = next(v for v in violations if v.key == "deload")
    assert round(deload.limit) == round(190 * 0.85)


# ---- honesty --------------------------------------------------------------------------------


def test_caution_rules_never_warn_on_a_move():
    for rule in plan_rules.RULES.values():
        if rule.evidence == plan_rules.EVIDENCE_CAUTION:
            assert rule.warn_on_move is False


def test_only_move_warnings_filters_to_those_rules():
    week = [intervals(1), run(2, 100), run(3, 60), run(4, 60)]
    violations = plan_rules.validate(week, ctx(level=1, weekly=60, longest=45), only_move_warnings=True)
    assert violations and all(v.warn_on_move for v in violations)


def test_violations_name_session_ids_when_there_are_some():
    week = [intervals(1), run(2, 100)]
    violations = plan_rules.validate(week, ctx(level=1), ids=["a", "b"])
    assert next(v for v in violations if v.key == "hard_in_a_row").sessions == ["a", "b"]


def test_the_recent_average_is_over_four_complete_weeks():
    from training_plan.levels import DayTraining

    today = date(2026, 9, 24)  # Thursday; the last complete week starts 14 Sep
    weekly = {date(2026, 9, 14): 66, date(2026, 9, 7): 322, date(2026, 8, 31): 200, date(2026, 8, 24): 137}
    days = [DayTraining(monday, 1, 1, minutes) for monday, minutes in weekly.items()]
    days.append(DayTraining(date(2026, 9, 22), 1, 1, 500))  # this week: not complete, not counted
    context = plan_rules.context_from_days(days, today=today, effective_level=3, longest=150)
    assert round(context.recent_weekly_minutes) == 181


def test_too_little_recent_running_means_no_average():
    from training_plan.levels import DayTraining

    today = date(2026, 9, 24)
    context = plan_rules.context_from_days([DayTraining(date(2026, 9, 14), 1, 1, 40)], today=today, effective_level=1, longest=None)
    assert context.recent_weekly_minutes is None


def test_strides_do_not_make_an_easy_run_hard():
    """40' easy with 4 × 30" strides: a plan's easy day, not a third hard one."""
    session = TrainingSession(
        date=MONDAY,
        sport="running",
        title="Ritmo costante + allunghi",
        steps=[Step("interval", "time", 38, EASY)] + [Step("interval", "time", 0.5, FAST) for _ in range(4)],
    )
    assert plan_rules.session_kind(session) == "facile"
