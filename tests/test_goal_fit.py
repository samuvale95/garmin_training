"""Reading a plan that already exists against a race that has just been named.

The failure this is written against is a specific one: saying something confident about
a plan the app cannot actually see. A Garmin calendar carries dates and titles and no
steps, and a reading that treats those as zero kilometres would call a perfectly good
build "thin" -- so the tests below check what is *not* claimed as carefully as what is.
"""

from __future__ import annotations

from datetime import date, timedelta

from training_plan import goal_fit
from training_plan.models import RaceGoal, RepeatBlock, Step, TrainingSession

TODAY = date(2026, 9, 10)


def _run(day: date, km: float, title: str = "Fondo") -> TrainingSession:
    return TrainingSession(
        date=day,
        sport="running",
        title=title,
        steps=[Step(type="interval", duration_type="distance", duration_value=km)],
    )


def _repeats(day: date) -> TrainingSession:
    return TrainingSession(
        date=day,
        sport="running",
        title="Ripetute 6 × 1000",
        steps=[RepeatBlock(reps=6, steps=[Step(type="interval", duration_type="distance", duration_value=1.0)])],
    )


def _bare(day: date) -> TrainingSession:
    """What a Garmin calendar entry looks like once it reaches this code: a title."""
    return TrainingSession(date=day, sport="running", title="Allenamento", steps=[])


def _marathon(days_out: int = 63, target: int | None = 11700) -> RaceGoal:
    return RaceGoal(race_date=TODAY + timedelta(days=days_out), distance_km=42.195, name="Una maratona", target_time_seconds=target)


def _build(weeks: int = 9) -> list[TrainingSession]:
    """A plausible marathon block: easy, repeats, long -- the long run growing, then a
    taper in the last two weeks."""
    sessions: list[TrainingSession] = []
    for week in range(weeks):
        monday = TODAY + timedelta(days=7 * week)
        long_km = 22 + week * 2 if week < weeks - 2 else 14
        sessions += [_run(monday + timedelta(days=1), 10), _repeats(monday + timedelta(days=3)), _run(monday + timedelta(days=6), long_km, "Lungo")]
    return sessions


def _keys(fit: goal_fit.GoalFit) -> set[str]:
    return {o.key for o in fit.observations}


def test_a_plan_written_before_the_goal_is_recognised_as_going_there():
    """The whole point: the sessions were written first, the race named after, and
    nothing had to be re-imported for the two to be read together."""
    fit = goal_fit.assess_plan_fit(_build(), _marathon(), TODAY)
    assert fit.alignment == goal_fit.ALIGNMENT_ON_TRACK
    assert fit.sessions_ahead == 27
    assert fit.weeks_covered == 10
    assert fit.longest_run_km == 34


def test_every_observation_carries_both_numbers():
    """"Il lungo è corto" without the two figures is an opinion; with them it is a
    comparison the user can disagree with."""
    fit = goal_fit.assess_plan_fit(_build(), _marathon(), TODAY)
    longest = next(o for o in fit.observations if o.key == "lungo")
    assert "34 km" in longest.detail
    assert "30" in longest.detail


def test_a_plan_that_stops_early_is_the_headline_not_a_footnote():
    short = [_run(TODAY + timedelta(days=7 * w + 1), 8) for w in range(4)]
    fit = goal_fit.assess_plan_fit(short, _marathon(), TODAY)
    assert fit.alignment == goal_fit.ALIGNMENT_SHORT
    coverage = next(o for o in fit.observations if o.key == "copertura")
    assert coverage.severity == goal_fit.SEVERITY_WATCH


def test_a_short_long_run_for_the_distance_is_flagged():
    flat = [_run(TODAY + timedelta(days=7 * w + 6), 12, "Lungo") for w in range(9)]
    fit = goal_fit.assess_plan_fit(flat, _marathon(), TODAY)
    assert "lungo" in _keys(fit)
    assert next(o for o in fit.observations if o.key == "lungo").severity == goal_fit.SEVERITY_WATCH


def test_the_long_run_guide_scales_with_the_race():
    """12 km is short for a marathon and plenty for a 10k."""
    flat = [_run(TODAY + timedelta(days=7 * w + 6), 12, "Lungo") for w in range(9)]
    ten_k = RaceGoal(race_date=TODAY + timedelta(days=63), distance_km=10.0)
    fit = goal_fit.assess_plan_fit(flat, ten_k, TODAY)
    assert next(o for o in fit.observations if o.key == "lungo").severity == goal_fit.SEVERITY_OK


