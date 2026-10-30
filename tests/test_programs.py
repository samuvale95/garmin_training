"""Pure review and real, local-only PostgreSQL transaction/concurrency proofs.

Integration tests require PASSO_TEST_DATABASE_URL pointing at localhost or a Unix
socket. They create/drop only their own random schema; DATABASE_URL is never used.
"""
import copy
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, timedelta
from uuid import uuid4

import psycopg
import pytest
from psycopg.conninfo import conninfo_to_dict

from training_plan import db, history, plan_generator, plan_rules, plan_store, programs


def session(day=2, title="Corsa facile", sport="running", minutes=30):
    return {"date":(date.today()+timedelta(days=day)).isoformat(),"sport":sport,"title":title,
            "steps":[{"type":"interval","duration_type":"time","duration_value":minutes}]}


def context(sessions=(),plans=(),constraints=None):
    return {"revision":1,"sessions":list(sessions),"plans":list(plans),"active_ids":[p["id"] for p in plans if p["is_active"]],
            "goals":[],"constraints":constraints}


def draft(sessions=(),**kw):
    return {"name":"Proposta","source":"import","mode":"new","sessions":list(sessions),**kw}


def test_review_counts_all_programs_and_never_combines_sport_distances():
    existing={**session(sport="cycling"),"id":"bike","plan_id":"p2","locked":False}
    ctx=context([existing],[{"id":"p2","name":"Bici","is_active":True}],
                {"available_days":list(range(7)),"max_sessions_per_day":1,"max_daily_minutes":120})
    checked=programs.review(draft([session()]),ctx)
    assert checked["status"]=="conflict"
    assert "daily_sessions" in {c["code"] for c in checked["conflicts"]}
    assert checked["impact"]["preserved"]==[existing]


def test_replace_preserves_today_past_locked_and_outside_window():
    current=[{**session(day=n,title=str(n)),"id":str(n),"plan_id":"old","locked":n==3} for n in (-1,0,2,3,50)]
    ctx=context(current,[{"id":"old","name":"Piano","is_active":True}])
    checked=programs.review(draft([session(day=2)],mode="replace",target_plan_id="old"),ctx)
    assert [s["id"] for s in checked["impact"]["removed"]]==["2"]
    assert {s["id"] for s in checked["impact"]["preserved"]}=={"-1","0","3","50"}


def test_time_budget_uses_active_short_variant_and_conservative_pace_bound():
    long={**session(minutes=60),"short_variant":{"title":"Breve","steps":session(minutes=30)["steps"]},"is_short_active":True}
    assert programs._known_minutes(long)==30
    distance={**session(),"steps":[{"type":"interval","duration_type":"distance","duration_value":10,
                                    "target_pace":{"faster_sec_per_km":300,"slower_sec_per_km":420}}]}
    assert programs._known_minutes(distance)==70
    del distance["steps"][0]["target_pace"]
    assert programs._known_minutes(distance) is None


@pytest.mark.parametrize("value",[0,-1,float("nan"),float("inf")])
def test_both_import_and_api_sessions_reject_nonpositive_or_nonfinite_steps(value):
    with pytest.raises(programs.PlanningError):
        programs.validate_sessions([session(minutes=value)])


def test_non_race_goal_needs_no_distance_or_finish_time():
    goal=programs.validate_goal({"type":"maintenance","name":"Muovermi con regolarità"})
    assert goal["type"]=="maintenance"
    assert "distance_km" not in goal


@pytest.fixture
def local_store(monkeypatch):
    url=os.getenv("PASSO_TEST_DATABASE_URL")
    if not url:
        pytest.skip("PASSO_TEST_DATABASE_URL non configurato: richiede PostgreSQL locale isolato")
    info=conninfo_to_dict(url)
    if info.get("host") not in ("localhost","127.0.0.1","::1","/tmp","/private/tmp"):
        pytest.fail("I test di integrazione rifiutano database remoti")
    schema="passo_test_"+uuid4().hex
    with psycopg.connect(url) as conn:
        conn.execute(f'CREATE SCHEMA "{schema}"')
    def connect():
        return psycopg.connect(url,options=f"-c search_path={schema} -c statement_timeout=8000 -c lock_timeout=5000")
    monkeypatch.setattr(db,"connect",connect)
    db.ensure_schema()
    history.ensure_schema()
    plan_store.ensure_schema()
    programs.ensure_schema()
    yield connect
    with psycopg.connect(url) as conn:
        conn.execute(f'DROP SCHEMA "{schema}" CASCADE')


