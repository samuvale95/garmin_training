"""Where the user taps, hesitates and gets stuck: raw interaction events for later analysis.

Phase 1 of `logging_plan.md` is collection only. The client batches events and posts them;
this module validates, truncates and stores them. It never records what the user typed --
only where they interacted (see `MAX_METADATA_BYTES` and the client's tracker).

Tracking must never get in the way of the app: the route answers 204 and swallows storage
errors (logged, not raised).
"""

from __future__ import annotations

import json
import logging
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Any

from psycopg.types.json import Jsonb

from . import db

logger = logging.getLogger(__name__)

EVENT_TYPES: frozenset[str] = frozenset(
    {
        "tap",
        "tap_disabled",
        "dead_tap",
        "rage_tap",
        "tab_change",
        "screen_view",
        "modal_open",
        "modal_close",
        "flow_start",
        "flow_step",
        "flow_complete",
        "flow_abandon",
        "scroll_depth",
        "api_error",
        "slow_response",
        "ui_error",
        "app_foreground",
        "app_background",
        "screen_ready",
        "load_abandon",
        "long_loading",
        "error_shown",
    }
)

MAX_BATCH = 100
MAX_METADATA_BYTES = 2048
MAX_TEXT = 200
RAW_RETENTION_DAYS = 60

# Per-user cap on batches, so a runaway client cannot flood the table.
RATE_LIMIT_BATCHES = 20
RATE_LIMIT_WINDOW_SECONDS = 60.0

SCHEMA = """
CREATE TABLE IF NOT EXISTS interaction_events (
    id           BIGSERIAL PRIMARY KEY,
    user_id      TEXT NOT NULL,
    session_id   TEXT NOT NULL,
    event_type   TEXT NOT NULL,
    target       TEXT,
    path         TEXT,
    occurred_at  TIMESTAMPTZ NOT NULL,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
    viewport     TEXT,
    app_version  TEXT
);
CREATE INDEX IF NOT EXISTS interaction_events_user_time ON interaction_events (user_id, occurred_at);
CREATE INDEX IF NOT EXISTS interaction_events_type_time ON interaction_events (event_type, occurred_at);
CREATE INDEX IF NOT EXISTS interaction_events_target ON interaction_events (target);

CREATE TABLE IF NOT EXISTS interaction_sessions (
    session_id   TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    started_at   TIMESTAMPTZ NOT NULL,
    ended_at     TIMESTAMPTZ NOT NULL,
    standalone   BOOLEAN,
    user_agent   TEXT,
    event_count  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS interaction_sessions_user ON interaction_sessions (user_id, started_at);
"""

