"""Persistent proposals, explicit activation, independent goals and deterministic review.

All calendar writes share a PostgreSQL statement lock, including legacy writers via
triggers. This deliberately favors correctness over concurrent writes on this small
service. A reviewed context revision therefore cannot race a legacy insert/delete.
No operation in this module publishes to Garmin.
"""
from __future__ import annotations

import hashlib
import json
import math
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

import yaml
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from . import db, plan_generator, plan_store
from .models import SUPPORTED_SPORTS, SUPPORTED_STEP_TYPES, SUPPORTED_DURATION_TYPES
from .parser import parse_sessions, _validate_goal

# A statement trigger is needed: a row trigger acquires its lock after UPDATE has
# locked a tuple, which would invert the activation's lock order and cause deadlocks.
LOCK_KEY = 730297432560
SCHEMA = """
CREATE TABLE IF NOT EXISTS planning_context_revision (
 user_id TEXT PRIMARY KEY, revision BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS program_draft (
 user_id TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'draft', data JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,id)
);
CREATE TABLE IF NOT EXISTS training_goal (
 user_id TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(user_id,id)
);
CREATE TABLE IF NOT EXISTS training_goal_version (
 user_id TEXT NOT NULL, goal_id TEXT NOT NULL, revision INTEGER NOT NULL,
 data JSONB NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,goal_id,revision)
);
CREATE TABLE IF NOT EXISTS training_goal_evaluation (
 user_id TEXT NOT NULL, id TEXT NOT NULL, goal_id TEXT NOT NULL,
 goal_revision INTEGER NOT NULL, data JSONB NOT NULL, evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,id)
);
CREATE TABLE IF NOT EXISTS program_goal_migration (
 user_id TEXT NOT NULL,plan_id TEXT NOT NULL,PRIMARY KEY(user_id,plan_id)
);
CREATE TABLE IF NOT EXISTS program_goal (
 user_id TEXT NOT NULL, plan_id TEXT NOT NULL, goal_id TEXT NOT NULL,
 is_primary BOOLEAN NOT NULL DEFAULT TRUE, PRIMARY KEY(user_id,plan_id,goal_id)
);
CREATE TABLE IF NOT EXISTS planning_constraints (
 user_id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1,
 data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION passo_planning_write_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(730297432560);
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION passo_planning_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE uid TEXT;
BEGIN
 IF TG_OP = 'DELETE' THEN uid := OLD.user_id; ELSE uid := NEW.user_id; END IF;
 INSERT INTO planning_context_revision(user_id,revision) VALUES(uid,1)
 ON CONFLICT(user_id) DO UPDATE SET revision = planning_context_revision.revision + 1;
 RETURN NULL;
END $$;
"""
CONTEXT_TABLES = ("user_training_plan", "plan_session", "user_plan", "user_goal",
                  "training_goal", "program_goal", "planning_constraints", "activity")


class PlanningError(Exception):
    def __init__(self, message: str, status: int = 422, *, details=None):
        self.status, self.details = status, details
        super().__init__(message)


def ensure_schema():
    with db.connect() as conn, conn.transaction():
        conn.execute(SCHEMA)
        for table in CONTEXT_TABLES:
            conn.execute(f"DROP TRIGGER IF EXISTS passo_write_lock ON {table}")
            conn.execute(f"CREATE TRIGGER passo_write_lock BEFORE INSERT OR UPDATE OR DELETE ON {table} "
                         "FOR EACH STATEMENT EXECUTE FUNCTION passo_planning_write_lock()")
            conn.execute(f"DROP TRIGGER IF EXISTS passo_changed ON {table}")
            conn.execute(f"CREATE TRIGGER passo_changed AFTER INSERT OR UPDATE OR DELETE ON {table} "
                         "FOR EACH ROW EXECUTE FUNCTION passo_planning_changed()")
        # Interrupted model requests remain recoverable, with original inputs intact.
        conn.execute("""UPDATE program_draft SET status='failed', revision=revision+1,
          data=data || '{"error":"Elaborazione interrotta dal riavvio. Puoi riprovare.","job_token":null}'::jsonb,
          updated_at=now() WHERE status='generating' AND updated_at < now() - interval '15 minutes'""")
        # Expand only: preserve every legacy race object and attach it to a stable ID.
        conn.execute("""INSERT INTO training_goal(user_id,id,data)
          SELECT user_id,'legacy-' || md5(id), goal || jsonb_build_object(
            'type','race','name',coalesce(goal->>'name','Obiettivo gara'),
            'sports','["running"]'::jsonb,'priority','primary','status','active',
            'review_interval_days',28)
          FROM user_training_plan p WHERE goal IS NOT NULL
          AND NOT EXISTS(SELECT 1 FROM program_goal_migration m WHERE m.user_id=p.user_id AND m.plan_id=p.id)
          AND NOT EXISTS(SELECT 1 FROM program_goal l WHERE l.user_id=p.user_id AND l.plan_id=p.id)
          ON CONFLICT(user_id,id) DO NOTHING""")
        conn.execute("""INSERT INTO program_goal(user_id,plan_id,goal_id)
          SELECT user_id,id,'legacy-' || md5(id) FROM user_training_plan p WHERE goal IS NOT NULL
          AND NOT EXISTS(SELECT 1 FROM program_goal_migration m WHERE m.user_id=p.user_id AND m.plan_id=p.id)
          AND NOT EXISTS(SELECT 1 FROM program_goal l WHERE l.user_id=p.user_id AND l.plan_id=p.id)
          ON CONFLICT DO NOTHING""")
        conn.execute("""INSERT INTO program_goal_migration(user_id,plan_id)
          SELECT user_id,id FROM user_training_plan ON CONFLICT DO NOTHING""")
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS program_goal_one_primary ON program_goal(user_id,plan_id) WHERE is_primary")
        conn.execute("""INSERT INTO training_goal(user_id,id,data)
          SELECT user_id,'legacy-standalone',goal || jsonb_build_object(
            'type','race','name',coalesce(goal->>'name','Obiettivo gara'),
            'sports','["running"]'::jsonb,'priority','primary','status','active',
            'review_interval_days',28) FROM user_goal ON CONFLICT DO NOTHING""")
        conn.execute("""INSERT INTO training_goal_version(user_id,goal_id,revision,data)
          SELECT user_id,id,revision,data FROM training_goal ON CONFLICT DO NOTHING""")


