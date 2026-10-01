"""Plan parse/diff/sync endpoints -- thin adapters over `service.py` and `parser.py`.

No business logic lives here: every handler validates/shapes HTTP input, calls the
existing service-layer function on a thread (it's synchronous, blocking I/O), and
shapes the result back to JSON.
"""

from __future__ import annotations

import hashlib
import tempfile
from datetime import date, timedelta
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import JSONResponse
from fastapi.concurrency import run_in_threadpool

from .. import checkin, db, history, levels, move_check, plan_adaptation, plan_generator, plan_rules, plan_store, race_prediction, readiness, service
from .. import goal_fit, llm
from ..parser import parse_plan_document, serialize_plan
from . import garmin_session, schemas
from .auth import current_user_id
from .cache import TTL_GOAL_FIT_NARRATIVE, TTL_PLAN_DIFF, cache
from .routes_coach import _zones, coach_state
from .jobs import job_store

router = APIRouter()


@router.get("/plan", response_model=schemas.PlanResponse)
async def get_plan(user_id: str = Depends(current_user_id)) -> schemas.PlanResponse:
    def read() -> schemas.PlanResponse:
        plan = db.get_plan(user_id)
        if plan is None:
            return schemas.PlanResponse(plan=None)
        return schemas.PlanResponse(plan=schemas.PlanOut.from_model(plan, plan_store.list_sessions(user_id)))

    return await run_in_threadpool(read)


@router.put("/plan", response_model=schemas.PlanOut)
async def save_plan(payload: schemas.PlanIn, user_id: str = Depends(current_user_id)) -> schemas.PlanOut:
    """Import a plan. Sessions are only taken with `import: true` (see `schemas.PlanIn`)."""

    def write() -> schemas.PlanOut:
        plan = db.save_plan(
            user_id=user_id,
            yaml_text=payload.yaml_text,
            filename=payload.filename,
            imported_at=payload.imported_at,
            goal=payload.goal.model_dump(mode="json") if payload.goal else None,
        )
        if payload.is_import:
            plan_store.import_sessions(user_id, [s.model_dump(mode="json") for s in payload.sessions])
        return schemas.PlanOut.from_model(plan, plan_store.list_sessions(user_id))

    return await run_in_threadpool(write)


@router.delete("/plan", response_model=schemas.DeletePlanResponse)
async def delete_plan(user_id: str = Depends(current_user_id)) -> schemas.DeletePlanResponse:
    await run_in_threadpool(db.delete_plan, user_id)
    return schemas.DeletePlanResponse(ok=True)


# ---- one session at a time ---------------------------------------------------------------------
#
# Every write here is the user's, so every write locks the session (see plan_store.py):
# whatever the AI does to the plan afterwards leaves it alone.


def _not_found(session_id: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"Seduta {session_id} non trovata")


@router.post("/plan/sessions", response_model=schemas.TrainingSessionOut)
async def create_session(
    payload: schemas.TrainingSessionIn, user_id: str = Depends(current_user_id)
) -> schemas.TrainingSessionOut:
    def write() -> schemas.TrainingSessionOut:
        db.ensure_plan(user_id)
        created = plan_store.create_session(user_id, payload.model_dump(mode="json"), origin="manual")
        return schemas.TrainingSessionOut.model_validate(created)

    return await run_in_threadpool(write)


@router.patch("/plan/sessions/{session_id}", response_model=schemas.TrainingSessionOut)
async def update_session(
    session_id: UUID, payload: schemas.SessionPatch, user_id: str = Depends(current_user_id)
) -> schemas.TrainingSessionOut:
    def write() -> schemas.TrainingSessionOut:
        try:
            updated = plan_store.update_session(user_id, str(session_id), payload.changes(), by_user=True)
        except plan_store.SessionNotFound:
            raise _not_found(str(session_id))
        return schemas.TrainingSessionOut.model_validate(updated)

    return await run_in_threadpool(write)


