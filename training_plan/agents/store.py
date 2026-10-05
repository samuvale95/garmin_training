"""Persistence for the agents: what ran, what they proposed, what they must not repeat."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .. import db

SCHEMA = """
CREATE TABLE IF NOT EXISTS agent_runs (
    id           BIGSERIAL PRIMARY KEY,
    agent        TEXT NOT NULL,
    trigger      TEXT NOT NULL,
    status       TEXT NOT NULL,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ,
    steps        INTEGER NOT NULL DEFAULT 0,
    llm_calls    INTEGER NOT NULL DEFAULT 0,
    cost_usd     NUMERIC(10, 4) NOT NULL DEFAULT 0,
    output       JSONB NOT NULL DEFAULT '{}'::jsonb,
    error        TEXT
);
CREATE INDEX IF NOT EXISTS agent_runs_agent_time ON agent_runs (agent, started_at DESC);

CREATE TABLE IF NOT EXISTS agent_proposals (
    id             BIGSERIAL PRIMARY KEY,
    agent          TEXT NOT NULL,
    run_id         BIGINT REFERENCES agent_runs(id) ON DELETE SET NULL,
    fingerprint    TEXT NOT NULL,
    category       TEXT NOT NULL,
    title          TEXT NOT NULL,
    problem        TEXT NOT NULL,
    evidence       JSONB NOT NULL,
    severity       TEXT NOT NULL,
    confidence     NUMERIC(3, 2) NOT NULL,
    proposal       TEXT NOT NULL,
    impact         TEXT,
    effort         TEXT,
    status         TEXT NOT NULL DEFAULT 'nuova',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at     TIMESTAMPTZ,
    decision_note  TEXT
);
CREATE INDEX IF NOT EXISTS agent_proposals_status ON agent_proposals (status, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_memory (
    agent        TEXT NOT NULL,
    fingerprint  TEXT NOT NULL,
    kind         TEXT NOT NULL,
    note         TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agent, fingerprint)
);

CREATE TABLE IF NOT EXISTS agent_settings (
    id                  BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    enabled             BOOLEAN NOT NULL DEFAULT FALSE,
    daily_budget_usd    NUMERIC(10, 2) NOT NULL DEFAULT 0.50,
    monthly_budget_usd  NUMERIC(10, 2) NOT NULL DEFAULT 5.00,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO agent_settings (id) VALUES (TRUE) ON CONFLICT DO NOTHING;
"""

PROPOSAL_STATUSES = ("nuova", "approvata", "scartata", "realizzata")
OPEN_STATUSES = ("nuova", "approvata")


def ensure_schema() -> None:
    with db.connect() as conn:
        conn.execute(SCHEMA)


# ---- settings -----------------------------------------------------------------------


def get_settings() -> dict[str, Any]:
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT enabled, daily_budget_usd, monthly_budget_usd FROM agent_settings WHERE id")
        row = cur.fetchone() or {"enabled": False, "daily_budget_usd": 0, "monthly_budget_usd": 0}
    return {
        "enabled": bool(row["enabled"]),
        "daily_budget_usd": float(row["daily_budget_usd"]),
        "monthly_budget_usd": float(row["monthly_budget_usd"]),
    }


def update_settings(**fields: Any) -> dict[str, Any]:
    allowed = {k: v for k, v in fields.items() if k in ("enabled", "daily_budget_usd", "monthly_budget_usd") and v is not None}
    if allowed:
        sets = ", ".join(f"{k} = %s" for k in allowed)
        with db.connect() as conn:
            conn.execute(f"UPDATE agent_settings SET {sets}, updated_at = now() WHERE id", list(allowed.values()))
    return get_settings()


def spend() -> dict[str, float]:
    """What all agents together have spent today and this month (UTC)."""
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """SELECT
                 coalesce(sum(cost_usd) FILTER (WHERE started_at >= date_trunc('day', now())), 0) AS today,
                 coalesce(sum(cost_usd) FILTER (WHERE started_at >= date_trunc('month', now())), 0) AS month
               FROM agent_runs WHERE started_at >= date_trunc('month', now()) - interval '1 day'"""
        )
        row = cur.fetchone()
    return {"today": float(row["today"]), "month": float(row["month"])}


# ---- runs ---------------------------------------------------------------------------


def start_run(agent: str, trigger: str) -> int:
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO agent_runs (agent, trigger, status) VALUES (%s, %s, 'running') RETURNING id", [agent, trigger])
        return cur.fetchone()[0]


def record_skipped(agent: str, trigger: str, status: str, reason: str) -> int:
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO agent_runs (agent, trigger, status, finished_at, error)
               VALUES (%s, %s, %s, now(), %s) RETURNING id""",
            [agent, trigger, status, reason],
        )
        return cur.fetchone()[0]


