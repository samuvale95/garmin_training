"""The only way an agent runs, and every limit it runs under.

Five controls, in the order they bite:
1. **Kill switch** -- `AGENTS_DISABLED=1` in the environment (hard, needs a restart) or
   the `enabled` flag in `agent_settings` (soft, from the admin page). Off by default.
2. **Budget** -- daily and monthly caps across all agents, plus a per-run cap per agent.
   Checked before the run and before every model call.
3. **Step limit** -- every tool call is a step; past `max_steps` the run is aborted.
4. **Least privilege** -- the context exposes only `read_view` (read-only, whitelisted
   aggregates), `llm` and `propose`. No agent can write anything but a proposal.
5. **Structured output** -- a proposal without evidence is refused; one already
   discarded or still open is skipped; at most `max_proposals_per_week` per agent.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from .. import llm
from . import store

logger = logging.getLogger(__name__)

READABLE_VIEWS: frozenset[str] = frozenset(
    {
        "ux_weekly_frustration",
        "ux_flow_funnel",
        "ux_screen_hesitation",
        "ux_screen_usage",
        "ux_api_health",
        "ux_tracking_coverage",
        "ux_screen_load",
    }
)
CATEGORIES = ("ui_config", "code", "training_algorithm")
SEVERITIES = ("bassa", "media", "alta")
SCHEDULES = {"daily": timedelta(hours=20), "weekly": timedelta(days=6, hours=20)}


class AgentStop(Exception):
    """Ends a run early with a recorded status (budget, step limit)."""

    def __init__(self, status: str, message: str):
        super().__init__(message)
        self.status = status


@dataclass
class AgentSpec:
    name: str
    description: str
    schedule: str  # key of SCHEDULES
    run: Callable[["AgentContext"], dict]
    max_steps: int = 20
    max_cost_per_run_usd: float = 0.10
    max_proposals_per_week: int = 5


@dataclass
class AgentContext:
    spec: AgentSpec
    run_id: int
    budget_left_usd: float
    steps: int = 0
    llm_calls: int = 0
    cost_usd: float = 0.0
    proposals: list[int] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)

    def _step(self) -> None:
        self.steps += 1
        if self.steps > self.spec.max_steps:
            raise AgentStop("aborted_steps", f"superato il limite di {self.spec.max_steps} passi")

    def read_view(self, view: str, since_weeks: int = 2) -> list[dict[str, Any]]:
        self._step()
        if view not in READABLE_VIEWS:
            raise PermissionError(f"vista non consentita: {view}")
        return store.read_view(view, since_weeks)

    def llm(self, messages: list[dict], **kwargs: Any) -> str | None:
        """A model call, charged to this run. Refused once the run or the global budget
        is spent -- the check is before the call, so one call can overshoot by its own
        cost at most."""
        self._step()
        remaining = min(self.spec.max_cost_per_run_usd - self.cost_usd, self.budget_left_usd - self.cost_usd)
        if remaining <= 0:
            raise AgentStop("aborted_budget", "budget esaurito")
        result = llm.chat_with_usage(messages, **kwargs)
        self.llm_calls += 1
        if result is None:
            return None
        self.cost_usd += result.cost_usd
        return result.content

    def propose(
        self,
        *,
        key: str,
        category: str,
        title: str,
        problem: str,
        evidence: dict[str, Any],
        severity: str,
        confidence: float,
        proposal: str,
        impact: str | None = None,
        effort: str | None = None,
    ) -> int | None:
        """Files one proposal. `key` identifies the finding (e.g. `rage_tap:nutrition.save`)
        so the same one is never filed twice. Returns its id, or None if skipped."""
        self._step()
        if not evidence:
            raise ValueError("una proposta senza evidenza non viene mostrata")
        if category not in CATEGORIES or severity not in SEVERITIES or not 0 <= confidence <= 1:
            raise ValueError("categoria, gravità o confidenza non valide")
        fingerprint = hashlib.sha256(f"{self.spec.name}:{key}".encode()).hexdigest()[:32]
        if store.is_known(self.spec.name, fingerprint):
            self.skipped.append(f"{key}: già proposta o scartata")
            return None
        if store.proposals_this_week(self.spec.name) >= self.spec.max_proposals_per_week:
            self.skipped.append(f"{key}: limite settimanale raggiunto")
            return None
        proposal_id = store.insert_proposal(
            self.spec.name,
            self.run_id,
            {
                "fingerprint": fingerprint,
                "category": category,
                "title": title[:200],
                "problem": problem,
                "evidence": json.loads(json.dumps(evidence, default=str)),
                "severity": severity,
                "confidence": round(confidence, 2),
                "proposal": proposal,
                "impact": impact,
                "effort": effort,
            },
        )
        self.proposals.append(proposal_id)
        return proposal_id


# ---- registry -----------------------------------------------------------------------

_REGISTRY: dict[str, AgentSpec] = {}


def register(spec: AgentSpec) -> AgentSpec:
    _REGISTRY[spec.name] = spec
    return spec


def agents() -> list[AgentSpec]:
    from . import ux_detector  # noqa: F401 - registers itself

    return list(_REGISTRY.values())


def get(name: str) -> AgentSpec | None:
    agents()
    return _REGISTRY.get(name)


def hard_disabled() -> bool:
    return os.getenv("AGENTS_DISABLED", "0") == "1"


# ---- running ------------------------------------------------------------------------


def run_agent(name: str, trigger: str) -> int:
    """Runs one agent to completion, synchronously. Returns the run id; every outcome
    -- including "not run" -- leaves a row in `agent_runs`."""
    spec = get(name)
    if spec is None:
        raise KeyError(name)
    if hard_disabled():
        return store.record_skipped(name, trigger, "skipped_disabled", "AGENTS_DISABLED=1")
    settings = store.get_settings()
    if not settings["enabled"]:
        return store.record_skipped(name, trigger, "skipped_disabled", "agenti spenti dalle impostazioni")
    if store.running_since(name):
        return store.record_skipped(name, trigger, "skipped_running", "un'altra esecuzione è in corso")
    spent = store.spend()
    budget_left = min(
        settings["daily_budget_usd"] - spent["today"], settings["monthly_budget_usd"] - spent["month"]
    )
    if budget_left <= 0:
        return store.record_skipped(name, trigger, "skipped_budget", f"budget esaurito (oggi {spent['today']:.2f}$, mese {spent['month']:.2f}$)")

    run_id = store.start_run(name, trigger)
    ctx = AgentContext(spec=spec, run_id=run_id, budget_left_usd=budget_left)
    status, error, output = "ok", None, {}
    try:
        output = spec.run(ctx) or {}
    except AgentStop as stop:
        status, error = stop.status, str(stop)
    except Exception as exc:  # noqa: BLE001 - a failed run is recorded, never raised
        logger.exception("agent %s failed", name)
        status, error = "failed", "".join(traceback.format_exception_only(exc)).strip()[:500]
    output = {**output, "proposals": ctx.proposals, "skipped": ctx.skipped}
    store.finish_run(
        run_id, status=status, steps=ctx.steps, llm_calls=ctx.llm_calls, cost_usd=ctx.cost_usd, output=output, error=error
    )
    return run_id


def run_in_background(name: str, trigger: str) -> None:
    threading.Thread(target=_safe_run, args=(name, trigger), daemon=True, name=f"agent-{name}").start()


def _safe_run(name: str, trigger: str) -> None:
    try:
        run_agent(name, trigger)
    except Exception:  # noqa: BLE001 - background thread: log, never crash the process
        logger.exception("agent %s could not start", name)


def due_agents(now: datetime | None = None) -> list[str]:
    """Agents whose last successful run is older than their schedule allows."""
    now = now or datetime.now(timezone.utc)
    due = []
    for spec in agents():
        last = store.last_success(spec.name)
        if last is None or now - last >= SCHEDULES[spec.schedule]:
            due.append(spec.name)
    return due


def run_due(trigger: str = "cron") -> list[str]:
    """What the scheduler calls: runs every due agent, one after the other, in a thread."""
    names = due_agents()

    def _all() -> None:
        for name in names:
            _safe_run(name, trigger)

    threading.Thread(target=_all, daemon=True, name="agents-cron").start()
    return names
