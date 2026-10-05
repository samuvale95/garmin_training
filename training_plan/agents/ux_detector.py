"""UX Detector: finds where the user gets stuck, from the weekly `ux_*` aggregates.

Today it is the deterministic half only: thresholds over the views pick out anomalies and
the run records them (`output.anomalies`). No proposals yet -- turning an anomaly into
"why it happens and what to change" is the model's job, added once there are real data
to judge it on (step 4 of the agents plan). Until then a run costs nothing.

Thresholds are deliberately conservative: with one or a few users, a pattern seen twice
is noise. A finding needs volume *and* spread over several sessions.
"""

from __future__ import annotations

from typing import Any

from .runtime import AgentContext, AgentSpec, register

MIN_EVENTS = 5
MIN_SESSIONS = 3
MIN_FLOW_ENDS = 5
ABANDON_RATE = 0.4
MIN_VIEWS = 5
SLOW_HESITATION_MS = 8000
MIN_API_PROBLEMS = 5
MAX_FALLBACK_SHARE = 0.10
MIN_LOAD_ABANDONS = 3
SLOW_SCREEN_P95_MS = 8000
MAX_ANOMALIES = 10

# How bad each kind is, for ordering only: a broken endpoint beats a slow decision.
WEIGHT = {"slow_screen": 4, "api": 4, "rage_tap": 3, "tap_disabled": 3, "flow_abandon": 3, "dead_tap": 2, "hesitation": 1, "coverage": 1}


def _num(value: Any) -> float:
    return float(value) if value is not None else 0.0


def find_anomalies(views: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    """Pure function over the view rows, so it is testable without a database."""
    found: list[dict[str, Any]] = []

    for row in views.get("ux_weekly_frustration", []):
        if row["events"] >= MIN_EVENTS and row["sessions"] >= MIN_SESSIONS:
            found.append(
                {
                    "kind": row["event_type"],
                    "key": f"{row['event_type']}:{row['target']}",
                    "week": row["week"],
                    "target": row["target"],
                    "path": row["path"],
                    "events": row["events"],
                    "sessions": row["sessions"],
                    "reason": row.get("top_reason"),
                    "score": WEIGHT[row["event_type"]] * row["events"],
                }
            )

    for row in views.get("ux_flow_funnel", []):
        ends = (row["completes"] or 0) + (row["abandons"] or 0)
        if ends >= MIN_FLOW_ENDS and _num(row["abandon_rate"]) >= ABANDON_RATE:
            found.append(
                {
                    "kind": "flow_abandon",
                    "key": f"flow_abandon:{row['flow']}:{row.get('top_abandon_step')}",
                    "week": row["week"],
                    "target": row["flow"],
                    "abandon_rate": _num(row["abandon_rate"]),
                    "starts": row["starts"],
                    "step": row.get("top_abandon_step"),
                    "score": WEIGHT["flow_abandon"] * row["abandons"],
                }
            )

    for row in views.get("ux_screen_hesitation", []):
        median = row.get("median_ms_to_first_tap")
        if row["views"] >= MIN_VIEWS and median is not None and _num(median) >= SLOW_HESITATION_MS:
            found.append(
                {
                    "kind": "hesitation",
                    "key": f"hesitation:{row['screen']}",
                    "week": row["week"],
                    "target": row["screen"],
                    "views": row["views"],
                    "median_ms": round(_num(median)),
                    "views_without_tap": row["views_without_tap"],
                    "score": WEIGHT["hesitation"] * row["views"],
                }
            )

    for row in views.get("ux_api_health", []):
        problems = (row["errors"] or 0) + (row["slow"] or 0)
        if problems >= MIN_API_PROBLEMS:
            found.append(
                {
                    "kind": "api",
                    "key": f"api:{row['endpoint']}",
                    "week": row["week"],
                    "target": row["endpoint"],
                    "errors": row["errors"],
                    "slow": row["slow"],
                    "median_ms": round(_num(row.get("median_ms"))),
                    "top_status": row.get("top_status"),
                    "score": WEIGHT["api"] * problems,
                }
            )

    for row in views.get("ux_screen_load", []):
        abandoned = row["abandoned"] or 0
        p95 = row.get("p95_ms")
        slow = (row["loads"] or 0) >= MIN_VIEWS and p95 is not None and _num(p95) >= SLOW_SCREEN_P95_MS
        if abandoned >= MIN_LOAD_ABANDONS or slow:
            found.append(
                {
                    "kind": "slow_screen",
                    "key": f"slow_screen:{row['screen']}",
                    "week": row["week"],
                    "target": row["screen"],
                    "loads": row["loads"],
                    "abandoned": abandoned,
                    "median_ms": round(_num(row.get("median_ms"))),
                    "p95_ms": round(_num(p95)),
                    "score": WEIGHT["slow_screen"] * (abandoned + (row["loads"] or 0) * slow),
                }
            )

    for row in views.get("ux_tracking_coverage", []):
        if row["taps"] >= MIN_EVENTS and _num(row["fallback_share"]) > MAX_FALLBACK_SHARE:
            found.append(
                {
                    "kind": "coverage",
                    "key": f"coverage:{row['week']}",
                    "week": row["week"],
                    "fallback_share": _num(row["fallback_share"]),
                    "taps": row["taps"],
                    "score": WEIGHT["coverage"],
                }
            )

    found.sort(key=lambda a: a["score"], reverse=True)
    return found[:MAX_ANOMALIES]


def run(ctx: AgentContext) -> dict:
    views = {
        name: ctx.read_view(name, since_weeks=2)
        for name in (
            "ux_weekly_frustration",
            "ux_flow_funnel",
            "ux_screen_hesitation",
            "ux_api_health",
            "ux_tracking_coverage",
            "ux_screen_load",
        )
    }
    anomalies = find_anomalies(views)
    return {
        "anomalies": anomalies,
        "rows_read": {name: len(rows) for name, rows in views.items()},
    }


SPEC = register(
    AgentSpec(
        name="ux_detector",
        description="Cerca dove l'utente si blocca nei log di interazione",
        schedule="daily",
        run=run,
        max_steps=20,
        max_cost_per_run_usd=0.05,
        max_proposals_per_week=5,
    )
)
