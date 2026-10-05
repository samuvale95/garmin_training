"""Agent runtime limits, the UX detector's thresholds and the admin/cron gates (store faked)."""

from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from training_plan import llm
from training_plan.agents import runtime, store, ux_detector
from training_plan.agents.runtime import AgentSpec
from training_plan.api.app import app


class FakeStore:
    def __init__(self):
        self.settings = {"enabled": True, "daily_budget_usd": 0.5, "monthly_budget_usd": 5.0}
        self.spent = {"today": 0.0, "month": 0.0}
        self.runs: dict[int, dict] = {}
        self.proposals: list[dict] = []
        self.known: set[str] = set()
        self.running = False
        self.last_ok: datetime | None = None

    def install(self, monkeypatch):
        for name in (
            "get_settings", "spend", "start_run", "record_skipped", "finish_run", "running_since",
            "is_known", "proposals_this_week", "insert_proposal", "last_success", "read_view",
        ):
            monkeypatch.setattr(store, name, getattr(self, name))

    def get_settings(self):
        return dict(self.settings)

    def spend(self):
        return dict(self.spent)

    def start_run(self, agent, trigger):
        run_id = len(self.runs) + 1
        self.runs[run_id] = {"agent": agent, "status": "running"}
        return run_id

    def record_skipped(self, agent, trigger, status, reason):
        run_id = len(self.runs) + 1
        self.runs[run_id] = {"agent": agent, "status": status, "error": reason}
        return run_id

    def finish_run(self, run_id, **fields):
        self.runs[run_id].update(fields)

    def running_since(self, agent, minutes=60):
        return self.running

    def is_known(self, agent, fingerprint):
        return fingerprint in self.known

    def proposals_this_week(self, agent):
        return len(self.proposals)

    def insert_proposal(self, agent, run_id, proposal):
        self.proposals.append(proposal)
        return len(self.proposals)

    def last_success(self, agent):
        return self.last_ok

    def read_view(self, view, since_weeks):
        return []


@pytest.fixture
def fake(monkeypatch):
    monkeypatch.delenv("AGENTS_DISABLED", raising=False)
    fake = FakeStore()
    fake.install(monkeypatch)
    return fake


def _register(monkeypatch, fn, **kw):
    spec = AgentSpec(name="test_agent", description="t", schedule="daily", run=fn, **kw)
    monkeypatch.setitem(runtime._REGISTRY, "test_agent", spec)
    return spec


def _proposal(ctx, key="k", evidence=None):
    return ctx.propose(
        key=key, category="ui_config", title="t", problem="p", evidence={"events": 7} if evidence is None else evidence,
        severity="media", confidence=0.6, proposal="x",
    )


def test_disabled_in_settings_skips_without_running(fake, monkeypatch):
    called = []
    _register(monkeypatch, lambda ctx: called.append(1))
    fake.settings["enabled"] = False
    run_id = runtime.run_agent("test_agent", "manual")
    assert fake.runs[run_id]["status"] == "skipped_disabled" and not called


def test_env_kill_switch_wins_over_settings(fake, monkeypatch):
    _register(monkeypatch, lambda ctx: {})
    monkeypatch.setenv("AGENTS_DISABLED", "1")
    assert fake.runs[runtime.run_agent("test_agent", "cron")]["status"] == "skipped_disabled"


def test_spent_budget_skips(fake, monkeypatch):
    _register(monkeypatch, lambda ctx: {})
    fake.spent["today"] = 0.5
    assert fake.runs[runtime.run_agent("test_agent", "cron")]["status"] == "skipped_budget"


def test_concurrent_run_skips(fake, monkeypatch):
    _register(monkeypatch, lambda ctx: {})
    fake.running = True
    assert fake.runs[runtime.run_agent("test_agent", "cron")]["status"] == "skipped_running"


def test_step_limit_aborts(fake, monkeypatch):
    def loop(ctx):
        while True:
            ctx.read_view("ux_flow_funnel")

    _register(monkeypatch, loop, max_steps=3)
    run = fake.runs[runtime.run_agent("test_agent", "manual")]
    assert run["status"] == "aborted_steps" and run["steps"] == 4


def test_only_whitelisted_views(fake, monkeypatch):
    _register(monkeypatch, lambda ctx: ctx.read_view("interaction_events"))
    run = fake.runs[runtime.run_agent("test_agent", "manual")]
    assert run["status"] == "failed" and "PermissionError" in run["error"]


def test_llm_cost_is_charged_and_budget_enforced(fake, monkeypatch):
    monkeypatch.setattr(llm, "chat_with_usage", lambda messages, **kw: llm.ChatResult(content="ok", cost_usd=0.03))

    def spend(ctx):
        for _ in range(10):
            ctx.llm([{"role": "user", "content": "x"}])

    _register(monkeypatch, spend, max_cost_per_run_usd=0.05)
    run = fake.runs[runtime.run_agent("test_agent", "manual")]
    assert run["status"] == "aborted_budget"
    assert run["llm_calls"] == 2 and run["cost_usd"] == pytest.approx(0.06)