def seed(user="u",plan_id="running",sessions=()):
    db.ensure_plan(user,plan_id=plan_id,name=plan_id)
    return [plan_store.create_session(user,s,origin="import",plan_id=plan_id) for s in sessions]


def reviewed(user="u",sessions=None,**kw):
    proposal=programs.create_draft(user,draft([session()] if sessions is None else sessions,**kw))
    return programs.validate_draft(user,proposal["id"],proposal["revision"])


def activate(proposal,user="u",**kw):
    return programs.activate_draft(user,proposal["id"],proposal["revision"],proposal["validation"]["token"],True,**kw)


def test_draft_and_validation_leave_every_active_row_unchanged(local_store):
    stored=seed(sessions=[session(title="Originale")])
    before=db.get_plan("u",plan_id="running")
    proposal=reviewed(sessions=[session(day=3)])
    assert proposal["status"]=="ready"
    assert plan_store.list_sessions("u")==stored
    assert db.get_plan("u",plan_id="running")==before
    assert len(db.list_plans("u"))==1
    with pytest.raises(programs.PlanningError) as exc:
        programs.get_draft("another-user",proposal["id"])
    assert exc.value.status==404


def test_invalid_import_is_recoverable_and_patch_retains_new_source(local_store):
    before=seed(sessions=[session()])
    proposal=programs.create_draft("u",draft(original_yaml="sessions: [invalid]"))
    assert proposal["status"]=="failed" and proposal["original_yaml"]=="sessions: [invalid]"
    changed=programs.patch_draft("u",proposal["id"],proposal["revision"],{"original_yaml":"sessions: [still invalid]"})
    assert changed["status"]=="failed" and changed["original_yaml"]=="sessions: [still invalid]"
    assert plan_store.list_sessions("u")==before


def test_import_recognizes_goal_without_associating_or_changing_it(local_store):
    text=f'''goal:\n  race_date: 2027-04-11\n  distance_km: 21.1\nsessions:\n  - date: {session()["date"]}\n    sport: running\n    title: Facile\n    steps:\n      - type: interval\n        duration_type: time\n        duration_value: 30\n'''
    proposal=programs.create_draft("u",draft(original_yaml=text))
    assert proposal["parsed_goal"]["distance_km"]==21.1
    assert proposal["goal_id"] is None
    assert programs.list_goals("u")==[]


def test_atomic_activation_preserves_other_program_and_retries_without_duplicate(local_store):
    original=seed(sessions=[session()])
    proposal=reviewed(sessions=[session(day=3,sport="strength_training")])
    with ThreadPoolExecutor(2) as pool:
        results=list(pool.map(lambda _:activate(proposal),range(2)))
    assert results[0]==results[1]
    assert len(plan_store.list_sessions("u"))==2
    assert next(s for s in plan_store.list_sessions("u") if s["id"]==original[0]["id"])==original[0]
    assert len(db.get_active_plans("u"))==2
    assert programs.get_draft("u",proposal["id"])["status"]=="active"


@pytest.mark.parametrize("change",["session","program","goal","constraint","activity"])
def test_any_involved_context_change_invalidates_review(local_store,change):
    existing=seed(sessions=[session()])[0]
    goal=programs.create_goal("u",{"type":"fitness","name":"Resistenza"})
    proposal=reviewed(sessions=[session(day=3)])
    if change=="session": plan_store.update_session("u",existing["id"],{"title":"Modificata"},by_user=True)
    elif change=="program": db.set_plan_active("u","running",False)
    elif change=="goal": programs.patch_goal("u",goal["id"],1,{"name":"Nuovo target"})
    elif change=="constraint": programs.save_constraints("u",{"expected_revision":0,"available_days":[0,1],"max_sessions_per_day":1})
    else: history.save_activity("u","garmin",42,date.today(),{"sport":"running","duration_min":30})
    with pytest.raises(programs.PlanningError) as exc: activate(proposal)
    assert exc.value.status==409
    assert len(db.list_plans("u"))==1


def test_conflicting_import_and_explicit_acknowledgment_cannot_bypass_hard_limits(local_store):
    seed(sessions=[session()])
    programs.save_constraints("u",{"expected_revision":0,"available_days":list(range(7)),"max_daily_minutes":40,"max_sessions_per_day":1})
    proposal=reviewed(sessions=[session(sport="strength_training")])
    assert proposal["validation"]["status"]=="conflict"
    with pytest.raises(programs.PlanningError): activate(proposal)
    assert len(plan_store.list_sessions("u"))==1