def _lock(cur):
    cur.execute("SELECT pg_advisory_xact_lock(%s)", [LOCK_KEY])


def _hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str, allow_nan=False).encode()).hexdigest()


def _json(row):
    if row is None:
        raise PlanningError("Elemento non trovato", 404)
    return {**row["data"], "id": row["id"], "revision": row["revision"],
            **({"status": row["status"]} if "status" in row else {})}


def _recover_jobs(cur,user_id):
    cur.execute("""UPDATE program_draft SET status='failed',revision=revision+1,
      data=data || '{"error":"Elaborazione interrotta o scaduta. Puoi riprovare.","job_token":null}'::jsonb,
      updated_at=now() WHERE user_id=%s AND status='generating' AND updated_at < now()-interval '15 minutes'""",[user_id])


def _draft(cur, user_id, draft_id, *, lock=False):
    _recover_jobs(cur,user_id)
    cur.execute("SELECT * FROM program_draft WHERE user_id=%s AND id=%s" + (" FOR UPDATE" if lock else ""), [user_id, draft_id])
    return _json(cur.fetchone())


def _expected(item, expected):
    if item["revision"] != expected:
        raise PlanningError("La versione è cambiata. Ricarica e controlla di nuovo.", 409)


def _save_draft(cur, user_id, draft):
    data = {k: v for k, v in draft.items() if k not in ("id", "revision", "status")}
    cur.execute("""UPDATE program_draft SET data=%s,status=%s,revision=revision+1,updated_at=now()
        WHERE user_id=%s AND id=%s RETURNING *""", [Jsonb(data), draft["status"], user_id, draft["id"]])
    return _json(cur.fetchone())


def validate_sessions(sessions):
    """Validate API and AI shapes identically without estimated conversion defaults."""
    from .api.schemas import TrainingSessionIn
    from pydantic import ValidationError
    if not isinstance(sessions, list) or len(sessions) > 2000:
        raise PlanningError("Sono ammesse al massimo 2000 sedute")
    out = []
    for i, raw in enumerate(sessions):
        try:
            parsed = TrainingSessionIn.model_validate(raw).model_dump(mode="json")
        except ValidationError as exc:
            raise PlanningError(f"Seduta {i+1}: controlla i campi", details=exc.errors(include_context=False)) from exc
        if parsed["sport"] not in SUPPORTED_SPORTS or not parsed["title"].strip():
            raise PlanningError(f"Seduta {i+1}: sport o titolo non valido")
        if parsed["priority"] not in ("key", "flexible"):
            raise PlanningError(f"Seduta {i+1}: priorità non valida")
        def steps_valid(steps):
            for step in steps:
                if "reps" in step:
                    if not 1 <= step["reps"] <= 99 or not step["steps"]:
                        raise PlanningError(f"Seduta {i+1}: ripetizioni non valide")
                    steps_valid(step["steps"])
                else:
                    if step["type"] not in SUPPORTED_STEP_TYPES or step["duration_type"] not in SUPPORTED_DURATION_TYPES:
                        raise PlanningError(f"Seduta {i+1}: tipo di blocco o unità non valida")
                    value = step["duration_value"]
                    if not math.isfinite(value) or value <= 0:
                        raise PlanningError(f"Seduta {i+1}: durata/distanza deve essere positiva e finita")
                    pace = step.get("target_pace")
                    if pace and not 0 < pace["faster_sec_per_km"] <= pace["slower_sec_per_km"]:
                        raise PlanningError(f"Seduta {i+1}: intervallo passo non valido")
        steps_valid(parsed["steps"])
        if parsed.get("short_variant"):
            steps_valid(parsed["short_variant"]["steps"])
        # Never accept client-chosen IDs or a hidden destination from imported data.
        out.append({k:v for k,v in parsed.items() if k not in ("id", "plan_id", "locked")})
    return out


def _read_yaml(text):
    if len(text) > 2_000_000:
        raise PlanningError("File troppo grande (massimo 2 MB)")
    try:
        raw = yaml.safe_load(text)
        if not isinstance(raw, dict) or not isinstance(raw.get("sessions"), list):
            raise ValueError("Il file deve contenere una lista sessions")
        sessions, errors = parse_sessions(raw["sessions"])
        _validate_goal(raw, errors)
        if errors:
            raise PlanningError("Controlla il file", details=errors)
        return validate_sessions([plan_generator.session_to_dict(s) for s in sessions])
    except (yaml.YAMLError, ValueError, TypeError, AttributeError, RecursionError) as exc:
        raise PlanningError("File YAML non valido", details=[str(exc)]) from exc


def _draft_data(payload):
    data = dict(payload)
    if data.get("mode", "new") not in ("new", "merge", "replace") or data.get("source") not in ("ai", "import"):
        raise PlanningError("Origine o destinazione non valida")
    if not str(data.get("name", "")).strip():
        raise PlanningError("Inserisci il nome del programma")
    if data.get("mode", "new") != "new" and not data.get("target_plan_id"):
        raise PlanningError("Seleziona il programma da modificare")
    if data.get("original_yaml") and not data.get("sessions"):
        data["sessions"] = _read_yaml(data["original_yaml"])
        raw=yaml.safe_load(data["original_yaml"])
        parsed_goal=_validate_goal(raw,[])
        data["parsed_goal"]=None
        if parsed_goal:
            from dataclasses import asdict
            data["parsed_goal"]={**asdict(parsed_goal),"race_date":parsed_goal.race_date.isoformat(),"type":"race"}
    data["sessions"] = validate_sessions(data.get("sessions") or [])
    return {"mode":"new", "target_plan_id":None,"goal_id":None,"inputs":{},"original_yaml":None,
            "skeleton":None,"validation":None,"result":None,"error":None, **data}


