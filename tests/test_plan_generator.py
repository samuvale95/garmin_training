"""The plan generator: window, checks, retries, fallback -- no database, no model."""

import json
from datetime import date, timedelta

import pytest

from training_plan import plan_generator as gen
from training_plan import plan_rules
from training_plan.levels import DayTraining
from training_plan.models import RaceGoal
from training_plan.paces import PaceEstimate, PaceProfile
from training_plan.plan_rules import RuleContext
from training_plan.plan_skeleton import SkeletonInputs, build_skeleton

SUNDAY = date(2026, 9, 27)
MONDAY = SUNDAY + timedelta(days=1)


def profile(easy=360, threshold=300):
    return PaceProfile(
        easy=PaceEstimate(heart_rate=140, sec_per_km=easy, samples=1000, faster_sec_per_km=easy - 10, slower_sec_per_km=easy + 10),
        threshold=PaceEstimate(
            heart_rate=170, sec_per_km=threshold, samples=1000, faster_sec_per_km=threshold - 10, slower_sec_per_km=threshold + 10
        ),
    )


def window(level=3, weekly=181.0, longest=120.0, today=SUNDAY, stored=(), bands=True, goal=None, days=()):
    ctx = RuleContext(level, weekly, longest, today)
    start, _ = gen.window_dates(today, goal)
    skeleton = build_skeleton(
        SkeletonInputs(
            start=start - timedelta(days=start.weekday()),
            effective_level=level,
            recent_weekly_minutes=weekly,
            recent_running_days=4,
            goal=goal,
        )
    )
    return gen.build_window(
        today=today,
        skeleton=skeleton,
        context=ctx,
        stored=list(stored),
        days=list(days),
        bands=gen.pace_bands(profile()) if bands else None,
        goal=goal,
    )


def as_json(sessions):
    """Sessions in the plan-file shape the model is asked for."""
    out = []
    for s in sessions:
        steps = []
        for step in s.steps:
            if hasattr(step, "reps"):
                steps.append({"repeat": step.reps, "steps": [_step(x) for x in step.steps]})
            else:
                steps.append(_step(step))
        out.append({"date": s.date.isoformat(), "sport": s.sport, "title": s.title, "description": s.description, "steps": steps})
    return json.dumps({"sessions": out})


def _step(step):
    data = {"type": step.type, "duration_type": step.duration_type, "duration_value": step.duration_value}
    if step.target_pace:
        p = step.target_pace
        data["target_pace"] = f"{p.slower_sec_per_km // 60}:{p.slower_sec_per_km % 60:02d}-{p.faster_sec_per_km // 60}:{p.faster_sec_per_km % 60:02d}"
    return data


# ---- window -----------------------------------------------------------------------------------


def test_generating_on_a_sunday_covers_the_next_three_weeks():
    assert gen.window_dates(SUNDAY) == (date(2026, 9, 28), date(2026, 10, 18))


def test_generating_on_a_monday_covers_the_rest_of_the_week_and_two_more():
    assert gen.window_dates(MONDAY) == (date(2026, 9, 29), date(2026, 10, 18))


def test_the_window_stops_at_the_race():
    goal = RaceGoal(race_date=date(2026, 10, 4), distance_km=10.0, name="Stracittadina")
    w = window(goal=goal)
    assert w.end == date(2026, 10, 4)
    assert [s.title for s in w.fixed] == ["Gara: Stracittadina"]


def test_week_targets_are_capped_by_todays_limit():
    # A skeleton stored when the user averaged 181 minutes wants 200 in its first week;
    # they have since dropped to 150, and +20% on 150 is 180.
    skeleton = build_skeleton(SkeletonInputs(MONDAY, 3, 181.0, 4))
    w = gen.build_window(
        today=SUNDAY,
        skeleton=skeleton,
        context=RuleContext(3, 150.0, 120.0, SUNDAY),
        stored=[],
        days=[],
        bands=None,
        goal=None,
    )
    assert w.weeks[0].skeleton.target_minutes == 200
    assert w.weeks[0].target == 180
    assert "al massimo 180 minuti" in w.weeks[0].target_reason


