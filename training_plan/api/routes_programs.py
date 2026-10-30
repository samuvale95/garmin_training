"""Authenticated local program proposals and independent goal lifecycle."""
from __future__ import annotations

from typing import Any, Literal
from fastapi import APIRouter, BackgroundTasks, Depends
from fastapi.responses import JSONResponse
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field

from .. import programs
from .auth import current_user_id
from .cache import invalidate_calendar

router=APIRouter()


class Request(BaseModel):
    model_config=ConfigDict(extra="forbid")


class DraftIn(Request):
    name: str=Field(min_length=1,max_length=200)
    source: Literal["ai","import"]
    mode: Literal["new","merge","replace"]="new"
    target_plan_id: str | None=None
    goal_id: str | None=None
    inputs: dict[str,Any]=Field(default_factory=dict)
    original_yaml: str | None=Field(default=None,max_length=2_000_000)
    sessions: list[dict[str,Any]]=Field(default_factory=list,max_length=2000)


class Revision(Request):
    expected_revision: int=Field(ge=1)


class DraftPatch(Revision):
    name: str | None=Field(default=None,min_length=1,max_length=200)
    mode: Literal["new","merge","replace"] | None=None
    target_plan_id: str | None=None
    goal_id: str | None=None
    inputs: dict[str,Any] | None=None
    original_yaml: str | None=Field(default=None,max_length=2_000_000)
    sessions: list[dict[str,Any]] | None=Field(default=None,max_length=2000)


class Activate(Revision):
    validation_token: str=Field(min_length=1)
    acknowledge_insufficient_data: bool=False


class ConstraintsIn(Request):
    expected_revision: int=Field(ge=0)
    available_days: list[int]
    max_daily_minutes: float | None=None
    max_sessions_per_day: int=Field(ge=1,le=10)


class GoalIn(Request):
    type: Literal["race","performance","fitness","strength","consistency","maintenance"]
    name: str=Field(min_length=1,max_length=200)
    description: str | None=None
    sports: list[str]=Field(default_factory=list)
    priority: Literal["primary","secondary"]="secondary"
    status: Literal["active","completed","archived"]="active"
    baseline: dict[str,Any] | None=None
    success_criterion: dict[str,Any] | None=None
    deadline: str | None=None
    review_date: str | None=None
    review_interval_days: int=Field(default=28,ge=1,le=366)
    race_date: str | None=None
    distance_km: float | None=None
    target_time_seconds: int | None=None


class GoalPatch(Revision):
    type: Literal["race","performance","fitness","strength","consistency","maintenance"] | None=None
    name: str | None=Field(default=None,min_length=1,max_length=200)
    description: str | None=None
    sports: list[str] | None=None
    priority: Literal["primary","secondary"] | None=None
    status: Literal["active","completed","archived"] | None=None
    baseline: dict[str,Any] | None=None
    success_criterion: dict[str,Any] | None=None
    deadline: str | None=None
    review_date: str | None=None
    review_interval_days: int | None=Field(default=None,ge=1,le=366)
    race_date: str | None=None
    distance_km: float | None=None
    target_time_seconds: int | None=None


async def call(fn,*args):
    try:
        return await run_in_threadpool(fn,*args)
    except programs.PlanningError as exc:
        details=exc.details or []
        if not isinstance(details,list): details=[details]
        return JSONResponse(status_code=exc.status,content={"category":"validation_failed","message":str(exc),
            "details":[d if isinstance(d,str) else str(d.get("message",d)) for d in details]})


@router.get("/plan/drafts")
async def drafts(user_id: str=Depends(current_user_id)):
    return {"drafts":await call(programs.list_drafts,user_id)}


@router.post("/plan/drafts",status_code=201)
async def create_draft(payload: DraftIn,user_id: str=Depends(current_user_id)):
    return await call(programs.create_draft,user_id,payload.model_dump())


@router.get("/plan/drafts/{draft_id}")
async def draft(draft_id: str,user_id: str=Depends(current_user_id)):
    return await call(programs.get_draft,user_id,draft_id)


