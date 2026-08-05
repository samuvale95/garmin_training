"""Real Strava OAuth connection, activity matching, and shoe-wear tracking.

Mirrors `garmin_sync.py`'s shape on purpose: a local-file tokenstore, a thin wrapper
class instantiated fresh per request, and no server-side database. Strava tokens
never leave this process -- the frontend only ever sees connection status and
already-shaped activity/shoe data.

Scope requested is read-only (`activity:read_all,profile:read_all`): this module
never writes to Strava. "Retiring" a shoe is a local flag layered on top of Strava's
own (read-only, from this app's perspective) gear list.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from datetime import date as date_type
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

from .models import TrainingSession

DEFAULT_TOKENSTORE_PATH = str(Path.home() / ".garmin_training_strava_tokens.json")

STRAVA_AUTHORIZE_URL = "https://www.strava.com/oauth/authorize"
STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token"
STRAVA_DEAUTHORIZE_URL = "https://www.strava.com/oauth/deauthorize"
STRAVA_API_BASE = "https://www.strava.com/api/v3"
STRAVA_SCOPE = "activity:read_all,profile:read_all"

WEAR_THRESHOLD_KM = 700
RECENT_WINDOW_DAYS = 56  # 8 weeks, used for the "estimated time to exhaustion" figure

# Strava's `type`/`sport_type` values, mapped onto this app's sport vocabulary
# (training_plan.models.SUPPORTED_SPORTS). Unrecognized Strava types fall back to
# "other", which is treated as compatible with any planned sport (design.md decision
# #3 -- matching is best-effort, not a strict enum equality check).
STRAVA_SPORT_TO_OURS = {
    "Run": "running",
    "TrailRun": "running",
    "VirtualRun": "running",
    "Ride": "cycling",
    "VirtualRide": "cycling",
    "MountainBikeRide": "cycling",
    "GravelRide": "cycling",
    "EBikeRide": "cycling",
    "Swim": "swimming",
    "WeightTraining": "strength_training",
    "Workout": "strength_training",
    "Crossfit": "strength_training",
}


class StravaAuthError(Exception):
    """Raised when Strava isn't connected, or a token/refresh/API call fails."""


@dataclass
class StravaActivityMatch:
    activity_id: int
    title: str
    distance_km: float | None
    duration_min: float | None
    avg_pace_sec_per_km: float | None
    average_heartrate: float | None
    max_heartrate: float | None
    elevation_gain_m: float | None
    felt_note: str | None
    gear_id: str | None
    gear_name: str | None


@dataclass
class ShoeWear:
    id: str
    name: str
    distance_km: float
    wear_percent: float
    weeks_remaining: int | None
    retired: bool


def _now() -> int:
    return int(time.time())