def test_proposal_without_evidence_fails_the_run(fake, monkeypatch):
    _register(monkeypatch, lambda ctx: _proposal(ctx, evidence={}))
    assert fake.runs[runtime.run_agent("test_agent", "manual")]["status"] == "failed"
    assert fake.proposals == []


def test_known_and_weekly_capped_proposals_are_skipped(fake, monkeypatch):
    def many(ctx):
        for i in range(4):
            _proposal(ctx, key=f"k{i}")
        _proposal(ctx, key="k0")

    _register(monkeypatch, many, max_proposals_per_week=2)
    run = fake.runs[runtime.run_agent("test_agent", "manual")]
    assert run["status"] == "ok"
    assert len(fake.proposals) == 2
    assert len(run["output"]["skipped"]) == 3


def test_discarded_fingerprint_is_not_proposed_again(fake, monkeypatch):
    import hashlib

    fake.known.add(hashlib.sha256(b"test_agent:k").hexdigest()[:32])
    _register(monkeypatch, lambda ctx: _proposal(ctx))
    runtime.run_agent("test_agent", "manual")
    assert fake.proposals == []


def test_due_agents_follow_schedule(fake):
    now = datetime(2026, 10, 5, 3, tzinfo=timezone.utc)
    fake.last_ok = now - timedelta(hours=10)
    assert "ux_detector" not in runtime.due_agents(now)
    fake.last_ok = now - timedelta(hours=23)
    assert "ux_detector" in runtime.due_agents(now)


# ---- UX detector ----------------------------------------------------------------------

WEEK = date(2026, 10, 5)


def test_detector_ignores_noise_and_keeps_spread_patterns():
    views = {
        "ux_weekly_frustration": [
            {"week": WEEK, "event_type": "rage_tap", "target": "nutrition.save", "path": "/nutrition", "events": 9, "sessions": 4, "top_reason": None},
            {"week": WEEK, "event_type": "dead_tap", "target": "div:Ritmo", "path": "/today", "events": 20, "sessions": 1, "top_reason": None},
            {"week": WEEK, "event_type": "tap_disabled", "target": "x.save", "path": "/x", "events": 3, "sessions": 3, "top_reason": "in_caricamento"},
        ],
        "ux_flow_funnel": [
            {"week": WEEK, "flow": "meal", "starts": 10, "completes": 4, "abandons": 6, "abandon_rate": 0.6, "top_abandon_step": "estimating"},
        ],
        "ux_api_health": [
            {"week": WEEK, "endpoint": "/nutrition/targets", "errors": 6, "network_failures": 6, "slow": 0, "median_ms": 25000, "top_status": "0"},
        ],
        "ux_tracking_coverage": [{"week": WEEK, "taps": 100, "fallback_taps": 30, "fallback_share": 0.3}],
    }
    anomalies = ux_detector.find_anomalies(views)
    keys = [a["key"] for a in anomalies]
    assert keys[0] == "rage_tap:nutrition.save"
    assert "flow_abandon:meal:estimating" in keys and "api:/nutrition/targets" in keys and "coverage:2026-10-05" in keys
    assert not any("div:Ritmo" in k or "x.save" in k for k in keys)


def test_detector_runs_without_a_model(fake, monkeypatch):
    called = []
    monkeypatch.setattr(llm, "chat_with_usage", lambda *a, **k: called.append(1))
    run = fake.runs[runtime.run_agent("ux_detector", "manual")]
    assert run["status"] == "ok" and run["cost_usd"] == 0 and not called
    assert run["output"]["anomalies"] == []


# ---- HTTP gates -----------------------------------------------------------------------


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("DEV_AUTH_BYPASS_USER_ID", "me")
    return TestClient(app)


def test_admin_endpoints_need_an_admin(client, monkeypatch):
    monkeypatch.setenv("PASSO_ADMIN_USER_IDS", "someone-else")
    assert client.get("/admin/me").json() == {"is_admin": False}
    assert client.get("/admin/agents/runs").status_code == 403
    monkeypatch.setenv("PASSO_ADMIN_USER_IDS", "x, me")
    monkeypatch.setattr(store, "list_runs", lambda limit: [])
    assert client.get("/admin/agents/runs").status_code == 200


def test_cron_needs_the_secret(client, monkeypatch):
    started = []
    monkeypatch.setattr(runtime, "run_due", lambda trigger: started.append(trigger) or ["ux_detector"])
    monkeypatch.delenv("AGENTS_CRON_SECRET", raising=False)
    assert client.post("/agents/cron", headers={"x-cron-secret": "s"}).status_code == 401
    monkeypatch.setenv("AGENTS_CRON_SECRET", "s3cret")
    assert client.post("/agents/cron", headers={"x-cron-secret": "nope"}).status_code == 401
    response = client.post("/agents/cron", headers={"x-cron-secret": "s3cret"})
    assert response.status_code == 202 and response.json() == {"started": ["ux_detector"]}