def create_draft(user_id, payload):
    # Store even invalid import input so it can be corrected without losing its source.
    error = None
    try:
        data = _draft_data(payload)
    except PlanningError as exc:
        if payload.get("source") != "import" or not payload.get("original_yaml"):
            raise
        error = {"message":str(exc),"details":exc.details}
        data = _draft_data({**payload,"original_yaml":None,"sessions":[]})
        data.update(original_yaml=payload["original_yaml"],error=error)
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute("""INSERT INTO program_draft(user_id,id,status,data) VALUES(%s,%s,%s,%s) RETURNING *""",
                    [user_id,str(uuid4()),"failed" if error else "draft",Jsonb(data)])
        return _json(cur.fetchone())


def list_drafts(user_id):
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        _recover_jobs(cur,user_id)
        cur.execute("SELECT * FROM program_draft WHERE user_id=%s ORDER BY updated_at DESC", [user_id])
        return [_json(row) for row in cur.fetchall()]


def get_draft(user_id, draft_id):
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        return _draft(cur,user_id,draft_id)


def patch_draft(user_id, draft_id, expected_revision, changes):
    allowed = {"name","mode","target_plan_id","goal_id","inputs","original_yaml","sessions"}
    if set(changes) - allowed:
        raise PlanningError("Campi di modifica non supportati")
    with db.connect() as conn, conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        draft = _draft(cur,user_id,draft_id,lock=True)
        _expected(draft,expected_revision)
        if draft["status"] in ("active","generating"):
            raise PlanningError("La bozza non è modificabile in questo stato",409)
        updated = {**draft, **changes}
        if "original_yaml" in changes and "sessions" not in changes:
            updated["sessions"] = []
        try:
            draft.update(_draft_data(updated),status="draft",validation=None,error=None)
        except PlanningError as exc:
            if draft["source"]!="import" or "original_yaml" not in changes:
                raise
            draft.update(updated,status="failed",validation=None,error={"message":str(exc),"details":exc.details},sessions=[])
        return _save_draft(cur,user_id,draft)


def _context(cur,user_id):
    cur.execute("SELECT revision FROM planning_context_revision WHERE user_id=%s",[user_id])
    row = cur.fetchone()
    revision = row["revision"] if row else 0
    cur.execute("SELECT * FROM user_training_plan WHERE user_id=%s ORDER BY id",[user_id])
    plans = cur.fetchall()
    active_ids = [p["id"] for p in plans if p["is_active"]]
    cur.execute("SELECT * FROM plan_session WHERE user_id=%s ORDER BY date,position,id",[user_id])
    sessions = [plan_store._out(s) for s in cur.fetchall()]
    cur.execute("SELECT * FROM training_goal WHERE user_id=%s ORDER BY id",[user_id])
    goals = [_json(g) for g in cur.fetchall()]
    cur.execute("SELECT * FROM planning_constraints WHERE user_id=%s",[user_id])
    constraints = cur.fetchone()
    return {"revision":revision,"plans":plans,"active_ids":active_ids,"sessions":sessions,"goals":goals,
            "constraints":{**constraints["data"],"revision":constraints["revision"]} if constraints else None}


def _known_minutes(session):
    """Exact stated time, or pace-derived duration only when a pace was supplied."""
    if session.get("is_short_active") and session.get("short_variant"):
        session={**session,"steps":session["short_variant"]["steps"]}
    total = 0.0
    for item in session.get("steps") or []:
        if "reps" in item:
            value = _known_minutes({"steps":item["steps"]})
            if value is None:
                return None
            total += value * item["reps"]
        elif item["duration_type"] == "time":
            total += item["duration_value"]
        elif item["duration_type"] == "distance" and item.get("target_pace"):
            p = item["target_pace"]
            total += item["duration_value"] * p["slower_sec_per_km"]/60
        else:
            return None
    return total if session.get("steps") else None


def review(draft,context):
    """Pure review shared by import, AI, editing, and the transaction's final gate."""
    conflicts, warnings, missing = [], [], []
    proposed = validate_sessions(draft["sessions"])
    target = draft.get("target_plan_id")
    active = [s for s in context["sessions"] if s["plan_id"] in context["active_ids"]]
    target_all = [s for s in context["sessions"] if s["plan_id"] == target]
    removed = []
    if draft["mode"] != "new":
        if not any(p["id"] == target for p in context["plans"]):
            conflicts.append({"code":"target_missing","message":"Il programma scelto non esiste più"})
        elif draft["mode"] == "replace":
            # Historical and user-locked sessions always survive replacement.
            dates=[s["date"] for s in proposed]
            scope=draft.get("generation_result") or {}
            start=scope.get("start") or (min(dates) if dates else None)
            end=scope.get("end") or (max(dates) if dates else None)
            removed = [s for s in target_all if not s["locked"] and s["date"] > date.today().isoformat()
                       and start and start <= s["date"] <= end]
    removed_ids = {s["id"] for s in removed}
    preserved = [s for s in active if s["id"] not in removed_ids]
    # A merged inactive program becomes active: its existing sessions must be checked too.
    if draft["mode"] != "new" and target not in context["active_ids"]:
        preserved += [s for s in target_all if s["id"] not in removed_ids]
    for s in proposed:
        if s["date"] < date.today().isoformat():
            warnings.append({"code":"past_date","date":s["date"],"message":"Seduta con data passata"})
    if not proposed:
        conflicts.append({"code":"empty_program","message":"Il programma non contiene sedute"})
    if draft.get("goal_id") and not any(g["id"] == draft["goal_id"] and g.get("status")=="active" for g in context["goals"]):
        conflicts.append({"code":"goal_missing","message":"L’obiettivo scelto non è attivo"})
    constraints = context.get("constraints")
    if not constraints:
        missing.append("Disponibilità e limite di sedute giornaliere non dichiarati")
    by_day = defaultdict(list)
    for s in [*preserved,*proposed]:
        by_day[s["date"]].append(s)
    proposed_days = {s["date"] for s in proposed}
    for day in sorted(proposed_days):
        sessions = by_day[day]
        if constraints:
            if date.fromisoformat(day).weekday() not in constraints["available_days"]:
                conflicts.append({"code":"unavailable_day","date":day,"message":"Giorno non disponibile"})
            if len(sessions) > constraints["max_sessions_per_day"]:
                conflicts.append({"code":"daily_sessions","date":day,"message":"Superato il limite di sedute giornaliere"})
            durations = [_known_minutes(s) for s in sessions]
            known = sum(d for d in durations if d is not None)
            if constraints.get("max_daily_minutes") is not None and known > constraints["max_daily_minutes"]:
                conflicts.append({"code":"daily_minutes","date":day,"message":"Superato il tempo giornaliero disponibile"})
            elif constraints.get("max_daily_minutes") is not None and None in durations:
                missing.append(f"Durata non verificabile per tutte le sedute del {day}")
        keys = Counter(_hash({k:s.get(k) for k in ("sport","title","steps")}) for s in sessions)
        if any(n>1 for n in keys.values()):
            conflicts.append({"code":"possible_duplicate","date":day,"message":"Possibili sedute duplicate: controlla prima di attivare"})
        if len(sessions)>1:
            warnings.append({"code":"same_day","date":day,"message":"Più sedute nella stessa giornata; orari non disponibili"})
    # Supported cross-sport rules use explicit minutes; no fabricated kilometers or load.
    from . import plan_rules
    models = [plan_generator.session_from_dict(s) for s in [*preserved,*proposed]]
    if models:
        start,end = min(s.date for s in models),max(s.date for s in models)
        ctx = plan_rules.RuleContext(1,None,None,date.today())
        violations = plan_rules.validate(models,ctx,start=start,end=end)
        for violation in violations:
            warnings.append({"code":violation.key,"message":violation.message})
    missing.append("Carico fisiologico confrontabile fra sport non disponibile; sono verificati i vincoli dichiarati")
    missing.append("Eventuali impegni presenti solo su Garmin non sono inclusi finché non acquisiti e riconciliati")
    return {"status":"conflict" if conflicts else "insufficient_data" if missing else "compatible",
            "conflicts":conflicts,"warnings":warnings,"missing_data":list(dict.fromkeys(missing)),
            "impact":{"added":proposed,"removed":removed,"preserved":preserved,
                      "programs":[{"id":p["id"],"name":p["name"],"is_active":p["is_active"]} for p in context["plans"]]},
            "context_revision":context["revision"]}