class StravaSync:
    """Thin wrapper around Strava's REST API for OAuth, activities, and gear."""

    def __init__(
        self,
        client_id: str | None = None,
        client_secret: str | None = None,
        redirect_uri: str | None = None,
        tokenstore: str | None = None,
    ):
        self._client_id = client_id or os.getenv("STRAVA_CLIENT_ID")
        self._client_secret = client_secret or os.getenv("STRAVA_CLIENT_SECRET")
        self._redirect_uri = redirect_uri or os.getenv("STRAVA_REDIRECT_URI")
        self._tokenstore = Path(tokenstore or os.getenv("STRAVA_TOKENSTORE", DEFAULT_TOKENSTORE_PATH))

    # ---- token storage -------------------------------------------------------------------

    def _read_tokens(self) -> dict:
        try:
            return json.loads(self._tokenstore.read_text())
        except (OSError, ValueError):
            return {}

    def _write_tokens(self, tokens: dict) -> None:
        self._tokenstore.parent.mkdir(parents=True, exist_ok=True)
        self._tokenstore.write_text(json.dumps(tokens))

    def _require_client_credentials(self) -> None:
        if not self._client_id or not self._client_secret:
            raise StravaAuthError(
                "Missing Strava app credentials: set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET "
                "(register a free app at https://www.strava.com/settings/api)."
            )

    # ---- OAuth -----------------------------------------------------------------------------

    def authorize_url(self) -> str:
        self._require_client_credentials()
        if not self._redirect_uri:
            raise StravaAuthError("Missing STRAVA_REDIRECT_URI.")
        params = httpx.QueryParams(
            {
                "client_id": self._client_id,
                "redirect_uri": self._redirect_uri,
                "response_type": "code",
                "approval_prompt": "auto",
                "scope": STRAVA_SCOPE,
            }
        )
        return f"{STRAVA_AUTHORIZE_URL}?{params}"

    def exchange_code(self, code: str) -> None:
        self._require_client_credentials()
        response = httpx.post(
            STRAVA_TOKEN_URL,
            data={
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "code": code,
                "grant_type": "authorization_code",
            },
        )
        if response.status_code != 200:
            raise StravaAuthError(f"Strava authorization failed: {response.text}")
        self._store_token_response(response.json())

    def _store_token_response(self, data: dict) -> None:
        existing = self._read_tokens()
        existing.update(
            {
                "access_token": data["access_token"],
                "refresh_token": data["refresh_token"],
                "expires_at": data["expires_at"],
                "athlete_id": (data.get("athlete") or {}).get("id", existing.get("athlete_id")),
            }
        )
        self._write_tokens(existing)

    def connection_status(self) -> dict:
        """Report whether a usable (or refreshable) token exists -- no network call.

        A Strava refresh token is effectively long-lived (invalidated only by explicit
        revocation), so its mere presence is treated as "connected", the same "trust
        our own cached token" stance `GarminSync.connection_status` takes.
        """
        tokens = self._read_tokens()
        return {"connected": bool(tokens.get("refresh_token"))}

    def disconnect(self) -> None:
        tokens = self._read_tokens()
        access_token = tokens.get("access_token")
        if access_token:
            try:
                httpx.post(STRAVA_DEAUTHORIZE_URL, params={"access_token": access_token}, timeout=5)
            except httpx.HTTPError:
                pass  # best-effort remote revocation; local removal below is what matters
        self._tokenstore.unlink(missing_ok=True)

    def _ensure_fresh_access_token(self) -> str:
        tokens = self._read_tokens()
        if not tokens.get("refresh_token"):
            raise StravaAuthError("Strava is not connected.")

        if tokens.get("expires_at", 0) > _now() + 60:
            return tokens["access_token"]

        self._require_client_credentials()
        response = httpx.post(
            STRAVA_TOKEN_URL,
            data={
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "grant_type": "refresh_token",
                "refresh_token": tokens["refresh_token"],
            },
        )
        if response.status_code != 200:
            self._tokenstore.unlink(missing_ok=True)
            raise StravaAuthError("Strava authorization expired; reconnect from Settings.")
        self._store_token_response(response.json())
        return self._read_tokens()["access_token"]

    def _get(self, path: str, params: dict | None = None) -> httpx.Response:
        access_token = self._ensure_fresh_access_token()
        response = httpx.get(
            f"{STRAVA_API_BASE}{path}",
            params=params,
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        if response.status_code == 401:
            self._tokenstore.unlink(missing_ok=True)
            raise StravaAuthError("Strava authorization expired; reconnect from Settings.")
        if response.status_code != 200:
            raise StravaAuthError(f"Strava API error ({response.status_code}): {response.text}")
        return response

    # ---- activities ------------------------------------------------------------------------

    def list_activities(self, start: date_type, end: date_type) -> list[dict]:
        after = int(datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc).timestamp())
        before = int(
            datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc).timestamp()
        )
        response = self._get("/athlete/activities", params={"after": after, "before": before, "per_page": 200})
        return response.json()

    def get_activity_detail(self, activity_id: int) -> dict:
        return self._get(f"/activities/{activity_id}").json()

    def find_activity_match(self, session: TrainingSession) -> dict:
        """Best-effort match of one Strava activity to a planned session, per design.md
        decision #3: same date, sport-compatible, and (when more than one candidate
        exists) closest in duration to the planned session.
        """
        planned_distance_km, planned_duration_min, planned_pace_sec_per_km = _planned_summary(session)

        candidates = [
            a
            for a in self.list_activities(session.date, session.date)
            if _sport_compatible(a.get("type"), a.get("sport_type"), session.sport)
        ]
        if not candidates:
            return {"matched": False}

        if planned_duration_min:
            candidates.sort(
                key=lambda a: abs((a.get("moving_time", 0) / 60) - planned_duration_min)
            )
        best = candidates[0]

        detail = self.get_activity_detail(best["id"])
        distance_km = round(detail["distance"] / 1000, 2) if detail.get("distance") else None
        duration_min = round(detail["moving_time"] / 60, 1) if detail.get("moving_time") else None
        avg_pace = (
            round((detail["moving_time"] / (detail["distance"] / 1000)), 1)
            if detail.get("distance") and detail.get("moving_time")
            else None
        )
        gear = detail.get("gear") or {}

        plan_note = _plan_note(
            planned_pace_sec_per_km=planned_pace_sec_per_km,
            actual_pace_sec_per_km=avg_pace,
            average_heartrate=detail.get("average_heartrate"),
        )

        return {
            "matched": True,
            "activity_id": detail["id"],
            "title": detail.get("name"),
            "distance_km": distance_km,
            "duration_min": duration_min,
            "avg_pace_sec_per_km": avg_pace,
            "planned_distance_km": planned_distance_km,
            "planned_pace_sec_per_km": planned_pace_sec_per_km,
            "average_heartrate": detail.get("average_heartrate"),
            "max_heartrate": detail.get("max_heartrate"),
            "elevation_gain_m": detail.get("total_elevation_gain"),
            "felt_note": detail.get("description") or None,
            "plan_note": plan_note,
            "gear_id": gear.get("id") or detail.get("gear_id"),
            "gear_name": gear.get("name"),
        }

    # ---- shoe wear ---------------------------------------------------------------------------

    def _retired_gear_ids(self) -> set[str]:
        return set(self._read_tokens().get("retired_gear_ids", []))

    def retire_shoe(self, gear_id: str) -> None:
        tokens = self._read_tokens()
        retired = set(tokens.get("retired_gear_ids", []))
        retired.add(gear_id)
        tokens["retired_gear_ids"] = sorted(retired)
        self._write_tokens(tokens)

    def shoe_wear(self) -> list[dict]:
        athlete = self._get("/athlete").json()
        shoes = athlete.get("shoes") or []
        if not shoes:
            return []

        window_start = date_type.today() - timedelta(days=RECENT_WINDOW_DAYS)
        recent = self.list_activities(window_start, date_type.today())
        recent_km_by_gear: dict[str, float] = {}
        for activity in recent:
            gear_id = activity.get("gear_id")
            if not gear_id or not activity.get("distance"):
                continue
            recent_km_by_gear[gear_id] = recent_km_by_gear.get(gear_id, 0.0) + activity["distance"] / 1000

        retired_ids = self._retired_gear_ids()
        results = []
        for shoe in shoes:
            gear_id = shoe["id"]
            detail = self._get(f"/gear/{gear_id}").json()
            distance_km = round(detail.get("distance", 0) / 1000, 1)
            weekly_km = recent_km_by_gear.get(gear_id, 0.0) / (RECENT_WINDOW_DAYS / 7)
            remaining_km = WEAR_THRESHOLD_KM - distance_km
            weeks_remaining = (
                max(0, round(remaining_km / weekly_km)) if weekly_km > 0 else None
            )
            results.append(
                {
                    "id": gear_id,
                    "name": detail.get("name") or shoe.get("name") or gear_id,
                    "distance_km": distance_km,
                    "wear_percent": round((distance_km / WEAR_THRESHOLD_KM) * 100, 1),
                    "weeks_remaining": weeks_remaining,
                    "retired": bool(detail.get("retired")) or gear_id in retired_ids,
                }
            )
        return results


