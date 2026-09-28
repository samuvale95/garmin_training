"""Move warnings: only what the move adds, only for this level, and never twice."""

from datetime import date, timedelta

from training_plan import move_check, plan_rules
from training_plan.checkin import CheckIn
from training_plan.levels import DayTraining
from training_plan.plan_rules import RuleContext

TODAY = date(2026, 9, 28)  # Monday
TUE, WED, THU, SAT, SUN = (TODAY + timedelta(days=d) for d in (1, 2, 3, 5, 6))


def intervals(sid, day, title="Ripetute"):
    return {
        "id": sid, "date": day.isoformat(), "sport": "running", "title": title, "description": None,
        "origin": "ai", "locked": False,
        "steps": [
            {"type": "warmup", "duration_type": "time", "duration_value": 15, "target_pace": {"slower_sec_per_km": 370, "faster_sec_per_km": 350}},
            {"reps": 6, "steps": [
                {"type": "interval", "duration_type": "time", "duration_value": 3, "target_pace": {"slower_sec_per_km": 290, "faster_sec_per_km": 280}},
                {"type": "recovery", "duration_type": "time", "duration_value": 2, "target_pace": None},
            ]},
            {"type": "cooldown", "duration_type": "time", "duration_value": 10, "target_pace": {"slower_sec_per_km": 370, "faster_sec_per_km": 350}},
        ],
    }


def easy(sid, day, minutes=40, title="Facile"):
    return {
        "id": sid, "date": day.isoformat(), "sport": "running", "title": title, "description": None,
        "origin": "ai", "locked": False,
        "steps": [{"type": "interval", "duration_type": "time", "duration_value": minutes, "target_pace": {"slower_sec_per_km": 370, "faster_sec_per_km": 350}}],
    }


def check(stored, sid, day, level=1, checkins=(), confirmed=frozenset(), days=()):
    return move_check.check_move(
        session_id=sid,
        new_date=day,
        stored=stored,
        days=list(days),
        checkins=list(checkins),
        context=RuleContext(level, 150.0, 90.0, TODAY),
        today=TODAY,
        confirmed=set(confirmed),
    )


def test_a_beginner_stacking_two_hard_days_is_warned_with_both_sessions_named():
    stored = [intervals("a", TUE, "Ripetute A"), intervals("b", THU, "Ripetute B")]
    result = check(stored, "b", WED)
    [warning] = [w for w in result.warnings if w.key == "hard_in_a_row"]
    assert set(warning.sessions) == {"a", "b"}
    assert "Ripetute A" in warning.message and "Ripetute B" in warning.message


def test_an_athlete_making_the_same_move_is_not_warned():
    stored = [intervals("a", TUE), intervals("b", THU)]
    assert check(stored, "b", WED, level=3).warnings == []


def test_a_problem_that_was_already_there_is_not_the_moves_fault():
    stored = [intervals("a", TUE), intervals("b", WED), easy("c", SAT)]
    assert check(stored, "c", SUN).warnings == []


def test_hard_the_day_after_the_long_run():
    stored = [easy("long", SAT, 100, "Lungo"), intervals("q", TUE + timedelta(days=7))]
    result = check(stored, "q", SUN, level=2)
    [warning] = [w for w in result.warnings if w.key == "hard_after_long"]
    assert "domenica" in warning.message and "Lungo" in warning.message


def test_pain_before_a_hard_session_warns_at_every_level():
    stored = [intervals("q", THU)]
    pain = [CheckIn(TODAY, "dolore", "giusta", "ginocchio")]
    result = check(stored, "q", TUE, level=3, checkins=pain)
    [warning] = result.warnings
    assert warning.key == "pain_before_hard"
    assert "Dolore al ginocchio segnalato lunedì 28" in warning.message


def test_the_adapted_session_keeps_the_minutes_and_clears_the_warning():
    stored = [intervals("a", TUE), intervals("b", THU)]
    result = check(stored, "b", WED)
    assert result.adapted is not None
    assert plan_rules.session_kind(result.adapted) == plan_rules.KIND_EASY
    assert round(plan_rules.session_duration_minutes(result.adapted)) == 55
    assert result.adapted.date == WED


def test_a_long_run_is_shortened_below_the_line():
    adapted = move_check.adapt(move_check.session_from_dict(easy("l", SAT, 110, "Lungo")))
    assert plan_rules.session_kind(adapted) == plan_rules.KIND_EASY


def test_a_confirmed_sequence_does_not_warn_again():
    stored = [intervals("a", TUE), intervals("b", THU)]
    first = check(stored, "b", WED)
    fingerprints = {w.fingerprint for w in first.warnings}
    assert check(stored, "b", WED, confirmed=fingerprints).warnings == []


def test_yesterdays_long_run_from_the_history_counts():
    stored = [intervals("q", THU)]
    days = [DayTraining(TODAY - timedelta(days=1), 1, 1, 100.0)]
    result = check(stored, "q", TODAY, level=1, days=days)
    assert "hard_after_long" in {w.key for w in result.warnings}


def test_moving_into_the_past_is_not_checked():
    assert check([intervals("q", THU)], "q", TODAY - timedelta(days=2)).warnings == []


def test_a_move_already_saved_is_checked_from_the_day_it_left():
    # The screen saved the move first: the plan already has "b" on Wednesday.
    stored = [intervals("a", TUE), intervals("b", WED)]
    result = move_check.check_move(
        session_id="b", new_date=WED, stored=stored, days=[], checkins=[],
        context=RuleContext(1, 150.0, 90.0, TODAY), today=TODAY, from_date=THU,
    )
    assert "hard_in_a_row" in {w.key for w in result.warnings}