def validate_draft(user_id,draft_id,expected_revision):
    with db.connect() as conn, conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        _lock(cur)
        draft = _draft(cur,user_id,draft_id,lock=True)
        _expected(draft,expected_revision)
        if draft["status"] in ("active","generating"):
            raise PlanningError("La bozza non può essere controllata in questo stato",409)
        context = _context(cur,user_id)
        validation = review(draft,context)
        validation.update(token=str(uuid4()),reviewed_on=date.today().isoformat())
        draft.update(validation=validation,status="ready",error=None)
        return _save_draft(cur,user_id,draft)


def activate_draft(user_id,draft_id,expected_revision,validation_token,acknowledge_insufficient_data=False):
    with db.connect() as conn, conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        _lock(cur)
        draft = _draft(cur,user_id,draft_id,lock=True)
        # Retried requests return the committed result, even if the caller lost the response.
        if draft["status"] == "active":
            if (draft.get("validation") or {}).get("token") != validation_token:
                raise PlanningError("Conferma non corrispondente alla versione attivata",409)
            return draft["result"]
        _expected(draft,expected_revision)
        validation = draft.get("validation")
        if not validation or validation["token"] != validation_token:
            raise PlanningError("Controlla la bozza prima di attivare",409)
        context = _context(cur,user_id)
        if validation["context_revision"] != context["revision"] or validation["reviewed_on"] != date.today().isoformat():
            raise PlanningError("Programmi, obiettivi, attività o disponibilità sono cambiati: ripeti il controllo",409)
        checked = review(draft,context)
        if checked["conflicts"]:
            raise PlanningError("Risolvi i conflitti prima di attivare",409,details=checked["conflicts"])
        if checked["missing_data"] and not acknowledge_insufficient_data:
            raise PlanningError("Conferma esplicitamente i limiti della verifica",422,details=checked["missing_data"])
        plan_id = "programma-"+draft["id"] if draft["mode"]=="new" else draft["target_plan_id"]
        race_goal = next((g for g in context["goals"] if g["id"]==draft.get("goal_id") and g["type"]=="race"),None)
        legacy_goal = {k:race_goal.get(k) for k in ("race_date","distance_km","name","target_time_seconds")} if race_goal else None
        if draft["mode"]=="new":
            sports = list(dict.fromkeys(s["sport"] for s in draft["sessions"]))
            cur.execute("""INSERT INTO user_training_plan(user_id,id,name,sports,is_active,goal,skeleton,yaml_text,imported_at)
              VALUES(%s,%s,%s,%s,TRUE,%s,%s,%s,%s)""",
              [user_id,plan_id,draft["name"],Jsonb(sports),Jsonb(legacy_goal) if legacy_goal else None,
               Jsonb(draft["skeleton"]) if draft.get("skeleton") else None,draft.get("original_yaml") or "",datetime.now(timezone.utc).isoformat()])
        else:
            # Existing metadata/goal is preserved. Changing its goal requires explicit goals UI.
            cur.execute("UPDATE user_training_plan SET is_active=TRUE,updated_at=now() WHERE user_id=%s AND id=%s",[user_id,plan_id])
            if draft.get("skeleton"):
                cur.execute("UPDATE user_training_plan SET skeleton=%s WHERE user_id=%s AND id=%s",[Jsonb(draft["skeleton"]),user_id,plan_id])
        for session in checked["impact"]["removed"]:
            cur.execute("DELETE FROM plan_session WHERE user_id=%s AND id=%s",[user_id,session["id"]])
        for position,session in enumerate(draft["sessions"]):
            cur.execute("""INSERT INTO plan_session(user_id,plan_id,date,position,sport,title,description,steps,origin,locked,
              priority,min_duration_minutes,short_variant,is_short_active)
              VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,FALSE,%s,%s,%s,%s)""",
              [user_id,plan_id,session["date"],position,session["sport"],session["title"],session.get("description"),
               Jsonb(session["steps"]),"ai" if draft["source"]=="ai" else "import",session.get("priority","flexible"),
               session.get("min_duration_minutes"),Jsonb(session["short_variant"]) if session.get("short_variant") else None,
               session.get("is_short_active",False)])
        if draft.get("goal_id"):
            cur.execute("""INSERT INTO program_goal(user_id,plan_id,goal_id,is_primary)
              SELECT %s,%s,%s,NOT EXISTS(SELECT 1 FROM program_goal WHERE user_id=%s AND plan_id=%s AND is_primary)
              ON CONFLICT DO NOTHING""",[user_id,plan_id,draft["goal_id"],user_id,plan_id])
        result={"draft_id":draft_id,"plan_id":plan_id,"sessions_count":len(draft["sessions"]),"status":"active"}
        draft.update(status="active",result=result)
        _save_draft(cur,user_id,draft)
        return result