@router.delete("/plan/sessions/{session_id}", response_model=schemas.DeletePlanResponse)
async def delete_session(session_id: UUID, user_id: str = Depends(current_user_id)) -> schemas.DeletePlanResponse:
    def write() -> None:
        try:
            plan_store.delete_session(user_id, str(session_id), by_user=True)
        except plan_store.SessionNotFound:
            raise _not_found(str(session_id))

    await run_in_threadpool(write)
    return schemas.DeletePlanResponse(ok=True)


# ---- limits -------------------------------------------------------------------------------------

# How far ahead "the stored plan" reaches when no sessions are sent: the AI plan's detailed
# window (2-3 weeks, see the brainstorming §0.4).
VALIDATE_DAYS_AHEAD = 21


@router.post("/plan/validate", response_model=schemas.ValidatePlanResponse)
async def validate_plan(
    payload: schemas.ValidatePlanRequest | None = None, user_id: str = Depends(current_user_id)
) -> schemas.ValidatePlanResponse:
    """The limits the given sessions -- or the stored plan's next three weeks -- break.

    For the generator to call before writing, and for looking at the rules against a real
    plan. Every violation carries the user's own numbers and the evidence behind it.
    """
    payload = payload or schemas.ValidatePlanRequest()

    def check() -> schemas.ValidatePlanResponse:
        today = date.today()
        end = today + timedelta(days=VALIDATE_DAYS_AHEAD)
        if payload.sessions:
            sessions = [s.to_model() for s in payload.sessions]
            ids = [str(s.id) if s.id else None for s in payload.sessions]
            window = (min(s.date for s in sessions), max(s.date for s in sessions))
        else:
            stored = [s for s in plan_store.list_sessions(user_id) if today.isoformat() <= s["date"] <= end.isoformat()]
            sessions = [schemas.TrainingSessionIn.model_validate(s).to_model() for s in stored]
            ids = [s["id"] for s in stored]
            window = (today, end)

        context = plan_rules.build_context(user_id, today, threshold_available=_zones(user_id) is not None)
        violations = plan_rules.validate(
            sessions, context, ids=ids, start=window[0], end=window[1], only_move_warnings=payload.only_move_warnings
        )
        return schemas.ValidatePlanResponse(
            context=schemas.RuleContextOut(
                effective_level=context.effective_level,
                recent_weekly_minutes=context.recent_weekly_minutes,
                recent_longest_run=context.recent_longest_run,
            ),
            violations=[schemas.ViolationOut(**vars(v)) for v in violations],
        )

    return await run_in_threadpool(check)


# ---- move warnings ------------------------------------------------------------------------------


@router.post("/plan/move-check", response_model=schemas.MoveCheckResponse)
async def check_move(payload: schemas.MoveCheckRequest, user_id: str = Depends(current_user_id)) -> schemas.MoveCheckResponse:
    """What moving a session to a day would make risky (see `move_check.py`). Called after
    the move is shown, so it never delays it; a few database reads, no Garmin call."""

    def run() -> schemas.MoveCheckResponse:
        today = date.today()
        # The threshold read is cached (see `_zones`): a drag and drop costs a few
        # database reads, not a Garmin round-trip.
        context, days = plan_rules.gather_context(user_id, today, threshold_available=_zones(user_id) is not None)
        result = move_check.check_move(
            session_id=str(payload.session_id),
            new_date=payload.date,
            stored=plan_store.list_sessions(user_id),
            days=days,
            checkins=checkin.get_range(user_id, payload.date - timedelta(days=move_check.PAIN_DAYS), payload.date),
            context=context,
            today=today,
            confirmed=move_check.confirmed_fingerprints(user_id),
            from_date=payload.from_date,
        )
        return schemas.MoveCheckResponse(
            warnings=[
                schemas.MoveWarningOut(
                    key=w.key, message=w.message, evidence=w.evidence, dates=w.dates, fingerprint=w.fingerprint
                )
                for w in result.warnings
            ],
            adapted=schemas.TrainingSessionOut.from_model(result.adapted) if result.adapted else None,
        )

    return await run_in_threadpool(run)