def finish_run(
    run_id: int, *, status: str, steps: int, llm_calls: int, cost_usd: float, output: dict, error: str | None = None
) -> None:
    with db.connect() as conn:
        conn.execute(
            """UPDATE agent_runs SET status = %s, finished_at = now(), steps = %s, llm_calls = %s,
                 cost_usd = %s, output = %s, error = %s WHERE id = %s""",
            [status, steps, llm_calls, cost_usd, Jsonb(output), error, run_id],
        )


def running_since(agent: str, minutes: int = 60) -> bool:
    """True if this agent has a run still marked running from the last `minutes` -- a
    second trigger then waits instead of doubling the work and the cost."""
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM agent_runs WHERE agent = %s AND status = 'running' AND started_at > now() - make_interval(mins => %s)",
            [agent, minutes],
        )
        return cur.fetchone() is not None


def last_success(agent: str) -> datetime | None:
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT max(started_at) FROM agent_runs WHERE agent = %s AND status = 'ok'", [agent])
        row = cur.fetchone()
        return row[0] if row else None


def list_runs(limit: int = 30) -> list[dict[str, Any]]:
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """SELECT id, agent, trigger, status, started_at, finished_at, steps, llm_calls, cost_usd, output, error
               FROM agent_runs ORDER BY started_at DESC LIMIT %s""",
            [limit],
        )
        return cur.fetchall()


# ---- proposals and memory ------------------------------------------------------------


def is_known(agent: str, fingerprint: str) -> bool:
    """Already rejected once, or already open: either way, not worth proposing again."""
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT 1 FROM agent_memory WHERE agent = %s AND fingerprint = %s AND kind = 'scartata'
               UNION ALL
               SELECT 1 FROM agent_proposals WHERE agent = %s AND fingerprint = %s AND status = ANY(%s)
               LIMIT 1""",
            [agent, fingerprint, agent, fingerprint, list(OPEN_STATUSES)],
        )
        return cur.fetchone() is not None


def proposals_this_week(agent: str) -> int:
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) FROM agent_proposals WHERE agent = %s AND created_at > now() - interval '7 days'", [agent]
        )
        return cur.fetchone()[0]


def insert_proposal(agent: str, run_id: int, proposal: dict[str, Any]) -> int:
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO agent_proposals
               (agent, run_id, fingerprint, category, title, problem, evidence, severity, confidence, proposal, impact, effort)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
            [
                agent,
                run_id,
                proposal["fingerprint"],
                proposal["category"],
                proposal["title"],
                proposal["problem"],
                Jsonb(proposal["evidence"]),
                proposal["severity"],
                proposal["confidence"],
                proposal["proposal"],
                proposal.get("impact"),
                proposal.get("effort"),
            ],
        )
        return cur.fetchone()[0]


def list_proposals(status: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """SELECT id, agent, run_id, category, title, problem, evidence, severity, confidence, proposal,
                      impact, effort, status, created_at, decided_at, decision_note
               FROM agent_proposals WHERE (%s::text IS NULL OR status = %s)
               ORDER BY CASE severity WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, created_at DESC
               LIMIT %s""",
            [status, status, limit],
        )
        return cur.fetchall()


def decide_proposal(proposal_id: int, status: str, note: str | None) -> dict[str, Any] | None:
    """Approve / discard / mark done. A discard is remembered, so the agent never brings
    the same finding back."""
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """UPDATE agent_proposals SET status = %s, decided_at = now(), decision_note = %s
               WHERE id = %s RETURNING id, agent, fingerprint, status""",
            [status, note, proposal_id],
        )
        row = cur.fetchone()
        if row and status == "scartata":
            cur.execute(
                """INSERT INTO agent_memory (agent, fingerprint, kind, note) VALUES (%s, %s, 'scartata', %s)
                   ON CONFLICT (agent, fingerprint) DO UPDATE SET kind = 'scartata', note = EXCLUDED.note""",
                [row["agent"], row["fingerprint"], note],
            )
        return row


def read_view(view: str, since_weeks: int) -> list[dict[str, Any]]:
    """Rows of one aggregate view, in a read-only transaction: whatever an agent does with
    this connection, it cannot write. `view` is checked against a whitelist by the caller."""
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        with conn.transaction():
            cur.execute("SET TRANSACTION READ ONLY")
            cur.execute(
                f"SELECT * FROM {view} WHERE week >= (date_trunc('week', now()) - make_interval(weeks => %s))::date",
                [since_weeks],
            )
            return cur.fetchall()