def get_constraints(user_id):
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT * FROM planning_constraints WHERE user_id=%s",[user_id])
        row=cur.fetchone()
        return {**row["data"],"revision":row["revision"]} if row else {"revision":0,"available_days":None,"max_daily_minutes":None,"max_sessions_per_day":None}


def save_constraints(user_id,payload):
    expected = payload.pop("expected_revision")
    available = payload.get("available_days")
    count = payload.get("max_sessions_per_day")
    minutes=payload.get("max_daily_minutes")
    if not isinstance(available,list) or not available or any(type(d) is not int or not 0<=d<=6 for d in available):
        raise PlanningError("Seleziona i giorni disponibili (0=lunedì, 6=domenica)")
    if type(count) is not int or not 1<=count<=10:
        raise PlanningError("Il limite giornaliero deve essere fra 1 e 10 sedute")
    if minutes is not None and (not isinstance(minutes,(int,float)) or not math.isfinite(minutes) or minutes<=0):
        raise PlanningError("Il tempo giornaliero deve essere positivo")
    data={"available_days":sorted(set(available)),"max_daily_minutes":minutes,"max_sessions_per_day":count}
    with db.connect() as conn, conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        _lock(cur)
        cur.execute("SELECT revision FROM planning_constraints WHERE user_id=%s",[user_id])
        row=cur.fetchone()
        if (row["revision"] if row else 0)!=expected:
            raise PlanningError("La disponibilità è cambiata: ricarica",409)
        cur.execute("""INSERT INTO planning_constraints(user_id,data) VALUES(%s,%s)
          ON CONFLICT(user_id) DO UPDATE SET data=EXCLUDED.data,revision=planning_constraints.revision+1,updated_at=now()
          RETURNING *""",[user_id,Jsonb(data)])
        row=cur.fetchone()
        return {**row["data"],"revision":row["revision"]}


def begin_generation(user_id,draft_id,expected_revision):
    with db.connect() as conn, conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        _lock(cur)
        draft=_draft(cur,user_id,draft_id,lock=True)
        _expected(draft,expected_revision)
        if draft["source"]!="ai" or draft["status"] in ("active","generating"):
            raise PlanningError("Questa bozza non può essere generata",409)
        inputs=draft.get("inputs") or {}
        if (inputs.get("sports") or ["running"]) != ["running"]:
            raise PlanningError("La generazione AI attuale supporta soltanto programmi corsa. Per altri sport importa un file.")
        requested_start=inputs.get("start_date")
        # The existing generator's detailed window starts tomorrow; unsupported dates
        # must never be silently ignored or disguised in the preview.
        tomorrow=(date.today()+timedelta(days=1)).isoformat()
        if requested_start and requested_start!=tomorrow:
            raise PlanningError(f"La generazione attuale può iniziare dal {tomorrow}. Modifica la data richiesta.")
        context=_context(cur,user_id)
        if draft.get("goal_id") and not any(g["id"]==draft["goal_id"] and g.get("status")=="active" for g in context["goals"]):
            raise PlanningError("Seleziona un obiettivo attivo")
        draft.update(status="generating",job_token=str(uuid4()),generation_context_revision=context["revision"],
                     validation=None,error=None)
        return _save_draft(cur,user_id,draft)


def generate_draft(user_id,draft_id,job_token):
    """Called by the request's background worker; its lease protects retries/stale jobs."""
    try:
        with db.connect() as conn, conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
            _lock(cur)
            draft=_draft(cur,user_id,draft_id)
            if draft["status"]!="generating" or draft.get("job_token")!=job_token:
                return
            context=_context(cur,user_id)
        if context["revision"]!=draft["generation_context_revision"]:
            raise PlanningError("Il contesto è cambiato prima della generazione: riprova",409)
        goal=next((g for g in context["goals"] if g["id"]==draft.get("goal_id")),None)
        inputs=draft.get("inputs") or {}
        target=draft.get("target_plan_id") if draft["mode"]!="new" else "__draft__"+draft_id
        others=[s for s in context["sessions"] if s["plan_id"] in context["active_ids"] and s["plan_id"]!=target]
        # Existing programs/goals are represented explicitly before the model proposes.
        commitments=[{"plan_id":s["plan_id"],"date":s["date"],"sport":s["sport"],"title":s["title"],
                      "minutes":_known_minutes(s),"locked":s["locked"]} for s in others]
        context_text=json.dumps({"existing_commitments":commitments,"active_goals":context["goals"],
                                 "availability":context["constraints"],"requested_goal":goal},ensure_ascii=False,default=str)
        from .api.routes_coach import coach_state
        state=coach_state(user_id)
        result=plan_generator.generate(user_id,date.today(),profile=state[1].profile if state and state[1] else None,
            threshold_available=state is not None,write=False,plan_id=target,goal_override=goal,context_sessions=others,
            mode="augment" if draft["mode"]=="merge" else "rebuild",sports=inputs.get("sports") or ["running"],
            user_prompt=(inputs.get("user_prompt") or "")+"\nContesto verificabile dei programmi attivi:\n"+context_text)
        sessions=validate_sessions([plan_generator.session_to_dict(s) for s in result.proposed])
        with db.connect() as conn, conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
            _lock(cur)
            current=_draft(cur,user_id,draft_id,lock=True)
            if current["status"]!="generating" or current.get("job_token")!=job_token:
                return
            current.update(sessions=sessions,skeleton=result.skeleton,status="draft",job_token=None,
                           generation_result={"source":result.source,"start":result.window.start.isoformat(),
                                              "end":result.window.end.isoformat(),"fallback_reason":result.fallback_reason})
            _save_draft(cur,user_id,current)
    except Exception as exc:
        with db.connect() as conn, conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
            current=_draft(cur,user_id,draft_id,lock=True)
            if current["status"]=="generating" and current.get("job_token")==job_token:
                current.update(status="failed",error=str(exc),job_token=None)
                _save_draft(cur,user_id,current)