@router.post("/plan/move-decisions", response_model=schemas.DeletePlanResponse)
async def record_move_decision(
    payload: schemas.MoveDecisionRequest, user_id: str = Depends(current_user_id)
) -> schemas.DeletePlanResponse:
    await run_in_threadpool(
        move_check.record_decision,
        user_id,
        str(payload.session_id),
        payload.date,
        payload.choice,
        [w.model_dump(mode="json") for w in payload.warnings],
    )
    return schemas.DeletePlanResponse(ok=True)


# ---- adaptation ---------------------------------------------------------------------------------


def _readiness_state(user_id: str, today: date) -> str | None:
    """Today's verdict state, from the cached body snapshot; None when unavailable."""
    from .routes_body import _body_snapshot, _reported_signals

    try:
        session = next((s for s in plan_store.list_sessions(user_id) if s["date"] == today.isoformat()), None)
        verdict = readiness.assess_day(
            _body_snapshot(user_id),
            plan_generator.session_from_dict(session) if session else None,
            today=today,
            reported=_reported_signals(user_id, today),
        )
        return verdict.state
    except Exception:  # noqa: BLE001 - no readiness is one event fewer, not an error
        return None


def _adaptation_response(row: dict | None) -> schemas.AdaptationResponse:
    return schemas.AdaptationResponse(adaptation=schemas.AdaptationOut.from_row(row) if row else None)


@router.post("/plan/adaptation/check", response_model=schemas.AdaptationResponse)
async def check_adaptation(user_id: str = Depends(current_user_id)) -> schemas.AdaptationResponse | JSONResponse:
    """Look at what happened and adapt the plan (see `plan_adaptation.py`): applied in
    `automatico`, stored as a proposal in `proposta`. Nothing new, nothing returned. A
    replan waits on the model like a generation does, and shares its lock."""

    def run() -> schemas.AdaptationResponse | JSONResponse:
        today = date.today()
        zones = _zones(user_id)
        context, days = plan_rules.gather_context(user_id, today, threshold_available=zones is not None)
        stored_mode = history.load_profile(user_id)["adaptation_mode"]
        mode = stored_mode or levels.default_adaptation_mode(context.effective_level)

        def replan():
            state = coach_state(user_id)
            return plan_generator.generate(
                user_id,
                today,
                profile=state[1].profile if state and state[1] else None,
                threshold_available=zones is not None,
                write=False,
                hold_lock=False,
            )

        try:
            with plan_generator.one_at_a_time(user_id):
                row = plan_adaptation.run_check(
                    user_id,
                    today,
                    days=days,
                    checkins=checkin.get_range(user_id, today - timedelta(days=1), today),
                    readiness_state=_readiness_state(user_id, today),
                    threshold_now=zones.threshold_hr if zones else None,
                    mode=mode,
                    replan=replan,
                )
        except plan_generator.GenerationInProgress:
            return _error(409, "validation_failed", "Sto già lavorando sul piano: riprova fra poco.")
        except plan_generator.GenerationFailed as exc:
            return _error(422, "validation_failed", "Non riesco ad adattare il piano dentro i limiti.", exc.errors)
        return _adaptation_response(row)

    return await run_in_threadpool(run)


@router.get("/plan/adaptation", response_model=schemas.AdaptationResponse)
async def get_adaptation(user_id: str = Depends(current_user_id)) -> schemas.AdaptationResponse:
    row = await run_in_threadpool(plan_adaptation.current, user_id, date.today())
    return _adaptation_response(row)


