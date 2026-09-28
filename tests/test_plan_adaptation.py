"""Plan adaptation: events, soften, replan, modes."""

from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from training_plan import plan_adaptation as pa
from training_plan import plan_rules
from training_plan.checkin import CheckIn
from training_plan.levels import DayTraining
from training_plan.plan_generator import session_from_dict
from tests.test_move_check import easy, intervals

TODAY = date(2026, 10, 1)  # Thursday
TUE = TODAY - timedelta(days=2)
TOMORROW = TODAY + timedelta(days=1)


def detect(planned=(), days=(), checkins=(), readiness=None, now=None, planned_hr=None, handled=frozenset()):
    return pa.detect_events(
        today=TODAY, planned=list(planned), days=list(days), checkins=list(checkins), readiness_state=readiness,
        threshold_now=now, threshold_planned=planned_hr, handled=set(handled),
    )


def test_a_skipped_tuesday_is_an_event_once():
    planned = [intervals("t", TUE)]
    [event] = detect(planned)
    assert event.kind == "saltata" and "martedì 29" in event.message.lower()
    assert detect(planned, handled={event.key}) == []


def test_a_short_easy_skip_is_not_an_event():
    assert detect([easy("t", TUE, 20)]) == []


def test_a_very_different_session():
    [event] = detect([easy("t", TUE, 40)], days=[DayTraining(TUE, 1, 1, 80.0)])
    assert event.kind == "diversa" and "80 minuti contro i 40" in event.message


def test_checkins_readiness_and_threshold():
    kinds = {e.kind for e in detect(
        checkins=[CheckIn(TODAY, "dolore", None, "ginocchio"), CheckIn(TODAY - timedelta(days=1), "bene", "troppo")],
        readiness="scarico", now=172, planned_hr=168,
    )}
    assert kinds == {"dolore", "troppo", "prontezza", "soglia"}


def test_the_threshold_event_is_the_same_on_the_next_day():
    first = detect(now=172, planned_hr=168)
    later = pa.detect_events(
        today=TODAY + timedelta(days=1), planned=[], days=[], checkins=[], readiness_state=None,
        threshold_now=172, threshold_planned=168, handled={first[0].key},
    )
    assert later == []


def test_knee_pain_softens_tomorrows_intervals():
    stored = [intervals("q", TOMORROW, "Ripetute 6x3'")]
    events = detect(checkins=[CheckIn(TODAY, "dolore", None, "ginocchio")])
    proposal = pa.build_proposal(events=events, today=TODAY, stored=stored, trained_today=False)
    [change] = proposal.changes
    assert change.before == ["Ripetute 6x3'"] and "Fondo facile" in change.after[0]
    assert "ginocchio" in change.reason
    [update] = proposal.ops["updates"]
    assert plan_rules.session_kind(session_from_dict(update["content"])) == plan_rules.KIND_EASY
    assert proposal.undo["updates"][0]["content"]["title"] == "Ripetute 6x3'"


def test_tiredness_softens_only_the_first_hard_day():
    stored = [intervals("a", TOMORROW), intervals("b", TOMORROW + timedelta(days=1))]
    events = detect(checkins=[CheckIn(TODAY, "stanco", "giusta")])
    proposal = pa.build_proposal(events=events, today=TODAY, stored=stored, trained_today=False)
    assert [c.date for c in proposal.changes] == [TOMORROW]


def test_a_locked_session_is_a_conflict_not_a_change():
    stored = [{**intervals("q", TOMORROW, "Mia"), "locked": True}]
    events = detect(checkins=[CheckIn(TODAY, "dolore", None, "caviglia")])
    proposal = pa.build_proposal(events=events, today=TODAY, stored=stored, trained_today=False)
    assert proposal.changes == [] and "Mia" in proposal.conflicts[0]


def test_replan_is_softened_too():
    stored = [intervals("t", TUE)]
    window = SimpleNamespace(start=TOMORROW, end=TOMORROW + timedelta(days=16))
    proposed = [session_from_dict(intervals(None, TOMORROW, "Nuove ripetute"))]
    replan = lambda: SimpleNamespace(window=window, proposed=proposed, expected=(TODAY, window.end, {}), source="ai")  # noqa: E731
    events = detect(stored, checkins=[CheckIn(TODAY, "dolore", None, "piede")])
    proposal = pa.build_proposal(events=events, today=TODAY, stored=stored, trained_today=False, replan=replan)
    [written] = proposal.ops["replace"]["sessions"]
    assert plan_rules.session_kind(session_from_dict(written)) == plan_rules.KIND_EASY
    assert proposal.source == "ai"
    assert any(c.date == TOMORROW for c in proposal.changes)


# ---- run_check, with the storage faked ------------------------------------------------------


@pytest.fixture
def store(monkeypatch):
    from training_plan import db, plan_store

    state = {"stored": [intervals("q", TOMORROW, "Ripetute")], "rows": [], "updates": []}
    monkeypatch.setattr(db, "get_skeleton", lambda user_id: {})
    monkeypatch.setattr(db, "save_skeleton", lambda user_id, s: None)
    monkeypatch.setattr(plan_store, "list_sessions", lambda user_id: state["stored"])
    monkeypatch.setattr(pa, "handled_events", lambda user_id, today: {k for r in state["rows"] for k in r["keys"]})
    monkeypatch.setattr(
        pa, "_record",
        lambda user_id, today, proposal, status: state["rows"].append({"status": status, "keys": [e.key for e in proposal.events]}) or {"status": status},
    )
    monkeypatch.setattr(plan_store, "update_session", lambda user_id, sid, content, by_user: state["updates"].append((sid, content["title"])))
    return state


def run(mode):
    return pa.run_check(
        "u", TODAY, days=[], checkins=[CheckIn(TODAY, "dolore", None, "ginocchio")], readiness_state=None,
        threshold_now=None, mode=mode, replan=lambda: None,
    )


def test_automatic_applies_at_once(store):
    assert run("automatico") == {"status": "applied"}
    assert store["updates"] and "Fondo facile" in store["updates"][0][1]


def test_proposal_waits(store):
    assert run("proposta") == {"status": "pending"}
    assert store["updates"] == []


def test_handled_events_do_not_come_back(store):
    run("proposta")
    assert run("proposta") is None