def test_what_was_run_this_week_counts_towards_the_target():
    days = [DayTraining(MONDAY, 1, 1, 50.0)]
    w = window(today=MONDAY + timedelta(days=1), days=days)
    assert w.weeks[0].fixed_minutes == 50.0
    assert w.weeks[0].to_plan == w.weeks[0].target - 50


# ---- checks -----------------------------------------------------------------------------------


def test_the_fallback_passes_every_check_for_every_level():
    for level in (1, 2, 3):
        for bands in (True, False):
            w = window(level=level, bands=bands)
            sessions = gen.compose_fallback(w)
            assert sessions, (level, bands)
            assert gen.check(sessions, w) == [], (level, bands)


def test_the_fallback_passes_for_a_beginner_with_no_history():
    w = window(level=1, weekly=None, longest=None, bands=False)
    sessions = gen.compose_fallback(w)
    assert gen.check(sessions, w) == []
    assert all(plan_rules.session_kind(s) == plan_rules.KIND_EASY for s in sessions)


def test_an_invented_pace_is_rejected():
    w = window()
    sessions = gen.compose_fallback(w)
    quality = next(s for s in sessions if plan_rules.session_kind(s) == plan_rules.KIND_QUALITY)
    quality.steps[1].steps[0].target_pace.faster_sec_per_km = 205
    quality.steps[1].steps[0].target_pace.slower_sec_per_km = 215
    errors = gen.check(sessions, w)
    assert any("3:30/km" in e and "fuori dalle fasce" in e for e in errors)


def test_no_profile_means_no_paces():
    w = window(bands=False)
    sessions = gen.compose_fallback(window(bands=True))
    assert any("nessun passo può avere un ritmo" in e for e in gen.check(sessions, w))


def test_a_rule_violation_blocks_the_proposal():
    w = window(level=2, weekly=150.0)
    sessions = gen.compose_fallback(w)
    long_run = next(s for s in sessions if s.title.startswith("Lungo"))
    quality = next(s for s in sessions if plan_rules.session_kind(s) == plan_rules.KIND_QUALITY)
    # Make the long run a real long run and put the quality session the day after it.
    long_run.steps[0].duration_value = 90
    quality.date = long_run.date + timedelta(days=1)
    errors = gen.check([s for s in sessions if s.date != quality.date or s is quality], w)
    assert any("il giorno dopo il lungo" in e for e in errors)


def test_a_session_on_a_locked_day_is_rejected():
    locked_day = SUNDAY + timedelta(days=3)
    stored = [
        {"id": "x", "date": locked_day.isoformat(), "sport": "running", "title": "Mia", "description": None,
         "steps": [{"type": "interval", "duration_type": "time", "duration_value": 30, "target_pace": None}],
         "origin": "manual", "locked": True}
    ]
    w = window(stored=stored)
    assert [s.title for s in w.locked] == ["Mia"]
    sessions = gen.compose_fallback(w)
    assert locked_day not in {s.date for s in sessions}
    assert gen.check(sessions, w) == []
    clash = gen.compose_fallback(window())
    assert any("seduta fissa" in e for e in gen.check(clash, w)) or locked_day not in {s.date for s in clash}


# ---- the model loop ---------------------------------------------------------------------------


def test_a_failed_proposal_is_sent_back_and_fixed_on_the_second_attempt():
    w = window()
    good = gen.compose_fallback(w)
    too_much = [*good]
    too_much[0] = gen._easy_run(too_much[0].date, 170, w.bands)
    answers = iter([as_json(too_much), as_json(good)])
    seen = []

    def compose(messages):
        seen.append(messages)
        return next(answers)

    attempts = gen.ask_model(w, compose)
    assert attempts.count == 2
    assert attempts.sessions is not None and len(attempts.sessions) == len(good)
    feedback = seen[1][-1]["content"]
    assert "non rispetta questi vincoli" in feedback