@router.post("/plan/adaptation/{adaptation_id}/{action}", response_model=schemas.AdaptationResponse)
async def answer_adaptation(
    adaptation_id: UUID, action: str, user_id: str = Depends(current_user_id)
) -> schemas.AdaptationResponse | JSONResponse:
    def run() -> schemas.AdaptationResponse | JSONResponse:
        try:
            if action == "accept":
                row = plan_adaptation.accept(user_id, str(adaptation_id))
            elif action == "reject":
                row = plan_adaptation.reject(user_id, str(adaptation_id))
            elif action == "undo":
                row = plan_adaptation.undo(user_id, str(adaptation_id), date.today())
            else:
                return _error(404, "validation_failed", f"Azione {action} sconosciuta.")
        except plan_adaptation.AdaptationNotFound:
            return _error(404, "validation_failed", "Adattamento non trovato.")
        except plan_adaptation.AdaptationNotPending:
            return _error(409, "validation_failed", "Questo adattamento è già stato gestito.")
        return _adaptation_response(row)

    return await run_in_threadpool(run)


# ---- generation ---------------------------------------------------------------------------------


def _error(status: int, category: str, message: str, details: list[str] | None = None) -> JSONResponse:
    """The app's error shape (`schemas.ErrorResponse`), which the web client reads."""
    return JSONResponse(
        status_code=status,
        content=schemas.ErrorResponse(category=category, message=message, details=details or []).model_dump(),
    )


@router.post("/plan/generate", response_model=schemas.GeneratePlanResponse)
async def generate_plan(
    payload: schemas.GeneratePlanRequest | None = None, user_id: str = Depends(current_user_id)
) -> schemas.GeneratePlanResponse | JSONResponse:
    """Write the next weeks: the model composes inside the code's limits, the code checks,
    and sessions edited by hand stay (see `plan_generator.py`). Blocks until done --
    usually one model call, bounded at a few."""
    payload = payload or schemas.GeneratePlanRequest()

    def run() -> schemas.GeneratePlanResponse | JSONResponse:
        state = coach_state(user_id)
        profile = state[1].profile if state and state[1] else None
        try:
            result = plan_generator.generate(
                user_id,
                date.today(),
                profile=profile,
                threshold_available=state is not None,
                regenerate_skeleton=payload.regenerate_skeleton,
                threshold_hr=state[0].threshold_hr if state else None,
            )
        except plan_generator.GenerationInProgress:
            return _error(409, "validation_failed", "Sto già scrivendo il piano: aspetta che finisca.")
        except plan_generator.GenerationFailed as exc:
            return _error(422, "validation_failed", "Non riesco a scrivere un piano dentro i limiti.", exc.errors)
        return schemas.GeneratePlanResponse.from_model(result)

    return await run_in_threadpool(run)


@router.get("/plan/skeleton", response_model=schemas.SkeletonResponse)
async def get_skeleton(user_id: str = Depends(current_user_id)) -> schemas.SkeletonResponse:
    stored = await run_in_threadpool(db.get_skeleton, user_id)
    if not stored:
        return schemas.SkeletonResponse(weeks=None)
    return schemas.SkeletonResponse(weeks=[schemas.SkeletonWeekOut(**week) for week in stored["weeks"]])


@router.get("/plan/export")
async def export_plan(user_id: str = Depends(current_user_id)) -> Response:
    """The plan as the same YAML the importer reads -- including everything added or
    edited in the app, so the file stays a real way out."""

    def build() -> str:
        plan = db.get_plan(user_id)
        sessions = [schemas.TrainingSessionIn.model_validate(s).to_model() for s in plan_store.list_sessions(user_id)]
        goal = schemas.RaceGoalIn.model_validate(plan.goal).to_model() if plan and plan.goal else None
        return serialize_plan(sessions, goal)

    text = await run_in_threadpool(build)
    return Response(
        content=text,
        media_type="text/yaml; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="piano-passo.yaml"'},
    )


@router.get("/goal", response_model=schemas.GoalResponse)
async def get_goal(user_id: str = Depends(current_user_id)) -> schemas.GoalResponse:
    """The race set before any plan exists to hold it -- a live Garmin-calendar-only
    account's only place to keep one. Once a plan is imported its own `goal` (returned
    by `/plan`, not here) takes over; `save_plan` adopts whatever is stored here into
    that first plan, so this is never the answer for a user who has one."""
    raw = await run_in_threadpool(db.get_standalone_goal, user_id)
    if not raw:
        return schemas.GoalResponse(goal=None)
    goal = schemas.RaceGoalIn.model_validate(raw).to_model()
    return schemas.GoalResponse(goal=schemas.RaceGoalOut.from_model(goal))