# Weekly aggregates: what an analyst (human or agent) reads instead of raw events. Plain
# views, recomputed on read -- cheap at this volume; a materialized view only if they grow
# slow. Weeks are ISO weeks in UTC (`date_trunc('week', ...)` starts on Monday).
VIEWS = """
CREATE OR REPLACE VIEW ux_weekly_frustration AS
SELECT
    date_trunc('week', occurred_at)::date AS week,
    event_type,
    target,
    path,
    count(*) AS events,
    count(DISTINCT session_id) AS sessions,
    count(DISTINCT user_id) AS users,
    mode() WITHIN GROUP (ORDER BY metadata->>'reason') AS top_reason
FROM interaction_events
WHERE event_type IN ('tap_disabled', 'rage_tap', 'dead_tap')
GROUP BY 1, 2, 3, 4;

CREATE OR REPLACE VIEW ux_flow_funnel AS
SELECT
    date_trunc('week', occurred_at)::date AS week,
    target AS flow,
    count(*) FILTER (WHERE event_type = 'flow_start') AS starts,
    count(*) FILTER (WHERE event_type = 'flow_complete') AS completes,
    count(*) FILTER (WHERE event_type = 'flow_abandon') AS abandons,
    round(
        count(*) FILTER (WHERE event_type = 'flow_abandon')::numeric
        / NULLIF(count(*) FILTER (WHERE event_type IN ('flow_complete', 'flow_abandon')), 0),
        2
    ) AS abandon_rate,
    mode() WITHIN GROUP (ORDER BY metadata->>'step') FILTER (WHERE event_type = 'flow_abandon') AS top_abandon_step
FROM interaction_events
WHERE event_type IN ('flow_start', 'flow_complete', 'flow_abandon')
GROUP BY 1, 2;

-- Hesitation: for every screen_view, the time until the first tap (of any kind) on that
-- screen, i.e. before the session's next screen_view. NULL = left without tapping.
CREATE OR REPLACE VIEW ux_screen_hesitation AS
WITH numbered AS (
    SELECT
        session_id, event_type, target, occurred_at,
        sum(CASE WHEN event_type = 'screen_view' THEN 1 ELSE 0 END)
            OVER (PARTITION BY session_id ORDER BY occurred_at, id) AS view_no
    FROM interaction_events
),
per_view AS (
    SELECT
        session_id, view_no,
        min(occurred_at) FILTER (WHERE event_type = 'screen_view') AS viewed_at,
        max(target) FILTER (WHERE event_type = 'screen_view') AS screen,
        min(occurred_at) FILTER (WHERE event_type IN ('tap', 'tap_disabled', 'dead_tap')) AS first_tap_at
    FROM numbered
    WHERE view_no > 0
    GROUP BY session_id, view_no
)
SELECT
    date_trunc('week', viewed_at)::date AS week,
    screen,
    count(*) AS views,
    count(*) FILTER (WHERE first_tap_at IS NULL) AS views_without_tap,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM first_tap_at - viewed_at) * 1000)
        AS median_ms_to_first_tap,
    percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM first_tap_at - viewed_at) * 1000)
        AS p90_ms_to_first_tap
FROM per_view
WHERE viewed_at IS NOT NULL
GROUP BY 1, 2;

CREATE OR REPLACE VIEW ux_screen_usage AS
SELECT
    date_trunc('week', occurred_at)::date AS week,
    target AS screen,
    count(*) FILTER (WHERE event_type = 'screen_view') AS views,
    count(*) FILTER (WHERE event_type = 'tab_change' AND metadata->>'method' = 'tap') AS tab_changes_tap,
    count(*) FILTER (WHERE event_type = 'tab_change' AND metadata->>'method' = 'swipe') AS tab_changes_swipe,
    count(DISTINCT session_id) AS sessions
FROM interaction_events
WHERE event_type IN ('screen_view', 'tab_change')
GROUP BY 1, 2;

CREATE OR REPLACE VIEW ux_api_health AS
SELECT
    date_trunc('week', occurred_at)::date AS week,
    target AS endpoint,
    count(*) FILTER (WHERE event_type = 'api_error') AS errors,
    count(*) FILTER (WHERE event_type = 'api_error' AND metadata->>'status' = '0') AS network_failures,
    count(*) FILTER (WHERE event_type = 'slow_response') AS slow,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY (metadata->>'ms')::numeric) AS median_ms,
    mode() WITHIN GROUP (ORDER BY metadata->>'status') AS top_status
FROM interaction_events
WHERE event_type IN ('api_error', 'slow_response')
GROUP BY 1, 2;

-- How long each screen takes to show its content, and how often the user gives up
-- first. `screen_ready` with `skeleton = false` painted from cache; a `load_abandon` is
-- a screen left (or the app backgrounded) while its skeleton was still up.
CREATE OR REPLACE VIEW ux_screen_load AS
SELECT
    date_trunc('week', occurred_at)::date AS week,
    target AS screen,
    count(*) FILTER (WHERE event_type = 'screen_ready') AS loads,
    count(*) FILTER (WHERE event_type = 'load_abandon') AS abandoned,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY (metadata->>'ms')::numeric)
        FILTER (WHERE event_type = 'screen_ready' AND metadata->>'skeleton' = 'true') AS median_ms,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY (metadata->>'ms')::numeric)
        FILTER (WHERE event_type = 'screen_ready' AND metadata->>'skeleton' = 'true') AS p95_ms,
    count(*) FILTER (WHERE event_type = 'screen_ready' AND metadata->>'skeleton' = 'false') AS from_cache
FROM interaction_events
WHERE event_type IN ('screen_ready', 'load_abandon')
GROUP BY 1, 2;

-- Share of taps whose target is a fallback (`tag` or `tag:text`) rather than a
-- `data-track` name (`screen.element`): the annotation gap still to close. Goal < 10%.
CREATE OR REPLACE VIEW ux_tracking_coverage AS
SELECT
    date_trunc('week', occurred_at)::date AS week,
    count(*) AS taps,
    count(*) FILTER (WHERE target IS NULL OR target LIKE '%:%' OR target NOT LIKE '%.%') AS fallback_taps,
    round(
        count(*) FILTER (WHERE target IS NULL OR target LIKE '%:%' OR target NOT LIKE '%.%')::numeric
        / NULLIF(count(*), 0),
        3
    ) AS fallback_share
FROM interaction_events
WHERE event_type IN ('tap', 'tap_disabled', 'dead_tap')
GROUP BY 1;
"""