def test_insufficient_data_requires_explicit_acknowledgment(local_store):
    proposal=reviewed()
    with pytest.raises(programs.PlanningError) as exc:
        programs.activate_draft("u",proposal["id"],proposal["revision"],proposal["validation"]["token"])
    assert exc.value.status==422
    assert db.list_plans("u")==[]


def test_transaction_rolls_back_program_sessions_and_applied_marker(local_store):
    proposal=reviewed(sessions=[session(title="First"),session(day=3,title="Break")])
    with local_store() as conn:
        conn.execute("""CREATE FUNCTION fail_test_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.title='Break' THEN RAISE EXCEPTION 'injected storage failure'; END IF; RETURN NEW; END $$""")
        conn.execute("CREATE TRIGGER inject_failure BEFORE INSERT ON plan_session FOR EACH ROW EXECUTE FUNCTION fail_test_insert()")
    with pytest.raises(psycopg.errors.RaiseException): activate(proposal)
    assert db.list_plans("u")==[]
    assert plan_store.list_sessions("u")==[]
    assert programs.get_draft("u",proposal["id"])["status"]=="ready"
    with local_store() as conn: conn.execute("DROP TRIGGER inject_failure ON plan_session")
    activate(proposal)
    assert len(plan_store.list_sessions("u"))==2


def test_legacy_row_lock_writer_and_activation_have_consistent_lock_order(local_store,monkeypatch):
    existing=seed(sessions=[session()])[0]
    proposal=reviewed(sessions=[session(day=3)])
    writer_locked=threading.Event()
    allow_commit=threading.Event()
    original=local_store
    class ObservedCursor(psycopg.Cursor):
        def execute(self,query,params=None,**kwargs):
            result=super().execute(query,params,**kwargs)
            if isinstance(query,str) and query.startswith("SELECT locked FROM plan_session"):
                writer_locked.set()
                assert allow_commit.wait(4)
            return result
    def observed_connection():
        conn=original()
        conn.cursor_factory=ObservedCursor
        return conn
    monkeypatch.setattr(db,"connect",observed_connection)
    with ThreadPoolExecutor(2) as pool:
        writer=pool.submit(plan_store.update_session,"u",existing["id"],{"title":"Edited"},by_user=True)
        assert writer_locked.wait(3)
        activation=pool.submit(activate,proposal)
        allow_commit.set()
        assert writer.result(timeout=5)["title"]=="Edited"
        with pytest.raises(programs.PlanningError) as exc: activation.result(timeout=5)
        assert exc.value.status==409
    assert len(plan_store.list_sessions("u"))==1


def test_goal_versions_evaluations_and_links_survive_archive_and_target_edit(local_store):
    seed(sessions=[session()])
    goal=programs.create_goal("u",{"type":"strength","name":"Più forza","sports":["strength_training"]})
    links=programs.program_goals("u","running")
    programs.link_program_goals("u","running",{"expected_context_revision":links["context_revision"],"primary_goal_id":goal["id"]})
    observation=programs.evaluate_goal("u",goal["id"])
    assert observation["status"]=="insufficient_data"
    assert observation["execution"]["completed_sessions"] is None
    changed=programs.patch_goal("u",goal["id"],1,{"name":"Target modificato","status":"archived"})
    assert changed["revision"]==2
    assert len(programs.get_goal("u",goal["id"])["history"])==2
    assert programs.list_evaluations("u",goal["id"])[0]["goal_revision"]==1
    db.set_plan_active("u","running",False)
    assert programs.list_evaluations("u",goal["id"])[0]["id"]==observation["id"]


def test_primary_race_goal_mirror_updates_atomically_and_free_program_has_no_race(local_store):
    seed()
    race=programs.create_goal("u",{"type":"race","name":"Gara","race_date":"2027-04-11","distance_km":21.1})
    links=programs.program_goals("u","running")
    programs.link_program_goals("u","running",{"expected_context_revision":links["context_revision"],"primary_goal_id":race["id"]})
    programs.patch_goal("u",race["id"],1,{"distance_km":10})
    assert db.current_goal("u",plan_id="running")["distance_km"]==10
    seed(plan_id="free")
    assert db.current_goal("u",plan_id="free") is None