def validate_goal(payload):
    data=dict(payload)
    if data.get("type") not in ("race","performance","fitness","strength","consistency","maintenance"):
        raise PlanningError("Tipo di obiettivo non valido")
    if not isinstance(data.get("name"),str) or not data["name"].strip():
        raise PlanningError("Inserisci il nome dell’obiettivo")
    sports=data.get("sports") or []
    if not isinstance(sports,list) or any(s not in SUPPORTED_SPORTS for s in sports):
        raise PlanningError("Sport non valido")
    if data.get("priority","secondary") not in ("primary","secondary"):
        raise PlanningError("Priorità non valida")
    if data.get("status","active") not in ("active","completed","archived"):
        raise PlanningError("Stato obiettivo non valido")
    interval=data.get("review_interval_days",28)
    if type(interval) is not int or not 1<=interval<=366:
        raise PlanningError("La frequenza di verifica deve essere fra 1 e 366 giorni")
    for key in ("deadline","review_date","race_date"):
        if data.get(key):
            try: date.fromisoformat(data[key])
            except (ValueError,TypeError) as exc: raise PlanningError(f"Data non valida: {key}") from exc
    if data["type"]=="race":
        if not data.get("race_date") or not isinstance(data.get("distance_km"),(int,float)) or not math.isfinite(data["distance_km"]) or data["distance_km"]<=0:
            raise PlanningError("Per una gara indica data e distanza positiva")
        if data.get("target_time_seconds") is not None and (type(data["target_time_seconds"]) is not int or data["target_time_seconds"]<=0):
            raise PlanningError("Il tempo gara deve essere positivo")
    criterion=data.get("success_criterion")
    if criterion is not None:
        if not isinstance(criterion,dict) or not isinstance(criterion.get("metric"),str):
            raise PlanningError("Specifica un indicatore per il criterio di riuscita")
        target=criterion.get("target")
        if target is not None and (not isinstance(target,(int,float)) or not math.isfinite(target) or target<=0):
            raise PlanningError("Il target deve essere positivo")
    baseline=data.get("baseline")
    if baseline is not None:
        if not isinstance(baseline,dict) or not isinstance(baseline.get("value"),(int,float)) or not math.isfinite(baseline["value"]) or not baseline.get("source"):
            raise PlanningError("Indica valore iniziale, data e fonte")
        try: date.fromisoformat(baseline["recorded_at"])
        except (ValueError,TypeError,KeyError) as exc: raise PlanningError("Data del valore iniziale non valida") from exc
    # Status and target revision are facts, never inferred from adherence.
    return {"description":None,"sports":[],"priority":"secondary","status":"active","baseline":None,
            "success_criterion":None,"deadline":None,"review_date":None,"review_interval_days":28,**data}


def _goal(cur,user_id,goal_id):
    cur.execute("SELECT * FROM training_goal WHERE user_id=%s AND id=%s",[user_id,goal_id])
    goal=_json(cur.fetchone())
    cur.execute("SELECT plan_id FROM program_goal WHERE user_id=%s AND goal_id=%s ORDER BY plan_id",[user_id,goal_id])
    goal["linked_program_ids"]=[row["plan_id"] for row in cur.fetchall()]
    return goal


def list_goals(user_id):
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT id FROM training_goal WHERE user_id=%s ORDER BY created_at DESC,id",[user_id])
        return [_goal(cur,user_id,row["id"]) for row in cur.fetchall()]


def get_goal(user_id,goal_id):
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        result=_goal(cur,user_id,goal_id)
        cur.execute("SELECT revision,data,recorded_at FROM training_goal_version WHERE user_id=%s AND goal_id=%s ORDER BY revision",[user_id,goal_id])
        result["history"]=[{**row,"recorded_at":row["recorded_at"].isoformat()} for row in cur.fetchall()]
        return result


def create_goal(user_id,payload):
    data=validate_goal(payload)
    with db.connect() as conn, conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        _lock(cur)
        goal_id=str(uuid4())
        cur.execute("INSERT INTO training_goal(user_id,id,data) VALUES(%s,%s,%s)",[user_id,goal_id,Jsonb(data)])
        cur.execute("INSERT INTO training_goal_version(user_id,goal_id,revision,data) VALUES(%s,%s,1,%s)",[user_id,goal_id,Jsonb(data)])
        return _goal(cur,user_id,goal_id)