_hits: dict[str, deque[float]] = defaultdict(deque)
_hits_lock = threading.Lock()


def ensure_schema() -> None:
    with db.connect() as conn:
        conn.execute(SCHEMA)
        conn.execute(VIEWS)


def allow_batch(user_id: str, now: float | None = None) -> bool:
    """True if this user may post another batch right now (sliding window)."""
    now = time.monotonic() if now is None else now
    with _hits_lock:
        hits = _hits[user_id]
        while hits and now - hits[0] > RATE_LIMIT_WINDOW_SECONDS:
            hits.popleft()
        if len(hits) >= RATE_LIMIT_BATCHES:
            return False
        hits.append(now)
        return True


def _text(value: Any, limit: int = MAX_TEXT) -> str | None:
    return None if value is None else str(value)[:limit]


def _parse_time(value: Any) -> datetime:
    """The client's clock, falling back to the server's if it is missing or garbled."""
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(value / 1000, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            pass
    return datetime.now(timezone.utc)


def clean_event(raw: dict[str, Any]) -> dict[str, Any] | None:
    """One event ready to store, or None if its type is unknown (dropped, not an error)."""
    if raw.get("event_type") not in EVENT_TYPES:
        return None
    metadata = raw.get("metadata")
    if not isinstance(metadata, dict) or len(json.dumps(metadata, default=str)) > MAX_METADATA_BYTES:
        metadata = {}
    return {
        "event_type": raw["event_type"],
        "target": _text(raw.get("target")),
        "path": _text(raw.get("path")),
        "occurred_at": _parse_time(raw.get("occurred_at")),
        "metadata": metadata,
        "viewport": _text(raw.get("viewport"), 20),
    }


def store_batch(
    user_id: str,
    session_id: str,
    events: list[dict[str, Any]],
    *,
    app_version: str | None = None,
    standalone: bool | None = None,
    user_agent: str | None = None,
) -> int:
    """Validate and insert a batch in one transaction. Returns how many were stored."""
    cleaned = [c for c in (clean_event(e) for e in events[:MAX_BATCH]) if c]
    if not cleaned:
        return 0
    session_id = session_id[:64]
    first = min(c["occurred_at"] for c in cleaned)
    last = max(c["occurred_at"] for c in cleaned)
    with db.connect() as conn, conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO interaction_events
               (user_id, session_id, event_type, target, path, occurred_at, metadata, viewport, app_version)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            [
                (
                    user_id,
                    session_id,
                    c["event_type"],
                    c["target"],
                    c["path"],
                    c["occurred_at"],
                    Jsonb(c["metadata"]),
                    c["viewport"],
                    _text(app_version, 40),
                )
                for c in cleaned
            ],
        )
        cur.execute(
            """INSERT INTO interaction_sessions
               (session_id, user_id, started_at, ended_at, standalone, user_agent, event_count)
               VALUES (%s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (session_id) DO UPDATE SET
                 started_at = LEAST(interaction_sessions.started_at, EXCLUDED.started_at),
                 ended_at = GREATEST(interaction_sessions.ended_at, EXCLUDED.ended_at),
                 event_count = interaction_sessions.event_count + EXCLUDED.event_count
               WHERE interaction_sessions.user_id = EXCLUDED.user_id""",
            [session_id, user_id, first, last, standalone, _text(user_agent, 120), len(cleaned)],
        )
    return len(cleaned)


def purge_old(days: int = RAW_RETENTION_DAYS) -> int:
    """Delete raw events older than the retention window. Meant for a periodic job."""
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM interaction_events WHERE occurred_at < now() - make_interval(days => %s)", [days])
        return cur.rowcount