def _sport_compatible(strava_type: str | None, strava_sport_type: str | None, planned_sport: str) -> bool:
    mapped = STRAVA_SPORT_TO_OURS.get(strava_sport_type or "") or STRAVA_SPORT_TO_OURS.get(strava_type or "")
    return mapped is None or mapped == planned_sport


def _planned_summary(session: TrainingSession) -> tuple[float | None, float | None, float | None]:
    """Planned (distance_km, duration_min, avg_pace_sec_per_km) derived from the
    session's own steps -- there is no separately-stored "planned totals" field, so
    this mirrors what the frontend's `sessionDistanceKm`/step helpers already do.
    """
    distance_km = 0.0
    duration_min = 0.0
    pace_samples: list[float] = []
    for step in session.steps:
        if step.duration_type == "distance":
            distance_km += step.duration_value
        else:
            duration_min += step.duration_value
        if step.target_pace:
            pace_samples.append(
                (step.target_pace.slower_sec_per_km + step.target_pace.faster_sec_per_km) / 2
            )
    avg_pace = sum(pace_samples) / len(pace_samples) if pace_samples else None
    return (
        round(distance_km, 2) if distance_km else None,
        round(duration_min, 1) if duration_min else None,
        round(avg_pace, 1) if avg_pace else None,
    )


def _plan_note(
    planned_pace_sec_per_km: float | None, actual_pace_sec_per_km: float | None, average_heartrate: float | None
) -> str | None:
    """A short, plain-language note on how the plan should react to this activity --
    a simple first-pass heuristic (design.md's open question), same spirit as
    `body_insights.py`'s generated readiness/conflict messages: server-computed text,
    not a client-side template.
    """
    if planned_pace_sec_per_km is None or actual_pace_sec_per_km is None:
        return None

    delta = actual_pace_sec_per_km - planned_pace_sec_per_km  # positive = slower than planned
    slower_and_strained = delta > 5 and average_heartrate is not None and average_heartrate > 150

    if slower_and_strained:
        return "Passo un filo più lento col battito più alto: la prossima ripetuta la ammorbidisco di 5\"/km."
    if delta > 10:
        return "Più lento del previsto. Nessun cambio per ora, ma tienilo d'occhio nella prossima seduta simile."
    if delta < -10:
        return "Più veloce del previsto: il piano resta com'è, ottimo segnale."
    return "In linea con quanto pianificato."