def patch_goal(user_id,goal_id,expected_revision,changes):
    with db.connect() as conn, conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        _lock(cur)
        goal=_goal(cur,user_id,goal_id)
        _expected(goal,expected_revision)
        for key in ("id","revision","linked_program_ids","history"):
            if key in changes:
                raise PlanningError("Campo obiettivo non modificabile: "+key)
        data=validate_goal({**{k:v for k,v in goal.items() if k not in ("id","revision","linked_program_ids")},**changes})
        cur.execute("UPDATE training_goal SET data=%s,revision=revision+1,updated_at=now() WHERE user_id=%s AND id=%s RETURNING revision",[Jsonb(data),user_id,goal_id])
        revision=cur.fetchone()["revision"]
        cur.execute("INSERT INTO training_goal_version(user_id,goal_id,revision,data) VALUES(%s,%s,%s,%s)",[user_id,goal_id,revision,Jsonb(data)])
        race={k:data.get(k) for k in ("race_date","distance_km","name","target_time_seconds")} if data["type"]=="race" and data["status"]=="active" else None
        cur.execute("""UPDATE user_training_plan SET goal=%s,updated_at=now()
          WHERE user_id=%s AND id IN (SELECT plan_id FROM program_goal WHERE user_id=%s AND goal_id=%s AND is_primary)""",
          [Jsonb(race) if race else None,user_id,user_id,goal_id])
        cur.execute("""UPDATE user_plan SET goal=%s,updated_at=now() WHERE user_id=%s AND EXISTS(
          SELECT 1 FROM program_goal WHERE user_id=%s AND goal_id=%s AND plan_id='default' AND is_primary)""",
          [Jsonb(race) if race else None,user_id,user_id,goal_id])
        if goal_id=="legacy-standalone":
            if race:
                cur.execute("UPDATE user_goal SET goal=%s,updated_at=now() WHERE user_id=%s",[Jsonb(race),user_id])
            else:
                cur.execute("DELETE FROM user_goal WHERE user_id=%s",[user_id])
        return _goal(cur,user_id,goal_id)


def list_evaluations(user_id,goal_id):
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        _goal(cur,user_id,goal_id)
        cur.execute("SELECT * FROM training_goal_evaluation WHERE user_id=%s AND goal_id=%s ORDER BY evaluated_at DESC,id",[user_id,goal_id])
        return [{**r["data"],"id":r["id"],"goal_revision":r["goal_revision"],"evaluated_at":r["evaluated_at"].isoformat()} for r in cur.fetchall()]


def evaluate_goal(user_id,goal_id):
    """An evidence-limited dated observation; activity count cannot prove fitness."""
    from . import history
    with db.connect() as conn, conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        _lock(cur)
        goal=_goal(cur,user_id,goal_id)
        today=date.today()
        interval=goal["review_interval_days"]
        start=today-timedelta(days=interval-1)
        # Read canonical stored activities once; a shared activity supports many goals
        # but is counted once here, independently of the number of linked programs.
        cur.execute("SELECT source,activity_id,day,sport,distance_km,duration_min,fetched_at FROM activity WHERE user_id=%s AND day BETWEEN %s AND %s AND duplicate_of IS NULL ORDER BY day,activity_id",[user_id,start,today])
        activities=cur.fetchall()
        sports=goal.get("sports") or []
        relevant=[a for a in activities if not sports or a["sport"] in sports]
        cur.execute("SELECT id,date,sport FROM plan_session WHERE user_id=%s AND plan_id=ANY(%s) AND date BETWEEN %s AND %s",[user_id,goal["linked_program_ids"],start,today])
        planned=cur.fetchall()
        # No match link is recorded here: present denominator and data quality honestly.
        execution={"planned_sessions":len(planned),"recorded_activities":len(relevant),"completed_sessions":None,
                   "message":"Le attività registrate non provano l’abbinamento alle singole sedute"}
        evidence=[{"kind":"observation","metric":"recorded_activities","value":len(relevant),"source":"canonical_activity_history"}]
        status="insufficient_data"
        missing=[]
        criterion=goal.get("success_criterion") or {}
        if goal["type"] in ("consistency","maintenance") and criterion.get("metric")=="sessions_per_week" and criterion.get("target"):
            # Canonical presence is a lower bound: absent rows do not prove rest.
            weeks=interval/7
            frequency=len(relevant)/weeks
            evidence.append({"kind":"observation","metric":"sessions_per_week","value":round(frequency,2),"unit":"sessions/week"})
            counts=Counter(a["day"]-timedelta(days=a["day"].weekday()) for a in relevant)
            first_monday=start+timedelta(days=(7-start.weekday())%7)
            complete=[]
            monday=first_monday
            while monday+timedelta(days=6)<=today:
                complete.append({"start":monday.isoformat(),"sessions":counts[monday]})
                monday+=timedelta(days=7)
            evidence.append({"kind":"observation","metric":"sessions_by_complete_week","weeks":complete})
            if complete and all(w["sessions"]>=criterion["target"] for w in complete):
                status="on_track"
            else:
                missing.append("La regolarità del target non è dimostrata in tutte le settimane complete; la media non prova continuità")
            if not complete:
                missing.append("Periodo troppo breve per valutare una settimana completa")
        elif goal["type"]=="strength":
            missing.append("Carichi, serie e ripetizioni comparabili non sono disponibili nello storico attività")
        elif goal["type"] in ("fitness","performance"):
            missing.append("Servono test o indicatori comparabili e un valore iniziale verificato")
        elif goal["type"]=="race":
            from dataclasses import asdict
            from . import goal_fit, race_prediction
            race=plan_generator.goal_from_dict(goal)
            cur.execute("SELECT * FROM plan_session WHERE user_id=%s AND plan_id=ANY(%s) ORDER BY date,position,id",[user_id,goal["linked_program_ids"]])
            linked=[plan_generator.session_from_dict(plan_store._out(s)) for s in cur.fetchall()]
            cur.execute("SELECT * FROM activity WHERE user_id=%s AND day BETWEEN %s AND %s AND duplicate_of IS NULL ORDER BY day",[user_id,today-timedelta(days=60),today])
            race_activities=cur.fetchall()
            cur.execute("SELECT * FROM wellness_day WHERE user_id=%s AND day BETWEEN %s AND %s ORDER BY day",[user_id,today-timedelta(days=60),today])
            wellness=cur.fetchall()
            vo2max=next((float(w["vo2max"]) for w in reversed(wellness) if w.get("vo2max")),None)
            fit=goal_fit.assess_plan_fit(linked,race,today)
            prediction=race_prediction.assess_race_prediction(activities=race_activities,goal=race,
                planned_sessions=linked,today=today,vo2max=vo2max,wellness=wellness)
            evidence.append({"kind":"plan_assessment","metric":"race_plan_fit","assessment":asdict(fit)})
            # Prediction stays explicitly separate from observed performance/result.
            evidence.append({"kind":"estimate","metric":"race_prediction","assessment":asdict(prediction),
                             "source":"canonical_activity_history_and_stored_wellness",
                             "period":{"start":(today-timedelta(days=60)).isoformat(),"end":today.isoformat()}})
            if prediction.status==race_prediction.STATUS_ASSESSED:
                status="on_track" if prediction.band in (race_prediction.BAND_AHEAD,race_prediction.BAND_ON_TRACK) else "review_needed"
            else:
                missing.append(prediction.headline)
            missing.append("Una previsione non verifica il risultato effettivo della gara")
        else:
            missing.append("Definisci un criterio osservabile e raccogli dati pertinenti")
        if not relevant:
            missing.append("Nessuna attività pertinente disponibile nel periodo")
        data={"status":status,"period":{"start":start.isoformat(),"end":today.isoformat()},
              "execution":execution,"progress":{"status":status,"evidence":evidence},
              "quality":{"status":"insufficient_data" if missing else "observed","missing_data":missing,
                         "latest_activity_day":max((a["day"].isoformat() for a in relevant),default=None),
                         "latest_acquired_at":max((a["fetched_at"].isoformat() for a in relevant),default=None),
                         "sources":sorted({a["source"] for a in relevant})},
              "kind":"observation","goal_snapshot":{k:v for k,v in goal.items() if k!="linked_program_ids"}}
        data=json.loads(json.dumps(data,default=str,allow_nan=False))
        evaluation_id=str(uuid4())
        cur.execute("INSERT INTO training_goal_evaluation(user_id,id,goal_id,goal_revision,data) VALUES(%s,%s,%s,%s,%s) RETURNING evaluated_at",[user_id,evaluation_id,goal_id,goal["revision"],Jsonb(data)])
        return {**data,"id":evaluation_id,"goal_revision":goal["revision"],"evaluated_at":cur.fetchone()["evaluated_at"].isoformat()}