def test_sessions_with_no_steps_are_declared_unreadable_not_counted_as_zero():
    """A Garmin calendar has no steps. Calling that 0 km would report a plan of nothing
    and then complain the plan is thin."""
    fit = goal_fit.assess_plan_fit([_bare(TODAY + timedelta(days=7 * w + 2)) for w in range(9)], _marathon(), TODAY)
    assert fit.longest_run_km is None
    assert fit.peak_week_km is None
    assert fit.sessions_without_detail == 9
    assert next(o for o in fit.observations if o.key == "dettaglio").severity == goal_fit.SEVERITY_UNKNOWN
    assert fit.alignment == goal_fit.ALIGNMENT_UNKNOWN


def test_no_claim_about_quality_work_is_made_when_the_steps_are_invisible():
    """Those Garmin entries may well be repetitions -- this code cannot see inside them,
    so it must not announce there are none."""
    fit = goal_fit.assess_plan_fit([_bare(TODAY + timedelta(days=7 * w + 2)) for w in range(9)], _marathon(), TODAY)
    assert "qualita" not in _keys(fit)


def test_a_missing_quality_session_is_only_raised_against_a_time_goal():
    easy_only = [_run(TODAY + timedelta(days=7 * w + 6), 30, "Lungo") for w in range(9)]
    with_target = goal_fit.assess_plan_fit(easy_only, _marathon(target=11700), TODAY)
    without_target = goal_fit.assess_plan_fit(easy_only, _marathon(target=None), TODAY)
    assert "qualita" in _keys(with_target)
    assert "qualita" not in _keys(without_target)


def test_a_steep_volume_ramp_is_flagged():
    steep = []
    for week in range(9):
        monday = TODAY + timedelta(days=7 * week)
        steep.append(_run(monday + timedelta(days=6), 10 + week * 6, "Lungo"))
    fit = goal_fit.assess_plan_fit(steep, _marathon(), TODAY)
    assert "crescita" in _keys(fit)


def test_a_plan_with_no_taper_is_flagged():
    """Anchored on the race, and read over the seven days before it: a race on a
    Thursday leaves a three-day final calendar week, which would otherwise pass for a
    taper on its own."""
    goal = _marathon()
    no_taper = []
    for week_back in range(1, 10):
        week_end = goal.race_date - timedelta(days=7 * (week_back - 1) + 1)
        no_taper += [_run(week_end - timedelta(days=3), 21), _run(week_end, 21, "Lungo")]
    fit = goal_fit.assess_plan_fit(no_taper, goal, TODAY)
    assert "scarico" in _keys(fit)


def test_a_real_taper_is_not_flagged():
    """The mirror of the test above, on the same shape of plan: cut the last week and
    the observation must disappear, or it is flagging the calendar, not the training."""
    goal = _marathon()
    tapered = []
    for week_back in range(1, 10):
        week_end = goal.race_date - timedelta(days=7 * (week_back - 1) + 1)
        km = 7 if week_back == 1 else 21
        tapered += [_run(week_end - timedelta(days=3), km), _run(week_end, km, "Lungo")]
    assert "scarico" not in _keys(goal_fit.assess_plan_fit(tapered, goal, TODAY))


def test_only_the_sessions_between_today_and_the_race_are_judged():
    """July is history: naming a goal today cannot change it, and counting it would
    flatter or damn a plan for weeks nobody will run again."""
    past = [_run(TODAY - timedelta(days=7 * w), 40, "Lungo") for w in range(1, 6)]
    fit = goal_fit.assess_plan_fit(past + _build(), _marathon(), TODAY)
    assert fit.sessions_ahead == 27
    assert fit.longest_run_km == 34


def test_a_race_with_nothing_scheduled_before_it_says_so():
    fit = goal_fit.assess_plan_fit([], _marathon(), TODAY)
    assert fit.alignment == goal_fit.ALIGNMENT_SHORT
    assert next(o for o in fit.observations if o.key == "copertura").severity == goal_fit.SEVERITY_WATCH


def test_a_race_already_run_is_not_assessed():
    fit = goal_fit.assess_plan_fit(_build(), _marathon(days_out=-3), TODAY)
    assert fit.alignment == goal_fit.ALIGNMENT_UNKNOWN
    assert fit.headline == "La gara è passata"


def test_the_model_is_handed_the_conclusion_and_no_plan_contents():
    fit = goal_fit.assess_plan_fit(_build(), _marathon(), TODAY)
    facts = goal_fit.fit_facts(fit, _marathon())
    assert facts["giudizio"] == fit.alignment
    assert facts["sedute_da_qui_alla_gara"] == fit.sessions_ahead
    assert all(set(o) == {"cosa", "misura", "peso"} for o in facts["osservazioni"])
    # No titles, no dates, no steps: the model phrases a conclusion, it does not read
    # the training plan.
    assert "Lungo" not in str(facts)