def test_three_bad_answers_give_up():
    w = window()
    attempts = gen.ask_model(w, lambda messages: "non è json")
    assert attempts.sessions is None
    assert attempts.count == 3
    assert "3 tentativi" in attempts.reason


def test_an_unreachable_model_stops_at_once():
    attempts = gen.ask_model(window(), lambda messages: None)
    assert attempts.count == 1 and attempts.reason == "modello non raggiungibile"


def test_the_time_budget_stops_retrying():
    ticks = iter([0.0, 200.0])
    attempts = gen.ask_model(window(), lambda messages: "{}", clock=lambda: next(ticks))
    assert attempts.count == 1 and attempts.reason == "tempo esaurito"


def test_the_brief_carries_the_limits_and_the_locked_sessions():
    locked_day = SUNDAY + timedelta(days=3)
    stored = [
        {"id": "x", "date": locked_day.isoformat(), "sport": "running", "title": "Mia", "description": None,
         "steps": [], "origin": "manual", "locked": True}
    ]
    facts = json.loads(gen.brief(window(stored=stored))[1]["content"])
    assert facts["sedute_fisse"][0]["titolo"] == "Mia"
    assert locked_day.isoformat() not in facts["settimane"][0]["giorni_disponibili"]
    assert facts["fasce_di_ritmo"]["facile"]
    assert any("giorni duri di fila" in rule for rule in facts["regole"])


# ---- skeleton reuse ---------------------------------------------------------------------------


def test_the_stored_skeleton_is_reused_until_its_inputs_change():
    weeks = build_skeleton(SkeletonInputs(MONDAY, 3, 181.0, 4))
    stored = {"inputs": {"goal": None, "effective_level": 3}, "weeks": [w.to_dict() for w in weeks]}
    mondays = [MONDAY, MONDAY + timedelta(weeks=1)]
    assert gen.skeleton_is_current(stored, goal=None, level=3, mondays=mondays)
    assert not gen.skeleton_is_current(stored, goal={"race_date": "2026-12-01", "distance_km": 10}, level=3, mondays=mondays)
    assert not gen.skeleton_is_current(stored, goal=None, level=2, mondays=mondays)
    assert not gen.skeleton_is_current(stored, goal=None, level=3, mondays=[MONDAY + timedelta(weeks=5)])


def test_recent_running_days_is_the_median_week():
    days = [DayTraining(MONDAY - timedelta(weeks=w, days=d), 1, 1, 30.0) for w in (1, 2, 3, 4) for d in (1, 3)]
    assert gen.recent_running_days(days, MONDAY) == 2
    assert gen.recent_running_days([], MONDAY) is None


def test_one_generation_at_a_time():
    with gen._one_at_a_time("u1"):
        with pytest.raises(gen.GenerationInProgress):
            with gen._one_at_a_time("u1"):
                pass
    with gen._one_at_a_time("u1"):
        pass


# ---- generate, with the storage faked ----------------------------------------------------------


@pytest.fixture
def storage(monkeypatch):
    from training_plan import db, llm, plan_store

    state = {"skeleton": None, "replaced": None, "stored": [], "configured": False}
    monkeypatch.setattr(
        plan_rules, "gather_context", lambda user_id, today, threshold_available: (RuleContext(3, 181.0, 120.0, today), [])
    )
    monkeypatch.setattr(db, "current_goal", lambda user_id: None)
    monkeypatch.setattr(db, "get_skeleton", lambda user_id: state["skeleton"])
    monkeypatch.setattr(db, "save_skeleton", lambda user_id, skeleton: state.update(skeleton=skeleton))
    monkeypatch.setattr(plan_store, "list_sessions", lambda user_id: state["stored"])
    monkeypatch.setattr(llm, "configured", lambda: state["configured"])

    state["snapshots"] = [{}]  # one per call; the last repeats
    state["changed"] = 0  # how many writes to refuse as "plan changed"

    def snapshot(user_id, start, end):
        return state["snapshots"][0] if len(state["snapshots"]) == 1 else state["snapshots"].pop(0)

    def replace(user_id, start, end, sessions, origin, expected=None):
        if state["changed"]:
            state["changed"] -= 1
            raise plan_store.PlanChanged(user_id)
        state["replaced"] = (start, end, list(sessions), origin)
        return plan_store.ReplaceResult(written=list(sessions), conflicts=[])

    monkeypatch.setattr(plan_store, "snapshot", snapshot)

    monkeypatch.setattr(plan_store, "replace_unlocked", replace)
    return state


