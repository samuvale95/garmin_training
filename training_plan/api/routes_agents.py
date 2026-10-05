"""Agents: the admin page's endpoints, and the scheduler's.

Admin endpoints need a signed-in caller listed in `PASSO_ADMIN_USER_IDS` (comma-separated
Supabase user ids): proposals are about the app, not about one athlete, so they are not
scoped per user. The scheduler endpoint (`/agents/cron`) is not behind the JWT gate --
an external cron has no user session -- and takes a shared secret instead.
"""

from __future__ import annotations

import hmac
import os

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.concurrency import run_in_threadpool

from ..agents import runtime, store
from . import schemas
from .auth import current_user_id

router = APIRouter()
cron_router = APIRouter()


def _admin_ids() -> set[str]:
    return {item.strip() for item in os.getenv("PASSO_ADMIN_USER_IDS", "").split(",") if item.strip()}


def is_admin(user_id: str) -> bool:
    return user_id in _admin_ids()


def require_admin(user_id: str = Depends(current_user_id)) -> str:
    if not is_admin(user_id):
        raise HTTPException(status_code=403, detail="Solo per l'amministratore")
    return user_id


@router.get("/admin/me", response_model=schemas.AdminMe)
async def admin_me(user_id: str = Depends(current_user_id)) -> schemas.AdminMe:
    return schemas.AdminMe(is_admin=is_admin(user_id))


def _settings_out() -> schemas.AgentSettingsOut:
    settings = store.get_settings()
    spent = store.spend()
    return schemas.AgentSettingsOut(
        **settings,
        hard_disabled=runtime.hard_disabled(),
        spent_today_usd=spent["today"],
        spent_month_usd=spent["month"],
    )


@router.get("/admin/agents", response_model=schemas.AgentsOverview, dependencies=[Depends(require_admin)])
async def agents_overview() -> schemas.AgentsOverview:
    def _load() -> schemas.AgentsOverview:
        return schemas.AgentsOverview(
            settings=_settings_out(),
            agents=[
                schemas.AgentInfo(
                    name=spec.name,
                    description=spec.description,
                    schedule=spec.schedule,
                    max_steps=spec.max_steps,
                    max_cost_per_run_usd=spec.max_cost_per_run_usd,
                    max_proposals_per_week=spec.max_proposals_per_week,
                    last_success=store.last_success(spec.name),
                )
                for spec in runtime.agents()
            ],
        )

    return await run_in_threadpool(_load)


@router.put("/admin/agents/settings", response_model=schemas.AgentSettingsOut, dependencies=[Depends(require_admin)])
async def update_agent_settings(payload: schemas.AgentSettingsIn) -> schemas.AgentSettingsOut:
    await run_in_threadpool(lambda: store.update_settings(**payload.model_dump()))
    return await run_in_threadpool(_settings_out)


@router.get("/admin/agents/runs", response_model=list[schemas.AgentRunOut], dependencies=[Depends(require_admin)])
async def agent_runs(limit: int = Query(30, ge=1, le=200)) -> list[schemas.AgentRunOut]:
    rows = await run_in_threadpool(store.list_runs, limit)
    return [schemas.AgentRunOut(**{**row, "cost_usd": float(row["cost_usd"])}) for row in rows]


@router.post("/admin/agents/{name}/run", status_code=202, dependencies=[Depends(require_admin)])
async def run_agent_now(name: str) -> dict:
    if runtime.get(name) is None:
        raise HTTPException(status_code=404, detail="Agente sconosciuto")
    runtime.run_in_background(name, "manual")
    return {"started": name}


@router.get("/admin/agents/proposals", response_model=list[schemas.AgentProposalOut], dependencies=[Depends(require_admin)])
async def agent_proposals(status: str | None = Query(None)) -> list[schemas.AgentProposalOut]:
    if status is not None and status not in store.PROPOSAL_STATUSES:
        raise HTTPException(status_code=422, detail="Stato non valido")
    rows = await run_in_threadpool(store.list_proposals, status)
    return [schemas.AgentProposalOut(**{**row, "confidence": float(row["confidence"])}) for row in rows]


@router.post("/admin/agents/proposals/{proposal_id}/decision", dependencies=[Depends(require_admin)])
async def decide(proposal_id: int, payload: schemas.ProposalDecisionIn) -> dict:
    row = await run_in_threadpool(store.decide_proposal, proposal_id, payload.status, payload.note)
    if row is None:
        raise HTTPException(status_code=404, detail="Proposta non trovata")
    return {"id": row["id"], "status": row["status"]}


@cron_router.post("/agents/cron", status_code=202)
async def agents_cron(x_cron_secret: str | None = Header(default=None)) -> dict:
    expected = os.getenv("AGENTS_CRON_SECRET")
    if not expected or not x_cron_secret or not hmac.compare_digest(expected, x_cron_secret):
        raise HTTPException(status_code=401, detail="Secret non valido")
    names = await run_in_threadpool(runtime.run_due, "cron")
    return {"started": names}