def program_goals(user_id,plan_id):
    with db.connect() as conn, conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        _lock(cur)
        context=_context(cur,user_id)
        if not any(p["id"]==plan_id for p in context["plans"]):
            raise PlanningError("Programma non trovato",404)
        cur.execute("SELECT goal_id,is_primary FROM program_goal WHERE user_id=%s AND plan_id=%s ORDER BY goal_id",[user_id,plan_id])
        links=cur.fetchall()
        return {"context_revision":context["revision"],"primary_goal_id":next((l["goal_id"] for l in links if l["is_primary"]),None),
                "contributing_goal_ids":[l["goal_id"] for l in links if not l["is_primary"]]}


def link_program_goals(user_id,plan_id,payload):
    with db.connect() as conn, conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        _lock(cur)
        context=_context(cur,user_id)
        if context["revision"]!=payload["expected_context_revision"]:
            raise PlanningError("Programmi o obiettivi sono cambiati: ricarica",409)
        if not any(p["id"]==plan_id for p in context["plans"]):
            raise PlanningError("Programma non trovato",404)
        primary=payload.get("primary_goal_id")
        ids=list(dict.fromkeys(([primary] if primary else [])+payload.get("contributing_goal_ids",[])))
        if any(not any(g["id"]==gid and g["status"]=="active" for g in context["goals"]) for gid in ids):
            raise PlanningError("Seleziona soltanto obiettivi attivi")
        cur.execute("DELETE FROM program_goal WHERE user_id=%s AND plan_id=%s",[user_id,plan_id])
        for gid in ids:
            cur.execute("INSERT INTO program_goal(user_id,plan_id,goal_id,is_primary) VALUES(%s,%s,%s,%s)",[user_id,plan_id,gid,gid==primary])
        goal=next((g for g in context["goals"] if g["id"]==primary and g["type"]=="race"),None)
        race={k:goal.get(k) for k in ("race_date","distance_km","name","target_time_seconds")} if goal else None
        cur.execute("UPDATE user_training_plan SET goal=%s,updated_at=now() WHERE user_id=%s AND id=%s",[Jsonb(race) if race else None,user_id,plan_id])
        if plan_id=="default":
            cur.execute("UPDATE user_plan SET goal=%s,updated_at=now() WHERE user_id=%s",[Jsonb(race) if race else None,user_id])
        cur.execute("SELECT revision FROM planning_context_revision WHERE user_id=%s",[user_id])
        return {"context_revision":cur.fetchone()["revision"],"primary_goal_id":primary,"contributing_goal_ids":[gid for gid in ids if gid!=primary]}


def _activation_review(user_id,plan_id,context):
    plan=next((p for p in context["plans"] if p["id"]==plan_id),None)
    if not plan: raise PlanningError("Programma non trovato",404)
    sessions=[s for s in context["sessions"] if s["plan_id"]==plan_id and s["date"]>=date.today().isoformat()]
    other={**context,"sessions":[s for s in context["sessions"] if s["plan_id"]!=plan_id]}
    draft={"mode":"new","goal_id":None,"sessions":sessions}
    validation=review(draft,other)
    validation["token"]=_hash([user_id,plan_id,context["revision"],date.today().isoformat()])
    return validation


def review_activation(user_id,plan_id):
    with db.connect() as conn, conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        _lock(cur)
        return _activation_review(user_id,plan_id,_context(cur,user_id))


def toggle_program(user_id,plan_id,is_active,validation_token=None,acknowledge_insufficient_data=False):
    with db.connect() as conn, conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        _lock(cur)
        context=_context(cur,user_id)
        plan=next((p for p in context["plans"] if p["id"]==plan_id),None)
        if not plan: raise PlanningError("Programma non trovato",404)
        if is_active and not plan["is_active"]:
            checked=_activation_review(user_id,plan_id,context)
            if checked["token"]!=validation_token:
                raise PlanningError("Controlla la compatibilità prima di riattivare il programma",409)
            if checked["conflicts"]:
                raise PlanningError("Risolvi i conflitti prima di riattivare",409,details=checked["conflicts"])
            if checked["missing_data"] and not acknowledge_insufficient_data:
                raise PlanningError("Conferma i limiti della verifica prima di riattivare",422,details=checked["missing_data"])
        cur.execute("UPDATE user_training_plan SET is_active=%s,updated_at=now() WHERE user_id=%s AND id=%s",[is_active,user_id,plan_id])
        return {"ok":True}