@router.put("/goal", response_model=schemas.GoalResponse)
async def set_goal(payload: schemas.SetGoalRequest, user_id: str = Depends(current_user_id)) -> schemas.GoalResponse:
    raw = payload.goal.model_dump(mode="json") if payload.goal else None
    saved = await run_in_threadpool(db.set_standalone_goal, user_id, raw)
    if not saved:
        return schemas.GoalResponse(goal=None)
    goal = schemas.RaceGoalIn.model_validate(saved).to_model()
    return schemas.GoalResponse(goal=schemas.RaceGoalOut.from_model(goal))


@router.post("/plan/parse", response_model=schemas.ParsePlanResponse)
async def parse_plan(
    file: UploadFile | None = File(None), yaml_text: str | None = Form(None)
) -> schemas.ParsePlanResponse:
    if file is not None:
        content = (await file.read()).decode("utf-8")
    elif yaml_text is not None:
        content = yaml_text
    else:
        raise HTTPException(status_code=400, detail="Provide either 'file' or 'yaml_text'")

    with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    try:
        # TrainingPlanValidationError propagates to the app-level exception handler.
        parsed = await run_in_threadpool(parse_plan_document, tmp_path)
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    return schemas.ParsePlanResponse(
        sessions=[schemas.TrainingSessionOut.from_model(s) for s in parsed.sessions],
        goal=schemas.RaceGoalOut.from_model(parsed.goal) if parsed.goal else None,
    )


@router.post("/plan/goal-fit", response_model=schemas.GoalFitResponse)
async def plan_goal_fit(
    payload: schemas.GoalFitRequest, user_id: str = Depends(current_user_id)
) -> schemas.GoalFitResponse:
    """Read the sessions already in the plan against the race just named.

    Pure arithmetic over what the client sent -- no Garmin, no database, nothing cached:
    the answer depends only on the request, and the request changes every time the plan
    does.
    """
    fit = await run_in_threadpool(
        goal_fit.assess_plan_fit,
        [s.to_model() for s in payload.sessions],
        payload.goal.to_model(),
        payload.date,
    )
    return schemas.GoalFitResponse.from_model(fit)


@router.post("/plan/goal-fit/narrative", response_model=schemas.NarrativeResponse)
async def plan_goal_fit_narrative(
    payload: schemas.GoalFitRequest, refresh: bool = False, user_id: str = Depends(current_user_id)
) -> schemas.NarrativeResponse:
    """The same reading, phrased. Cached on the conclusion it describes, so the model is
    asked once per plan-and-race rather than once per screen open."""
    goal = payload.goal.to_model()
    sessions = [s.to_model() for s in payload.sessions]
    fit = await run_in_threadpool(goal_fit.assess_plan_fit, sessions, goal, payload.date)

    def compute() -> schemas.NarrativeResponse:
        text = llm.write_goal_fit_narrative(goal_fit.fit_facts(fit, goal))
        if text:
            return schemas.NarrativeResponse(text=text, source="model")
        return schemas.NarrativeResponse(text=fit.headline, source="template")

    key = (
        fit.race_date,
        fit.alignment,
        fit.sessions_ahead,
        tuple(observation.key for observation in fit.observations),
    )
    return await run_in_threadpool(
        lambda: cache.get_or_call("plan:goal-fit-narrative", user_id, key, TTL_GOAL_FIT_NARRATIVE, compute, refresh=refresh)
    )