def test_without_a_model_the_rules_write_the_window(storage):
    result = gen.generate("u1", SUNDAY, profile=profile(), threshold_available=True)
    assert result.source == gen.SOURCE_RULES
    assert result.fallback_reason == "modello non configurato"
    assert result.skeleton_regenerated
    start, end, sessions, origin = storage["replaced"]
    assert (start, end, origin) == (date(2026, 9, 28), date(2026, 10, 18), "ai")
    assert sessions and all(start.isoformat() <= s["date"] <= end.isoformat() for s in sessions)


def test_the_model_plan_is_written_when_it_passes(storage):
    storage["configured"] = True
    first = gen.generate("u1", SUNDAY, profile=profile(), threshold_available=True)
    answer = as_json([gen.session_from_dict(s) for s in storage["replaced"][2]])
    result = gen.generate("u1", SUNDAY, profile=profile(), threshold_available=True, compose=lambda messages: answer)
    assert first.source == gen.SOURCE_RULES  # the default compose has no key in tests
    assert result.source == gen.SOURCE_AI and result.attempts == 1
    assert not result.skeleton_regenerated


def test_a_hand_edited_session_is_planned_around(storage):
    locked_day = date(2026, 10, 1)
    storage["stored"] = [
        {"id": "x", "date": locked_day.isoformat(), "sport": "running", "title": "Mia", "description": None,
         "steps": [{"type": "interval", "duration_type": "time", "duration_value": 30, "target_pace": None}],
         "origin": "manual", "locked": True}
    ]
    gen.generate("u1", SUNDAY, profile=profile(), threshold_available=True)
    written_days = {s["date"] for s in storage["replaced"][2]}
    assert locked_day.isoformat() not in written_days


LOCKED_THURSDAY = {
    "id": "x", "date": "2026-10-01", "sport": "running", "title": "Mia", "description": None,
    "steps": [{"type": "interval", "duration_type": "time", "duration_value": 30, "target_pace": None}],
    "origin": "manual", "locked": True,
}


def test_a_plan_edited_during_generation_is_rechecked_before_writing(storage):
    # The model plans an empty window; while it writes, the user locks Thursday. The
    # write is refused, the proposal no longer fits (it has a run on Thursday), so the
    # rules write a window around the user's session instead.
    storage["configured"] = True
    w = window()
    proposal = gen.compose_fallback(w)
    assert date(2026, 10, 1) in {s.date for s in proposal}
    answer = as_json(proposal)
    storage["changed"] = 1

    def compose(messages):
        storage["stored"] = [LOCKED_THURSDAY]
        return answer

    result = gen.generate("u1", SUNDAY, profile=profile(), threshold_available=True, compose=compose)
    assert result.source == gen.SOURCE_RULES
    assert result.fallback_reason == "hai modificato il piano mentre lo scrivevo"
    assert "2026-10-01" not in {s["date"] for s in storage["replaced"][2]}


def test_a_plan_that_keeps_changing_gives_up_without_writing(storage):
    storage["changed"] = 99
    with pytest.raises(gen.GenerationFailed):
        gen.generate("u1", SUNDAY, profile=profile(), threshold_available=True)
    assert storage["replaced"] is None