@router.patch("/plan/drafts/{draft_id}")
async def patch_draft(draft_id: str,payload: DraftPatch,user_id: str=Depends(current_user_id)):
    changes=payload.model_dump(exclude_unset=True,exclude={"expected_revision"})
    return await call(programs.patch_draft,user_id,draft_id,payload.expected_revision,changes)


@router.post("/plan/drafts/{draft_id}/validate")
async def validate_draft(draft_id: str,payload: Revision,user_id: str=Depends(current_user_id)):
    return await call(programs.validate_draft,user_id,draft_id,payload.expected_revision)


@router.post("/plan/drafts/{draft_id}/generate",status_code=202)
async def generate_draft(draft_id: str,payload: Revision,background_tasks: BackgroundTasks,user_id: str=Depends(current_user_id)):
    result=await call(programs.begin_generation,user_id,draft_id,payload.expected_revision)
    if isinstance(result,JSONResponse): return result
    background_tasks.add_task(programs.generate_draft,user_id,draft_id,result["job_token"])
    return result


@router.post("/plan/drafts/{draft_id}/activate")
async def activate_draft(draft_id: str,payload: Activate,user_id: str=Depends(current_user_id)):
    result=await call(programs.activate_draft,user_id,draft_id,payload.expected_revision,payload.validation_token,payload.acknowledge_insufficient_data)
    invalidate_calendar(user_id)
    return result


@router.get("/plan/constraints")
async def constraints(user_id: str=Depends(current_user_id)):
    return await call(programs.get_constraints,user_id)


@router.put("/plan/constraints")
async def save_constraints(payload: ConstraintsIn,user_id: str=Depends(current_user_id)):
    return await call(programs.save_constraints,user_id,payload.model_dump())


@router.get("/goals")
async def goals(user_id: str=Depends(current_user_id)):
    return {"goals":await call(programs.list_goals,user_id)}


@router.post("/goals",status_code=201)
async def create_goal(payload: GoalIn,user_id: str=Depends(current_user_id)):
    return await call(programs.create_goal,user_id,payload.model_dump())


@router.get("/goals/{goal_id}")
async def goal(goal_id: str,user_id: str=Depends(current_user_id)):
    return await call(programs.get_goal,user_id,goal_id)


@router.patch("/goals/{goal_id}")
async def patch_goal(goal_id: str,payload: GoalPatch,user_id: str=Depends(current_user_id)):
    return await call(programs.patch_goal,user_id,goal_id,payload.expected_revision,payload.model_dump(exclude_unset=True,exclude={"expected_revision"}))


@router.get("/goals/{goal_id}/evaluations")
async def evaluations(goal_id: str,user_id: str=Depends(current_user_id)):
    result=await call(programs.list_evaluations,user_id,goal_id)
    return result if isinstance(result,JSONResponse) else {"evaluations":result}


@router.post("/goals/{goal_id}/evaluations",status_code=201)
async def evaluate(goal_id: str,user_id: str=Depends(current_user_id)):
    return await call(programs.evaluate_goal,user_id,goal_id)


class ProgramGoalsIn(Request):
    expected_context_revision: int=Field(ge=0)
    primary_goal_id: str | None=None
    contributing_goal_ids: list[str]=Field(default_factory=list)


@router.get("/plan/{plan_id}/goals")
async def program_goals(plan_id: str,user_id: str=Depends(current_user_id)):
    return await call(programs.program_goals,user_id,plan_id)


@router.put("/plan/{plan_id}/goals")
async def link_goals(plan_id: str,payload: ProgramGoalsIn,user_id: str=Depends(current_user_id)):
    return await call(programs.link_program_goals,user_id,plan_id,payload.model_dump())


@router.post("/plan/{plan_id}/activation-review")
async def activation_review(plan_id: str,user_id: str=Depends(current_user_id)):
    return await call(programs.review_activation,user_id,plan_id)
