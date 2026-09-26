"""From a history to a level: every rule of the athlete-level spec as a test."""

from datetime import date, timedelta

import pytest

from training_plan import levels
from training_plan.levels import DayTraining

TODAY = date(2026, 9, 24)  # a Thursday
THIS_MONDAY = date(2026, 9, 21)


def _week(weeks_ago, *, sessions=2, runs_with_hr=0, run_minutes=0.0):
    """`sessions` sessions spread from the Monday of the week `weeks_ago` complete weeks back."""
    monday = THIS_MONDAY - timedelta(weeks=weeks_ago)
    days = []
    for i in range(sessions):
        is_run = i < runs_with_hr
        days.append(
            DayTraining(
                day=monday + timedelta(days=i),
                sessions=1,
                runs_with_hr=1 if is_run else 0,
                run_minutes=run_minutes / max(runs_with_hr, 1) if is_run else 0.0,
            )
        )
    return days


def _history(weeks, **per_week):
    return [day for k in range(1, weeks + 1) for day in _week(k, **per_week)]


def _athlete_history():
    """Six months of three sessions a week, two of them runs, 180 running minutes a week."""
    return _history(26, sessions=3, runs_with_hr=2, run_minutes=180)


def test_a_new_user_is_level_one():
    out = levels.assess([], today=TODAY, threshold_available=False)
    assert (out.level, out.effective_level, out.state) == (1, 1, levels.STATE_ACTIVE)
    assert out.current == []


def test_a_regular_multi_sport_user_who_does_not_run_stays_at_one():
    out = levels.assess(_history(8, sessions=3), today=TODAY, threshold_available=True)
    assert out.level == 1
    assert out.missing == ["corse_con_cardio"]


def test_other_sports_count_for_consistency():
    """One run and one tennis session: an active week."""
    week = [
        DayTraining(THIS_MONDAY - timedelta(days=7), sessions=1, runs_with_hr=1, run_minutes=60),
        DayTraining(THIS_MONDAY - timedelta(days=5), sessions=1, runs_with_hr=0, run_minutes=0),
    ]
    active = levels.level2_criteria(week, TODAY)[0]
    assert active.measured == 1


def test_the_current_week_does_not_count_until_it_is_complete():
    this_week = [DayTraining(THIS_MONDAY + timedelta(days=i), 1, 1, 40) for i in range(3)]
    assert levels.level2_criteria(this_week, TODAY)[0].measured == 0


def test_a_consistent_runner_reaches_level_two():
    out = levels.assess(_history(8, sessions=2, runs_with_hr=1, run_minutes=40), today=TODAY, threshold_available=False)
    assert out.level == 2
    assert [c.key for c in out.current] == ["settimane_attive", "corse_con_cardio"]


def test_an_athlete_history_with_a_threshold_is_level_three():
    out = levels.assess(_athlete_history(), today=TODAY, threshold_available=True)
    assert out.level == 3
    assert out.next == []
    assert all(c.met for c in out.current)


def test_without_the_threshold_estimate_the_athlete_stays_at_two():
    out = levels.assess(_athlete_history(), today=TODAY, threshold_available=False)
    assert out.level == 2
    assert out.missing == ["soglia"]


def test_the_level_is_never_lowered():
    out = levels.assess([], today=TODAY, threshold_available=False, reached_level=3)
    assert out.level == 3
    assert out.computed_level == 1


def test_progress_is_reported_criterion_by_criterion():
    """4 active weeks of the last 8, 5 runs with heart rate."""
    history = _history(4, sessions=2, runs_with_hr=1, run_minutes=40)
    history += [DayTraining(THIS_MONDAY - timedelta(weeks=6), 1, 1, 40)]
    out = levels.assess(history, today=TODAY, threshold_available=False)

    active, runs = out.next
    assert (active.measured, active.required, active.met) == (4, 6, False)
    assert (runs.measured, runs.met) == (5, True)
    assert out.missing == ["settimane_attive"]


# ---- pause and return -------------------------------------------------------------------


def _trained_until(last_day, *, weeks=26):
    """Three sessions a week up to `last_day`, nothing after."""
    return [day for day in _athlete_history() if day.day <= last_day]


def test_an_injury_break_is_a_pause_with_the_level_kept():
    history = _trained_until(TODAY - timedelta(days=40))
    history.append(DayTraining(TODAY - timedelta(days=10), 1, 1, 20))
    out = levels.assess(history, today=TODAY, threshold_available=True, reached_level=3)
    assert (out.state, out.level, out.effective_level) == (levels.STATE_PAUSE, 3, 2)


def test_coming_back_is_a_return_for_three_weeks():
    first_back = TODAY - timedelta(days=10)
    history = _trained_until(first_back - timedelta(days=35))
    history += [DayTraining(first_back + timedelta(days=i), 1, 1, 30) for i in range(0, 11, 2)]
    out = levels.assess(history, today=TODAY, threshold_available=True, reached_level=3)
    assert (out.state, out.effective_level) == (levels.STATE_RETURN, 2)


def test_after_three_weeks_back_it_is_active_again():
    # The pause ends with the second session back, two days after the first.
    first_back = TODAY - timedelta(days=levels.RETURN_DAYS + 3)
    history = _trained_until(first_back - timedelta(days=35))
    history += [DayTraining(first_back + timedelta(days=i), 1, 1, 30) for i in range(0, 25, 2)]
    out = levels.assess(history, today=TODAY, threshold_available=True, reached_level=3)
    assert (out.state, out.effective_level) == (levels.STATE_ACTIVE, 3)


def test_a_brand_new_user_is_not_in_pause():
    history = [DayTraining(TODAY - timedelta(days=5), 1, 1, 20)]
    assert levels.training_state(history, TODAY) == levels.STATE_ACTIVE


def test_a_brand_new_regular_user_is_not_returning():
    history = [DayTraining(TODAY - timedelta(days=i), 1, 1, 20) for i in range(0, 14, 2)]
    assert levels.training_state(history, TODAY) == levels.STATE_ACTIVE


def test_level_one_in_pause_stays_at_one():
    history = [DayTraining(TODAY - timedelta(days=60 + i), 1, 0, 0) for i in range(0, 10, 2)]
    out = levels.assess(history, today=TODAY, threshold_available=False)
    assert (out.state, out.effective_level) == (levels.STATE_PAUSE, 1)


# ---- adaptation mode --------------------------------------------------------------------


@pytest.mark.parametrize(("level", "mode"), [(1, "automatico"), (2, "automatico"), (3, "proposta")])
def test_the_mode_defaults_from_the_level(level, mode):
    history = _athlete_history()
    out = levels.assess(history, today=TODAY, threshold_available=level == 3, reached_level=level)
    if level < 3:
        out = levels.assess([], today=TODAY, threshold_available=False, reached_level=level)
    assert (out.adaptation_mode, out.adaptation_mode_is_default) == (mode, True)


def test_a_chosen_mode_survives_a_level_change():
    out = levels.assess(_athlete_history(), today=TODAY, threshold_available=True, adaptation_mode="automatico")
    assert out.level == 3
    assert (out.adaptation_mode, out.adaptation_mode_is_default) == ("automatico", False)


def test_the_default_follows_the_effective_level_during_a_pause():
    out = levels.assess([], today=TODAY, threshold_available=False, reached_level=3)
    # No history at all: not a pause, so the level-3 default applies.
    assert out.adaptation_mode == "proposta"
