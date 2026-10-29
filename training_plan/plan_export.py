"""Export the training plan enriched with actual execution metrics, athlete status, and loads.

Round-trip compatible: the exported YAML can be fed to an external LLM or edited by hand
and re-imported directly via `POST /plan/import`. The parser (`parser.py`) preserves the
planned sessions and goal while ignoring read-only context blocks.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any

import yaml

from . import db, history, intensity, levels, plan_limits, plan_rules, plan_store, prescription
from .models import session_distance_km, session_duration_minutes
from .parser import serialize_plan


def _format_pace(sec_per_km: float | None) -> str | None:
    if not sec_per_km or sec_per_km <= 0:
        return None
    sec = int(round(sec_per_km))
    return f"{sec // 60}:{sec % 60:02d}"


def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def build_enriched_plan_dict(user_id: str, plan_id: str | None = None) -> dict[str, Any]:
    today = date.today()
    plan = db.get_plan(user_id, plan_id=plan_id)
    raw_sessions = plan_store.list_sessions(user_id, plan_id=plan_id)

    # 1. Athlete Context (Level, thresholds, recent 4w volume by sport, load status)
    level_days = [
        levels.DayTraining(**row)
        for row in history.daily_training(
            user_id,
            today - timedelta(days=levels.LOOKBACK_DAYS),
            today,
            running_sports=intensity.RUNNING_SPORTS,
            min_minutes=levels.MIN_SESSION_MINUTES,
        )
    ]
    profile = history.load_profile(user_id)
    assessment = levels.assess(
        level_days,
        today=today,
        threshold_available=False,
        reached_level=profile["reached_level"],
        adaptation_mode=profile["adaptation_mode"],
    )
    effective_lvl = assessment.effective_level

    # Threshold state
    threshold_pace = None
    threshold_hr = None
    try:
        from .api.routes_coach import _zones

        z = _zones(user_id)
        if z:
            threshold_hr = getattr(z, "threshold_hr", None)
    except Exception:
        pass

    # Load status (ACWR)
    daily_map = {day.day: day.run_minutes for day in level_days}
    acwr, acute_m, chronic_m = plan_limits.calculate_rolling_acwr(daily_map, today)

    # 4-week totals by sport
    four_weeks_ago = today - timedelta(days=28)
    recent_acts = history.activities_between(user_id, four_weeks_ago, today)
    by_sport: dict[str, dict[str, float]] = defaultdict(lambda: {"sessions": 0, "minutes": 0.0, "km": 0.0})
    for act in recent_acts:
        sp = act.get("sport") or "other"
        by_sport[sp]["sessions"] += 1
        by_sport[sp]["minutes"] += float(act.get("duration_min") or 0.0)
        by_sport[sp]["km"] += float(act.get("distance_km") or 0.0)

    avg_by_sport = {}
    for sp, totals in by_sport.items():
        avg_by_sport[sp] = {
            "sessions_per_week": round(totals["sessions"] / 4.0, 1),
            "minutes_per_week": round(totals["minutes"] / 4.0, 1),
            "km_per_week": round(totals["km"] / 4.0, 2),
        }

    athlete_context = {
        "exported_at": today.isoformat(),
        "effective_level": effective_lvl,
        "threshold_pace": threshold_pace,
        "threshold_hr": threshold_hr,
        "load_status": {
            "acute_minutes": acute_m,
            "chronic_weekly_minutes": chronic_m,
            "acwr": round(acwr, 2) if acwr is not None else None,
        },
        "recent_4w_avg_by_sport": avg_by_sport,
    }

    # 2. Match planned sessions with executed activities
    # Determine range of sessions
    dates = [date.fromisoformat(s["date"]) for s in raw_sessions] if raw_sessions else []
    earliest_date = min(dates) if dates else today - timedelta(days=28)
    start_history = min(earliest_date, today - timedelta(days=28))
    completed_acts = history.activities_between(user_id, start_history, today)

    # Index activities by date
    acts_by_date: dict[date, list[dict]] = defaultdict(list)
    for act in completed_acts:
        day_val = act.get("day")
        if isinstance(day_val, str):
            day_val = date.fromisoformat(day_val)
        if day_val:
            acts_by_date[day_val].append(act)

    matched_act_ids: set[Any] = set()
    enriched_sessions: list[dict[str, Any]] = []

    for s in raw_sessions:
        s_copy = dict(s)
        s_date = date.fromisoformat(s_copy["date"])
        s_sport = s_copy.get("sport") or "running"

        if s_date <= today:
            # Look for matching activity on this day
            candidates = [a for a in acts_by_date[s_date] if a.get("activity_id") not in matched_act_ids]
            # Match sport first
            matched = next((a for a in candidates if a.get("sport") == s_sport), None)
            if not matched and candidates:
                matched = candidates[0]

            if matched:
                matched_act_ids.add(matched.get("activity_id"))
                pace_s = None
                if matched.get("distance_km") and matched.get("duration_min"):
                    if matched["distance_km"] > 0:
                        pace_s = (matched["duration_min"] * 60) / matched["distance_km"]

                s_copy["executed"] = {
                    "status": "completed",
                    "activity_title": matched.get("title"),
                    "actual_duration_min": round(matched.get("duration_min") or 0.0, 1),
                    "actual_distance_km": round(matched.get("distance_km") or 0.0, 2),
                    "actual_avg_pace": _format_pace(pace_s),
                    "actual_avg_hr": round(matched["avg_hr"]) if matched.get("avg_hr") else None,
                    "calories": matched.get("calories"),
                }
            else:
                s_copy["executed"] = {
                    "status": "skipped",
                    "reason": "Nessuna attività registrata per questo giorno",
                }
        enriched_sessions.append(s_copy)

    # 3. Unplanned activities (workouts done outside plan)
    unplanned = []
    for act in completed_acts:
        if act.get("activity_id") not in matched_act_ids:
            day_val = act.get("day")
            if isinstance(day_val, str):
                day_val = date.fromisoformat(day_val)
            if day_val and day_val >= earliest_date:
                unplanned.append({
                    "date": day_val.isoformat(),
                    "sport": act.get("sport"),
                    "title": act.get("title"),
                    "duration_min": round(act.get("duration_min") or 0.0, 1),
                    "distance_km": round(act.get("distance_km") or 0.0, 2),
                })

    # 4. Weekly load summary
    weekly_summary: dict[str, dict[str, Any]] = {}
    weeks_all = sorted({_monday(d) for d in dates}) if dates else [_monday(today)]
    for mon in weeks_all:
        w_key = mon.isoformat()
        w_sessions = [s for s in enriched_sessions if _monday(date.fromisoformat(s["date"])) == mon]
        planned_min = sum(sum(st.get("duration_value", 0) for st in (s.get("steps") or []) if st.get("duration_type") == "time") for s in w_sessions)
        completed_sessions = [s for s in w_sessions if s.get("executed", {}).get("status") == "completed"]
        actual_min = sum(s["executed"]["actual_duration_min"] for s in completed_sessions if "executed" in s)

        weekly_summary[w_key] = {
            "week_start": w_key,
            "planned_sessions": len(w_sessions),
            "completed_sessions": len(completed_sessions),
            "planned_minutes": round(planned_min, 1),
            "actual_minutes": round(actual_min, 1),
        }

    return {
        "athlete_context": athlete_context,
        "weekly_load_summary": list(weekly_summary.values()),
        "unplanned_activities": unplanned,
        "goal": plan.goal if plan and plan.goal else None,
        "sessions": enriched_sessions,
    }


def serialize_enriched_plan_yaml(data: dict[str, Any]) -> str:
    """Serialize the enriched plan to YAML with clean layout and helpful comments."""
    header = (
        "# ====================================================================\n"
        "# PASSO TRAINING PLAN - EXPORT CON STORICO E CARICHI\n"
        "# ====================================================================\n"
        "# Questo file contiene il piano pianificato insieme allo storico reale,\n"
        "# alle metriche di carico (ACWR, volumi) e all'eseguito delle sedute passate.\n"
        "#\n"
        "# PUOI:\n"
        "#  1. Modificare le sedute o gli obiettivi a mano o tramite un LLM esterno.\n"
        "#  2. Ricaricare direttamente questo file in Passo (i blocchi informativi\n"
        "#     'athlete_context', 'weekly_load_summary' ed 'executed' vengono letti\n"
        "#     in modo sicuro o ignorati durante la validazione degli step).\n"
        "# ====================================================================\n\n"
    )

    # Use PyYAML to format the document cleanly
    body = yaml.dump(data, allow_unicode=True, sort_keys=False, default_flow_style=False)
    return header + body