@router.post("/plan/goal-prediction", response_model=schemas.RacePredictionResponse)
async def plan_goal_prediction(
    payload: schemas.GoalFitRequest,
    user_id: str = Depends(current_user_id),
) -> schemas.RacePredictionResponse:
    """Predict race finish time and calculate honest goal confidence from executed runs.

    Uses Peter Riegel formula on recent performance efforts, checks volume adherence,
    and cross-checks the longest completed run against recommended guides.
    """
    today = payload.date or date.today()
    goal = payload.goal.to_model()
    sessions = [s.to_model() for s in payload.sessions]

    def compute() -> schemas.RacePredictionResponse:
        start_date = today - timedelta(days=60)
        acts = history.activities_between(user_id, start_date, today)

        vo2max = None
        try:
            status_dict = garmin_session.run(user_id, lambda sync: sync.training_status())
            if isinstance(status_dict, dict):
                vo2max = status_dict.get("vo2MaxPreciseValue") or status_dict.get("vo2MaxValue")
                if vo2max:
                    vo2max = float(vo2max)
        except Exception:
            pass

        aerobic_thr_hr = None
        try:
            zones = _zones(user_id)
            if zones:
                aerobic_thr_hr = zones.aerobic_hr
        except Exception:
            pass

        res = race_prediction.assess_race_prediction(
            activities=acts,
            goal=goal,
            planned_sessions=sessions,
            today=today,
            vo2max=vo2max,
            aerobic_threshold_hr=aerobic_thr_hr,
        )
        return schemas.RacePredictionResponse.from_model(res)

    return await run_in_threadpool(compute)


@router.post("/plan/diff", response_model=schemas.DiffResponse)
async def diff_plan(
    payload: schemas.DiffRequest, refresh: bool = False, user_id: str = Depends(current_user_id)
) -> schemas.DiffResponse:
    sessions = [s.to_model() for s in payload.sessions]
    # Keyed by the exact plan (and by check_content, which changes the answer's depth):
    # Oggi asks for this on every mount, and with check_content it costs one Garmin
    # call per matched session on top of the calendar read.
    key = hashlib.sha1(payload.model_dump_json().encode()).hexdigest()
    diff = await run_in_threadpool(
        lambda: cache.get_or_call(
            "plan:diff",
            user_id,
            key,
            TTL_PLAN_DIFF,
            lambda: garmin_session.run(
                user_id,
                lambda sync: service.preview_plan_sync(
                    sessions, False, payload.check_content, sync=sync
                ).diff,
            ),
            refresh=refresh,
        )
    )
    return schemas.DiffResponse.from_model(diff)


@router.post("/plan/sync", response_model=schemas.StartSyncResponse)
async def start_sync(
    payload: schemas.StartSyncRequest, user_id: str = Depends(current_user_id)
) -> schemas.StartSyncResponse:
    to_create = [s.to_model() for s in payload.to_create]
    changed = [c.to_model() for c in payload.changed]
    job_id = job_store.start(user_id, to_create, changed)
    return schemas.StartSyncResponse(job_id=job_id)


@router.get("/plan/sync/{job_id}", response_model=schemas.SyncJobStatus)
async def get_sync_status(job_id: str, user_id: str = Depends(current_user_id)) -> schemas.SyncJobStatus:
    job = job_store.get(user_id, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown job id")
    return schemas.SyncJobStatus(
        job_id=job.job_id,
        total=job.total,
        completed=job.completed,
        status=job.status,
        cancel_requested=job.cancel_requested,
        items=[
            schemas.SyncItemResult(
                date=item.date,
                sport=item.sport,
                title=item.title,
                kind=item.kind,
                status=item.status,
                error=item.error,
            )
            for item in job.items
        ],
        failure=job.failure,
        failure_category=job.failure_category,
    )


@router.post("/plan/sync/{job_id}/cancel", response_model=schemas.CancelSyncResponse)
async def cancel_sync(job_id: str, user_id: str = Depends(current_user_id)) -> schemas.CancelSyncResponse:
    if not job_store.request_cancel(user_id, job_id):
        raise HTTPException(status_code=404, detail="Unknown job id")
    return schemas.CancelSyncResponse(ok=True)