def test_reactivation_requires_current_review_and_respects_constraints(local_store):
    seed(sessions=[session()])
    seed(plan_id="strength",sessions=[session(sport="strength_training")])
    db.set_plan_active("u","strength",False)
    programs.save_constraints("u",{"expected_revision":0,"available_days":list(range(7)),"max_sessions_per_day":1})
    check=programs.review_activation("u","strength")
    assert check["conflicts"]
    with pytest.raises(programs.PlanningError): programs.toggle_program("u","strength",True,check["token"],True)
    assert not db.get_plan("u",plan_id="strength").is_active


def test_stale_generation_lease_recovers_on_read_and_preserves_inputs(local_store):
    proposal=programs.create_draft("u",draft(source="ai",inputs={"sports":["running"],"user_prompt":"Originale"}))
    started=programs.begin_generation("u",proposal["id"],1)
    assert started["status"]=="generating"
    with local_store() as conn:
        conn.execute("UPDATE program_draft SET updated_at=now()-interval '16 minutes' WHERE id=%s",[proposal["id"]])
    recovered=programs.get_draft("u",proposal["id"])
    assert recovered["status"]=="failed"
    assert recovered["inputs"]["user_prompt"]=="Originale"
    programs.begin_generation("u",recovered["id"],recovered["revision"])


def test_unsupported_generation_sport_fails_without_changing_active_plan(local_store):
    seed(sessions=[session()])
    proposal=programs.create_draft("u",draft(source="ai",inputs={"sports":["strength_training"]}))
    with pytest.raises(programs.PlanningError,match="soltanto programmi corsa"):
        programs.begin_generation("u",proposal["id"],1)
    assert programs.get_draft("u",proposal["id"])["status"]=="draft"
    assert len(plan_store.list_sessions("u"))==1


def test_dry_run_generator_does_not_create_or_mutate_any_program_or_skeleton(local_store,monkeypatch):
    seed(sessions=[session()])
    before=db.get_plan("u",plan_id="running")
    monkeypatch.setattr(plan_rules,"gather_context",lambda user_id,today,threshold_available:(plan_rules.RuleContext(1,None,None,today),[]))
    result=plan_generator.generate("u",date.today(),profile=None,threshold_available=False,write=False,
                                   plan_id="new-draft",goal_override=None,context_sessions=plan_store.list_sessions("u"))
    assert result.skeleton and result.proposed
    assert len(db.list_plans("u"))==1
    assert db.get_plan("u",plan_id="running")==before


def test_legacy_import_and_generation_are_guarded_with_readable_errors(monkeypatch,local_store):
    from fastapi.testclient import TestClient
    from training_plan.api.app import app
    monkeypatch.setenv("DEV_AUTH_BYPASS_USER_ID","u")
    with TestClient(app,raise_server_exceptions=True) as client:
        response=client.post("/plan/generate",json={})
        assert response.status_code==409 and response.json()["message"]
        response=client.put("/plan",json={"yaml_text":"x","sessions":[session()],"imported_at":"now","import":True})
        assert response.status_code==409 and response.json()["message"]


def test_repeated_migration_does_not_duplicate_new_race_or_recreate_replaced_links(local_store):
    race=programs.create_goal("u",{"type":"race","name":"Gara","race_date":"2027-04-11","distance_km":21.1})
    proposal=reviewed(goal_id=race["id"])
    result=activate(proposal)
    programs.ensure_schema()
    programs.ensure_schema()
    assert [g["id"] for g in programs.list_goals("u")]==[race["id"]]
    links=programs.program_goals("u",result["plan_id"])
    assert links["primary_goal_id"]==race["id"] and links["contributing_goal_ids"]==[]
    fitness=programs.create_goal("u",{"type":"fitness","name":"Resistenza"})
    links=programs.program_goals("u",result["plan_id"])
    programs.link_program_goals("u",result["plan_id"],{"expected_context_revision":links["context_revision"],"primary_goal_id":fitness["id"]})
    programs.ensure_schema()
    assert programs.program_goals("u",result["plan_id"])["primary_goal_id"]==fitness["id"]
    assert len(programs.list_goals("u"))==2


def test_legacy_migration_is_once_only_after_primary_goal_relink(local_store):
    db.save_plan(user_id="u",yaml_text="",filename=None,imported_at="now",plan_id="legacy",
                 goal={"race_date":"2027-04-11","distance_km":21.1,"name":"Gara"})
    programs.ensure_schema()
    old=programs.list_goals("u")[0]
    fresh=programs.create_goal("u",{"type":"race","name":"Nuova gara","race_date":"2027-06-01","distance_km":10})
    links=programs.program_goals("u","legacy")
    programs.link_program_goals("u","legacy",{"expected_context_revision":links["context_revision"],"primary_goal_id":fresh["id"]})
    programs.ensure_schema()
    programs.ensure_schema()
    assert programs.program_goals("u","legacy")["primary_goal_id"]==fresh["id"]
    assert programs.get_goal("u",old["id"])["linked_program_ids"]==[]


def test_archived_goal_and_standalone_target_are_not_used_by_legacy_generator(local_store):
    db.set_standalone_goal("u",{"race_date":"2027-04-11","distance_km":21.1,"name":"Gara"})
    programs.ensure_schema()
    programs.patch_goal("u","legacy-standalone",1,{"distance_km":10})
    assert db.current_goal("u")["distance_km"]==10
    programs.patch_goal("u","legacy-standalone",2,{"status":"archived"})
    assert db.current_goal("u") is None


def test_meal_preview_never_enters_diary_and_confirmation_is_idempotent(local_store,monkeypatch):
    from fastapi.testclient import TestClient
    from training_plan.api.app import app
    monkeypatch.setenv("DEV_AUTH_BYPASS_USER_ID","u")
    client=TestClient(app)
    response=client.post("/nutrition/describe?preview=true",json={"date":date.today().isoformat(),"text":"Pasta al pomodoro"})
    assert response.status_code==200
    assert response.json()["id"]==0
    assert db.entries_for_date("u",date.today().isoformat())==[]
    data={"request_id":str(uuid4()),"date":date.today().isoformat(),"source":"text","description":"Pasta", "kcal":500,"carb_g":70}
    responses=[client.post("/nutrition/confirm",json=data) for _ in range(2)]
    assert all(r.status_code==200 for r in responses)
    assert responses[0].json()["id"]==responses[1].json()["id"]
    assert len(db.entries_for_date("u",date.today().isoformat()))==1
    conflict=client.post("/nutrition/confirm",json={**data,"kcal":600})
    assert conflict.status_code==409


def test_mean_frequency_does_not_claim_consistency_with_empty_weeks(local_store):
    goal=programs.create_goal("u",{"type":"consistency","name":"Tre volte a settimana","success_criterion":{"metric":"sessions_per_week","target":3}})
    for i in range(12):
        history.save_activity("u","garmin",i+1,date.today()-timedelta(days=25),{"sport":"running","duration_min":30})
    observation=programs.evaluate_goal("u",goal["id"])
    assert observation["status"]=="insufficient_data"
    assert any(e["metric"]=="sessions_by_complete_week" for e in observation["progress"]["evidence"])


def test_race_evaluation_reuses_specific_goal_assessments_and_preserves_prediction_label(local_store):
    goal=programs.create_goal("u",{"type":"race","name":"Dieci km","race_date":"2027-04-11","distance_km":10,"target_time_seconds":3600})
    observation=programs.evaluate_goal("u",goal["id"])
    evidence=observation["progress"]["evidence"]
    assert any(e["metric"]=="race_plan_fit" and e["kind"]=="plan_assessment" for e in evidence)
    assert any(e["metric"]=="race_prediction" and e["kind"]=="estimate" for e in evidence)
    assert observation["status"]=="insufficient_data"
    assert programs.list_evaluations("u",goal["id"])[0]["goal_revision"]==1


def test_foreign_goal_evaluations_returns_404_with_standard_error(local_store,monkeypatch):
    from fastapi.testclient import TestClient
    from training_plan.api.app import app
    monkeypatch.setenv("DEV_AUTH_BYPASS_USER_ID","another-user")
    goal=programs.create_goal("u",{"type":"fitness","name":"Forma"})
    response=TestClient(app).get(f'/goals/{goal["id"]}/evaluations')
    assert response.status_code==404 and response.json()["message"]


def test_legacy_whole_plan_metadata_cannot_reactivate_or_change_goal(local_store,monkeypatch):
    from fastapi.testclient import TestClient
    from training_plan.api.app import app
    monkeypatch.setenv("DEV_AUTH_BYPASS_USER_ID","u")
    seed()
    db.set_plan_active("u","running",False)
    response=TestClient(app).put("/plan",json={"yaml_text":"","sessions":[],"imported_at":"now","plan_id":"running"})
    assert response.status_code==409
    assert not db.get_plan("u",plan_id="running").is_active
