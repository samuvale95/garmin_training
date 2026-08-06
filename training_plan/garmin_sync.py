from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import shutil
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date as date_type
from datetime import datetime, timezone
from pathlib import Path

import requests
from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)

from .models import (
    CONDITION_TYPE_PAYLOAD,
    ITERATIONS_CONDITION_PAYLOAD,
    LAP_BUTTON_CONDITION_PAYLOAD,
    MAX_REPETITIONS,
    MIN_REPETITIONS,
    NO_TARGET_PAYLOAD,
    PACE_TARGET_PAYLOAD,
    REPEAT_STEP_TYPE_PAYLOAD,
    SPORT_TYPE_PAYLOAD,
    STEP_TYPE_PAYLOAD,
    PaceTarget,
    RepeatBlock,
    SessionStep,
    Step,
    TrainingSession,
    flatten_steps,
    sport_from_garmin_key,
)

logger = logging.getLogger(__name__)

DEFAULT_TOKENSTORE_PATH = str(Path.home() / ".garmin_training_tokens")
DEFAULT_LOGIN_STATE_PATH = str(Path.home() / ".garmin_training_login_state.json")

# A single login() call fans out into a chain of up to 5 strategies inside
# `garminconnect`, several of which make more than one HTTP request. Failed logins
# are therefore expensive against Garmin's IP-based rate limiter, so a failure here
# puts the CLI into a local cooldown instead of letting the user hammer retries.
RATE_LIMIT_COOLDOWN_SECONDS = 15 * 60
AUTH_FAILURE_COOLDOWN_SECONDS = [0, 60, 5 * 60, 15 * 60]

# Independent read-only calls are issued concurrently, a few at a time. Writes are
# never parallelized (see sync_all/replace_all): they must stay ordered and, on
# cancellation, must have applied a prefix of the plan rather than an arbitrary subset.
MAX_PARALLEL_READS = 6

# `garminconnect` builds a throwaway `requests.Session` for every single API call
# (its `Client._fresh_api_session`), so each call pays a fresh TLS handshake even
# though the session it creates asks for a 20-connection pool that then dies unused.
# Sharing one *adapter* (which owns the urllib3 connection pool, and is thread-safe)
# across those per-call sessions keeps the library's own semantics -- a clean cookie
# jar per call -- while letting connections survive between calls.
_SHARED_HTTPS_ADAPTER = requests.adapters.HTTPAdapter(pool_connections=20, pool_maxsize=20)


def _pooled_api_session() -> requests.Session:
    session = requests.Session()
    session.mount("https://", _SHARED_HTTPS_ADAPTER)
    return session


def _enable_connection_reuse(client: Garmin) -> None:
    """Point the client's per-call session factory at the shared pool above.

    Defensive on purpose: this reaches into a `garminconnect` internal, so if a future
    version renames or drops `_fresh_api_session` we silently keep the (slower, but
    correct) stock behavior instead of breaking every Garmin call.
    """
    inner = getattr(client, "client", None)
    if inner is None or not hasattr(inner, "_fresh_api_session"):
        logger.debug("garminconnect has no _fresh_api_session hook; skipping connection reuse")
        return
    inner._fresh_api_session = _pooled_api_session  # type: ignore[method-assign]


class GarminSyncError(Exception):
    """Raised when authentication or a Garmin Connect API call fails."""


class GarminRateLimitError(GarminSyncError):
    """Raised when Garmin rate-limited the login, or a local cooldown is still active.

    Carries how long the caller should wait, so the API layer can put a real number in
    `ErrorResponse.retry_after_seconds` instead of leaving the field the frontend
    already reads (`apiClient.ts`) permanently null.
    """

    def __init__(self, message: str, retry_after_seconds: int | None = None):
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


@dataclass
class SyncResult:
    session: TrainingSession
    success: bool
    error: str | None = None


@dataclass
class ScheduledWorkout:
    scheduled_workout_id: int
    workout_id: int
    date: date_type
    sport: str
    title: str


@dataclass
class CompletedActivity:
    """An actually-completed Garmin activity (distinct from `ScheduledWorkout`,
    which is a planned/scheduled calendar entry, possibly never done)."""

    activity_id: int
    date: date_type
    sport: str
    title: str
    distance_km: float | None
    duration_min: float | None


@dataclass
class DeleteResult:
    workout: ScheduledWorkout
    success: bool
    error: str | None = None


@dataclass
class ChangedSession:
    """A session present on both sides whose contents no longer match."""

    session: TrainingSession
    workout: ScheduledWorkout
    local_hash: str
    remote_hash: str


@dataclass
class PlanDiff:
    """What a training-plan file adds, already has, and lacks versus the calendar."""

    to_create: list[TrainingSession]
    already_present: list[TrainingSession]
    extra_on_garmin: list[ScheduledWorkout]
    changed: list[ChangedSession] = field(default_factory=list)
    content_checked: bool = False


def session_key(entry_date: date_type, title: str) -> tuple[date_type, str]:
    """Identity of a scheduled session: its date plus its whitespace/case-normalized title."""
    return entry_date, " ".join(str(title).split()).casefold()


def workout_fingerprint(workout: dict) -> str:
    """Content hash of a Garmin workout, ignoring identity and presentation fields.

    Both sides of a comparison are Garmin-shaped payloads (the one we would upload and
    the one Garmin stored), so projecting them through the same reducer makes them
    comparable without depending on the many server-added fields, key ordering, or
    float formatting that differ between the two.

    Repeat groups are expanded, not hashed as groups, so a session hashes the same
    whether its six intervals are written out one by one or wrapped in a `6 ×` block.
    That is deliberate: it keeps every workout uploaded before repeat groups existed
    from showing up as "changed" purely because the same session would now be
    *expressed* differently, while a real edit (five reps instead of six, a different
    recovery) still changes the expansion and so the hash.
    """
    steps = []
    for segment in workout.get("workoutSegments") or []:
        for step in _expand_raw_steps(segment.get("workoutSteps") or []):
            end = step.get("endCondition") or {}
            target = step.get("targetType") or {}
            steps.append(
                [
                    (step.get("stepType") or {}).get("stepTypeKey"),
                    end.get("conditionTypeKey"),
                    _round_or_none(step.get("endConditionValue"), 3),
                    target.get("workoutTargetTypeKey"),
                    _round_or_none(step.get("targetValueOne"), 4),
                    _round_or_none(step.get("targetValueTwo"), 4),
                ]
            )

    projection = {
        "sport": (workout.get("sportType") or {}).get("sportTypeKey"),
        "steps": steps,
    }
    return hashlib.sha256(json.dumps(projection, sort_keys=True).encode()).hexdigest()[:16]


def _expand_raw_steps(raw_steps: list[dict]) -> list[dict]:
    """Raw Garmin step payloads in execution order, with `RepeatGroupDTO`s expanded
    into their repeated children (nested groups included)."""
    expanded: list[dict] = []
    for raw in raw_steps:
        if raw.get("type") == "RepeatGroupDTO":
            children = _expand_raw_steps(raw.get("workoutSteps") or [])
            expanded.extend(children * int(raw.get("numberOfIterations") or 1))
        else:
            expanded.append(raw)
    return expanded


def _round_or_none(value, digits: int):
    return None if value is None else round(float(value), digits)


def _decode_jwt_expiry(token: str) -> datetime | None:
    """Read a JWT's `exp` claim without verifying its signature -- fine here since the
    token is one this process already trusts (it's what `client.login()` wrote to our
    own tokenstore), and this is a read-only, best-effort display value.
    """
    try:
        payload_segment = token.split(".")[1]
        padded = payload_segment + "=" * (-len(payload_segment) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded))
        exp = payload.get("exp")
        return datetime.fromtimestamp(exp, tz=timezone.utc) if exp else None
    except Exception:  # noqa: BLE001 - malformed/unexpected token shape degrades to "unknown"
        return None


def _days_remaining(expires_at: datetime | None) -> int | None:
    if expires_at is None:
        return None
    delta = expires_at - datetime.now(timezone.utc)
    return max(0, int(delta.total_seconds() // 86400))


class GarminSync:
    """Thin wrapper around `garminconnect.Garmin` for training-plan import/export."""

    def __init__(
        self,
        email: str | None = None,
        password: str | None = None,
        tokenstore: str | None = None,
        state_path: str | None = None,
        prompt_mfa: Callable[[], str] | None = None,
    ):
        self._email = email or os.getenv("GARMIN_EMAIL")
        self._password = password or os.getenv("GARMIN_PASSWORD")
        self._tokenstore = tokenstore or os.getenv("GARMIN_TOKENSTORE", DEFAULT_TOKENSTORE_PATH)
        self._state_path = Path(state_path or os.getenv("GARMIN_LOGIN_STATE", DEFAULT_LOGIN_STATE_PATH))
        self._prompt_mfa = prompt_mfa
        self._client: Garmin | None = None

    # ---- login throttling state --------------------------------------------------------

    def _read_state(self) -> dict:
        try:
            return json.loads(self._state_path.read_text())
        except (OSError, ValueError):
            return {}

    def _write_state(self, state: dict) -> None:
        try:
            self._state_path.write_text(json.dumps(state))
        except OSError:
            pass  # A missing cooldown record must never break an otherwise working run.

    def _clear_state(self) -> None:
        self._state_path.unlink(missing_ok=True)

    def _cooldown_remaining(self) -> int:
        """Seconds still to wait before another login may be attempted."""
        state = self._read_state()
        until = state.get("retry_after", 0)
        return max(0, int(until - time.time()))

    def _record_failure(self, rate_limited: bool) -> None:
        state = self._read_state()
        failures = int(state.get("failures", 0)) + 1
        if rate_limited:
            cooldown = RATE_LIMIT_COOLDOWN_SECONDS
        else:
            index = min(failures - 1, len(AUTH_FAILURE_COOLDOWN_SECONDS) - 1)
            cooldown = AUTH_FAILURE_COOLDOWN_SECONDS[index]
        self._write_state(
            {
                "failures": failures,
                "retry_after": time.time() + cooldown,
                "reason": "rate_limited" if rate_limited else "auth_failed",
            }
        )

    def _has_cached_tokens(self) -> bool:
        path = Path(self._tokenstore).expanduser()
        return path.exists() and any(path.iterdir()) if path.is_dir() else path.exists()

    # ---- login -------------------------------------------------------------------------

    def login(self) -> None:
        # Everything below the network call is checked first, so a run that cannot
        # possibly succeed costs Garmin zero login requests.
        has_cached_tokens = self._has_cached_tokens()

        # Credentials are only required to establish a *new* session. A cached one
        # (e.g. from an earlier web-form /garmin/connect call, whose email/password
        # this process never sees again) must resume via tokenstore alone -- callers
        # like GET /garmin/workouts intentionally construct GarminSync() with no
        # credentials and rely on exactly this.
        if not has_cached_tokens and (not self._email or not self._password):
            raise GarminSyncError(
                "Missing Garmin credentials: set GARMIN_EMAIL and GARMIN_PASSWORD "
                "in your environment or in a local .env file."
            )

        # A cached session usually needs no login request at all, so the cooldown only
        # guards the case where we would actually hit Garmin's SSO.
        if not has_cached_tokens:
            remaining = self._cooldown_remaining()
            if remaining:
                reason = self._read_state().get("reason", "auth_failed")
                detail = (
                    "Garmin rate-limited this IP"
                    if reason == "rate_limited"
                    else "the previous login failed"
                )
                raise GarminRateLimitError(
                    f"Login temporarily blocked locally: {detail}. "
                    f"Wait {remaining // 60}m {remaining % 60}s before retrying, "
                    "and double-check your credentials in the meantime. "
                    "Retrying sooner only deepens Garmin's rate limit.",
                    retry_after_seconds=remaining,
                )

        client = Garmin(email=self._email, password=self._password, prompt_mfa=self._prompt_mfa)
        try:
            client.login(tokenstore=self._tokenstore)
        except GarminConnectTooManyRequestsError as exc:
            self._record_failure(rate_limited=True)
            raise GarminRateLimitError(
                f"Garmin rate-limited this IP (HTTP 429): {exc}. "
                f"Wait at least {RATE_LIMIT_COOLDOWN_SECONDS // 60} minutes before retrying. "
                "This is tied to your IP/network, not only your account.",
                retry_after_seconds=RATE_LIMIT_COOLDOWN_SECONDS,
            ) from exc
        except GarminConnectAuthenticationError as exc:
            self._record_failure(rate_limited=False)
            raise GarminSyncError(
                f"Garmin Connect authentication failed: {exc}. "
                "Check GARMIN_EMAIL/GARMIN_PASSWORD, and note that a wrong password "
                "costs several login attempts against Garmin's rate limiter."
            ) from exc
        except GarminConnectConnectionError as exc:
            self._record_failure(rate_limited=False)
            raise GarminSyncError(f"Could not reach Garmin Connect: {exc}") from exc

        self._clear_state()
        _enable_connection_reuse(client)
        self._client = client

    def connection_status(self) -> dict:
        """Report cached-session/cooldown state without making a network call.

        Additive, read-only helper for a status endpoint: lets a caller show whether
        Garmin is connected (or why not, and for how much longer) without attempting,
        and risking, a real login.
        """
        if self._has_cached_tokens():
            return {
                "connected": True,
                "cooldown_active": False,
                "retry_after_seconds": 0,
                "reason": None,
                "session_expires_in_days": _days_remaining(self.session_expires_at()),
            }

        remaining = self._cooldown_remaining()
        if remaining:
            reason = self._read_state().get("reason", "auth_failed")
            return {
                "connected": False,
                "cooldown_active": True,
                "retry_after_seconds": remaining,
                "reason": reason,
                "session_expires_in_days": None,
            }

        return {
            "connected": False,
            "cooldown_active": False,
            "retry_after_seconds": 0,
            "reason": None,
            "session_expires_in_days": None,
        }

    def session_expires_at(self) -> datetime | None:
        """Best-effort expiry of the cached session token (settings screen 15),
        decoded straight from the tokenstore -- no network call, no signature check
        (we already trust this token: it's the one this process itself wrote out).
        `None` when there's no cached token or its `exp` claim can't be read; this is
        informational only and never gates whether a session counts as connected.
        """
        token = self._read_cached_di_token()
        return _decode_jwt_expiry(token) if token else None

    def _tokenstore_file(self) -> Path:
        path = Path(self._tokenstore).expanduser()
        if path.is_dir() or not path.name.endswith(".json"):
            path = path / "garmin_tokens.json"
        return path

    def _read_cached_di_token(self) -> str | None:
        try:
            data = json.loads(self._tokenstore_file().read_text())
        except (OSError, ValueError):
            return None
        return data.get("di_token")

    def _cached_profile_name(self) -> str | None:
        """The name `garminconnect` already read during login, free of any call.

        Its `login()` fetches the social profile itself and keeps the names off it (see
        api/garmin_session.py) -- so even when `user_profile`'s own fetch fails there is
        usually still a name to show, just no photo.
        """
        name = getattr(self._client, "full_name", None) or getattr(self._client, "display_name", None)
        return (name or "").strip() or None

    def user_profile(self) -> dict:
        """Best-effort account name + avatar URL, the fallback behind Strava's own.

        Read straight from Garmin's social-profile endpoint: `garminconnect` caches only
        the names off it (`display_name`/`full_name`) and drops the image URLs, and like
        `device_info` this is a nice-to-have -- an unreachable or reshaped endpoint
        degrades to `None`s so the avatar just falls back instead of the screen failing.
        """
        try:
            profile = self.client.connectapi("/userprofile-service/socialProfile")
        except Exception:  # noqa: BLE001 - profile info is a nice-to-have, never fatal
            logger.warning("socialProfile failed, degrading to the cached name", exc_info=True)
            return {"name": self._cached_profile_name(), "image_url": None}

        if not isinstance(profile, dict):
            return {"name": self._cached_profile_name(), "image_url": None}

        name = (
            profile.get("fullName")
            or profile.get("displayName")
            or profile.get("userName")
            or self._cached_profile_name()
        )
        image_url = (
            profile.get("profileImageUrlLarge")
            or profile.get("profileImageUrlMedium")
            or profile.get("profileImageUrlSmall")
        )
        if not isinstance(image_url, str) or not image_url.startswith("http"):
            image_url = None
        return {"name": (name or "").strip() or None, "image_url": image_url}

    def device_info(self) -> dict:
        """Best-effort primary-device name + last-sync time (settings screen 15).

        Like body_insights.py's wellness extraction, `garminconnect`'s device
        endpoints are not officially documented, so an unknown/renamed field degrades
        to `None` rather than raising.
        """
        try:
            last_used = self.client.get_device_last_used()
        except Exception:  # noqa: BLE001 - device info is a nice-to-have, never fatal
            logger.warning("get_device_last_used failed, degrading to unavailable", exc_info=True)
            return {"device_name": None, "last_synced_at": None}

        if not isinstance(last_used, dict):
            return {"device_name": None, "last_synced_at": None}

        name = (
            last_used.get("productDisplayName")
            or last_used.get("deviceName")
            or last_used.get("lastUsedDeviceName")
        )
        upload_ms = last_used.get("lastUsedDeviceUploadTime") or last_used.get("imageLastSyncTime")
        synced_at = (
            datetime.fromtimestamp(upload_ms / 1000, tz=timezone.utc)
            if isinstance(upload_ms, (int, float))
            else None
        )
        return {"device_name": name, "last_synced_at": synced_at}

    def disconnect(self) -> None:
        """Drop the cached Garmin session so the device goes back to "not connected".

        Garmin has no app-initiated "log out" concept here -- this only forgets the
        locally cached token. The same credentials can always reconnect afterwards.
        """
        path = Path(self._tokenstore).expanduser()
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        else:
            path.unlink(missing_ok=True)
        self._client = None

    @property
    def client(self) -> Garmin:
        if self._client is None:
            raise GarminSyncError("Not logged in - call login() first")
        return self._client

    # ---- workout creation & scheduling -------------------------------------------------

    def build_workout_payload(self, session: TrainingSession) -> dict:
        # Falls back rather than raising on an unknown sport: plan files are validated
        # against SUPPORTED_SPORTS and Garmin-sourced sessions go through
        # `sport_from_garmin_key`, so this should be unreachable -- but `replace_session`
        # deletes the old workout *before* creating the new one, and a KeyError here
        # would mean the workout is gone and nothing took its place.
        sport_payload = SPORT_TYPE_PAYLOAD.get(session.sport, SPORT_TYPE_PAYLOAD["other"])

        if session.steps:
            workout_steps, _ = _build_steps_payload(session.steps, start_order=1)
            estimated_duration_secs = int(
                sum(
                    step.duration_value * 60
                    for step in flatten_steps(session.steps)
                    if step.duration_type == "time"
                )
            )
        else:
            workout_steps = [
                {
                    "type": "ExecutableStepDTO",
                    "stepOrder": 1,
                    "stepType": STEP_TYPE_PAYLOAD["interval"],
                    "endCondition": LAP_BUTTON_CONDITION_PAYLOAD,
                    "targetType": NO_TARGET_PAYLOAD,
                }
            ]
            estimated_duration_secs = 0

        return {
            "workoutName": session.title,
            "description": session.description,
            "sportType": sport_payload,
            "estimatedDurationInSecs": estimated_duration_secs,
            "workoutSegments": [
                {
                    "segmentOrder": 1,
                    "sportType": sport_payload,
                    "workoutSteps": workout_steps,
                }
            ],
        }

    def create_and_schedule(self, session: TrainingSession) -> SyncResult:
        try:
            payload = self.build_workout_payload(session)
            created = self.client.upload_workout(payload)
            workout_id = created["workoutId"]
            self.client.schedule_workout(workout_id, session.date.isoformat())
        except Exception as exc:  # noqa: BLE001 - reported per-entry, not fatal to the run
            return SyncResult(session=session, success=False, error=str(exc))
        return SyncResult(session=session, success=True)

    def sync_all(self, sessions: list[TrainingSession]) -> list[SyncResult]:
        return [self.create_and_schedule(session) for session in sessions]

    def diff_plan(self, sessions: list[TrainingSession], check_content: bool = False) -> PlanDiff:
        """Compare a plan against the calendar over the plan's own date range.

        Sessions are matched on (date, title), so re-importing a file only adds what
        is genuinely missing instead of duplicating everything already scheduled.

        With check_content, each matched session is additionally fetched and content-
        hashed, so edits that keep the same date and title are detected too. That costs
        one extra API call per matched session, hence the opt-in.
        """
        if not sessions:
            return PlanDiff(to_create=[], already_present=[], extra_on_garmin=[])

        start = min(session.date for session in sessions)
        end = max(session.date for session in sessions)
        existing = self.list_scheduled_workouts(start, end)

        by_key = {session_key(w.date, w.title): w for w in existing}
        plan_keys = {session_key(s.date, s.title) for s in sessions}

        to_create, already_present, matched = [], [], []
        for session in sessions:
            match = by_key.get(session_key(session.date, session.title))
            if match is None:
                to_create.append(session)
                continue

            already_present.append(session)
            if check_content:
                matched.append((session, match))

        # The per-session content fetches are independent reads, so they go out
        # concurrently (bounded -- see MAX_PARALLEL_READS): serially, a full week made
        # check_content cost roughly as much as the whole rest of the diff put together.
        changed = []
        if matched:
            with ThreadPoolExecutor(max_workers=MAX_PARALLEL_READS) as pool:
                comparisons = [pool.submit(self._compare_content, s, w) for s, w in matched]
                changed = [result for call in comparisons if (result := call.result()) is not None]

        return PlanDiff(
            to_create=to_create,
            already_present=already_present,
            extra_on_garmin=[w for w in existing if session_key(w.date, w.title) not in plan_keys],
            changed=changed,
            content_checked=check_content,
        )

    def _compare_content(self, session: TrainingSession, workout: ScheduledWorkout) -> ChangedSession | None:
        try:
            remote = self.client.get_workout_by_id(workout.workout_id)
        except Exception as exc:  # noqa: BLE001 - surfaced as a clean CLI error
            raise GarminSyncError(
                f"Could not read the scheduled workout for {workout.date} ({workout.title!r}): {exc}"
            ) from exc

        local_hash = workout_fingerprint(self.build_workout_payload(session))
        remote_hash = workout_fingerprint(remote)
        if local_hash == remote_hash:
            return None
        return ChangedSession(
            session=session, workout=workout, local_hash=local_hash, remote_hash=remote_hash
        )

    def replace_session(self, change: ChangedSession) -> SyncResult:
        """Apply an edited session by removing the scheduled workout and recreating it."""
        delete_result = self.delete_workout(change.workout)
        if not delete_result.success:
            return SyncResult(
                session=change.session,
                success=False,
                error=f"could not remove the outdated workout: {delete_result.error}",
            )
        return self.create_and_schedule(change.session)

    def replace_all(self, changes: list[ChangedSession]) -> list[SyncResult]:
        return [self.replace_session(change) for change in changes]

    # ---- listing & deleting existing workouts ------------------------------------------

    def list_scheduled_workouts(self, start: date_type, end: date_type) -> list[ScheduledWorkout]:
        results: list[ScheduledWorkout] = []
        year, month = start.year, start.month
        while (year, month) <= (end.year, end.month):
            try:
                data = self.client.get_scheduled_workouts(year, month)
            except Exception as exc:  # noqa: BLE001 - surfaced as a clean CLI error
                raise GarminSyncError(
                    f"Could not read the Garmin calendar for {year}-{month:02d}: {exc}"
                ) from exc
            for item in _extract_calendar_items(data):
                scheduled = _parse_calendar_item(item)
                if scheduled and start <= scheduled.date <= end:
                    results.append(scheduled)
            year, month = (year + 1, 1) if month == 12 else (year, month + 1)
        results.sort(key=lambda w: w.date)
        return results

    def get_workout_session(self, workout_id: int, date: date_type, sport: str, title: str) -> TrainingSession:
        """The full step structure Garmin holds for a workout, as a `TrainingSession` --
        lets a live Garmin-calendar workout (no local plan behind it) be shown with the
        same step-by-step detail as an imported plan's session (see `web`'s
        `/workout/[id]` route). `date`/`sport`/`title` come from the caller's own
        `ScheduledWorkout` (the calendar entry), since a workout definition on its own
        carries no calendar date -- only `get_workout_by_id`'s structure is read here.

        The sport is brought back into the file format on the way in: the calendar hands
        out Garmin's own key (strength training is "fitness_equipment"), and this session
        is editable -- saving it goes back through `build_workout_payload`, which is
        keyed by the file-format value.
        """
        try:
            remote = self.client.get_workout_by_id(workout_id)
        except Exception as exc:  # noqa: BLE001 - surfaced as a clean CLI error
            raise GarminSyncError(f"Could not read workout {workout_id}: {exc}") from exc

        steps: list[SessionStep] = []
        for segment in remote.get("workoutSegments") or []:
            steps.extend(_parse_workout_steps(segment.get("workoutSteps") or []))

        return TrainingSession(
            date=date,
            sport=sport_from_garmin_key(sport),
            title=title,
            description=remote.get("description"),
            steps=steps,
        )

    def list_activities(self, start: date_type, end: date_type) -> list[CompletedActivity]:
        """Actually-completed activities in a date range (not the planned calendar --
        see `list_scheduled_workouts` for that). Used to show real done-vs-planned
        progress instead of the planned/scheduled state alone.
        """
        try:
            data = self.client.get_activities_by_date(start.isoformat(), end.isoformat())
        except Exception as exc:  # noqa: BLE001 - surfaced as a clean CLI error
            raise GarminSyncError(f"Could not read Garmin activities for {start}..{end}: {exc}") from exc

        results = [a for item in data if (a := _parse_activity_item(item)) is not None]
        results.sort(key=lambda a: a.date)
        return results

    def select_workouts(
        self,
        workouts: list[ScheduledWorkout],
        sport: str | None = None,
        title_match: str | None = None,
    ) -> list[ScheduledWorkout]:
        selected = workouts
        if sport:
            selected = [w for w in selected if w.sport == sport]
        if title_match:
            needle = title_match.lower()
            selected = [w for w in selected if needle in w.title.lower()]
        return selected

    def delete_workout(self, workout: ScheduledWorkout) -> DeleteResult:
        try:
            self.client.unschedule_workout(workout.scheduled_workout_id)
            self.client.delete_workout(workout.workout_id)
        except Exception as exc:  # noqa: BLE001 - reported per-workout, not fatal to the run
            return DeleteResult(workout=workout, success=False, error=str(exc))
        return DeleteResult(workout=workout, success=True)

    def delete_all(self, workouts: list[ScheduledWorkout]) -> list[DeleteResult]:
        return [self.delete_workout(w) for w in workouts]


def _build_steps_payload(items: list[SessionStep], start_order: int) -> tuple[list[dict], int]:
    """Garmin step payloads for a session's steps, plus the next free `stepOrder`.

    Garmin numbers `stepOrder` continuously across the whole workout, a repeat group
    and its children alike (warmup 1, group 2, its two steps 3 and 4, cooldown 5), so
    the counter is threaded through rather than restarted per level.
    """
    payloads: list[dict] = []
    order = start_order
    for item in items:
        if isinstance(item, RepeatBlock):
            group_order, order = order, order + 1
            children, order = _build_steps_payload(list(item.steps), order)
            for child in children:
                # Marks each child as belonging to the group above it -- what Garmin
                # Connect's own payloads carry, and what makes the app show the steps
                # nested inside the repeat rather than after it.
                child["childStepId"] = 1
            payloads.append(
                {
                    "type": "RepeatGroupDTO",
                    "stepOrder": group_order,
                    "stepType": REPEAT_STEP_TYPE_PAYLOAD,
                    "numberOfIterations": item.reps,
                    "endCondition": ITERATIONS_CONDITION_PAYLOAD,
                    "endConditionValue": float(item.reps),
                    "smartRepeat": False,
                    "workoutSteps": children,
                }
            )
            continue
        payloads.append(_build_step_payload(item, order))
        order += 1
    return payloads, order


def _build_step_payload(step: Step, order: int) -> dict:
    payload = {
        "type": "ExecutableStepDTO",
        "stepOrder": order,
        "stepType": STEP_TYPE_PAYLOAD[step.type],
        "endCondition": CONDITION_TYPE_PAYLOAD[step.duration_type],
        "endConditionValue": (
            step.duration_value * 60 if step.duration_type == "time" else step.duration_value * 1000
        ),
        "targetType": NO_TARGET_PAYLOAD,
    }

    if step.target_pace:
        slower_mps, faster_mps = step.target_pace.as_speeds_mps()
        payload["targetType"] = PACE_TARGET_PAYLOAD
        # Garmin expects the bounds as speeds in m/s on the step itself, slower first.
        payload["targetValueOne"] = round(slower_mps, 7)
        payload["targetValueTwo"] = round(faster_mps, 7)

    return payload


# Reverse of the payload maps above, used to read a workout's step structure back off
# Garmin (get_workout_by_id) instead of only ever writing it -- see
# `GarminSync.get_workout_session`.
_STEP_TYPE_BY_ID = {v["stepTypeId"]: k for k, v in STEP_TYPE_PAYLOAD.items()}
_CONDITION_TYPE_BY_ID = {v["conditionTypeId"]: k for k, v in CONDITION_TYPE_PAYLOAD.items()}
_PACE_TARGET_TYPE_ID = PACE_TARGET_PAYLOAD["workoutTargetTypeId"]


def _parse_pace_target(raw_step: dict) -> PaceTarget | None:
    target_type = raw_step.get("targetType") or {}
    if target_type.get("workoutTargetTypeId") != _PACE_TARGET_TYPE_ID:
        return None
    slower_mps = raw_step.get("targetValueOne")
    faster_mps = raw_step.get("targetValueTwo")
    if not slower_mps or not faster_mps:
        return None
    return PaceTarget(slower_sec_per_km=round(1000 / slower_mps), faster_sec_per_km=round(1000 / faster_mps))


def _parse_workout_step(raw_step: dict) -> Step | None:
    """None for a step this app has no way to represent (e.g. a "press lap button to
    end" step -- conditionTypeId 1 -- or a stepType/target kind outside `models`'s
    supported sets, both possible on a workout authored directly in Garmin Connect
    rather than by this tool). Skipped rather than raising, so one unsupported step
    doesn't blank out an otherwise-readable workout.
    """
    step_type = _STEP_TYPE_BY_ID.get((raw_step.get("stepType") or {}).get("stepTypeId"))
    duration_type = _CONDITION_TYPE_BY_ID.get((raw_step.get("endCondition") or {}).get("conditionTypeId"))
    value = raw_step.get("endConditionValue")
    if step_type is None or duration_type is None or value is None:
        return None
    duration_value = value / 60 if duration_type == "time" else value / 1000
    return Step(
        type=step_type, duration_type=duration_type, duration_value=duration_value,
        target_pace=_parse_pace_target(raw_step),
    )


def _parse_workout_steps(raw_steps: list[dict]) -> list[SessionStep]:
    """Reads Garmin's step tree back into this app's steps and `RepeatBlock`s.

    A `RepeatGroupDTO` (a repeated block, e.g. "5x400m") becomes a `RepeatBlock`, so a
    workout authored in Garmin Connect keeps its "5 ×" shape here instead of arriving
    as five look-alike steps. Nesting is the one thing that doesn't survive: a group
    inside a group is expanded into its parent's steps, since `RepeatBlock` is a
    single level deep by design.

    A workout written out *flat* -- six identical interval/recovery pairs one after the
    other, no group around them, which is what Garmin Connect produces when the loop is
    typed step by step -- describes the same block, so it is read back as one (see
    `_fold_repeated_steps`).
    """
    return _fold_repeated_steps(_parse_raw_steps(raw_steps))


def _parse_raw_steps(raw_steps: list[dict]) -> list[SessionStep]:
    """`_parse_workout_steps` without the flat-repetition folding -- the tree walk on its
    own, so recursing into a group doesn't re-fold children that are about to be
    flattened anyway."""
    items: list[SessionStep] = []
    for raw in raw_steps:
        if raw.get("type") == "RepeatGroupDTO":
            children = flatten_steps(_parse_raw_steps(raw.get("workoutSteps") or []))
            reps = int(raw.get("numberOfIterations") or 1)
            if not children:
                continue
            # A group that runs once is only noise in the UI -- keep its steps inline.
            if reps <= 1:
                items.extend(children)
            else:
                items.append(RepeatBlock(reps=reps, steps=children))
            continue
        step = _parse_workout_step(raw)
        if step is not None:
            items.append(step)
    return items


def _repeated_pattern_at(items: list[SessionStep], start: int) -> tuple[int, int] | None:
    """(pattern length, repetitions) for the run of back-to-back identical steps
    starting at `start`, or None if what starts there doesn't repeat.

    The *shortest* repeating pattern wins, so "1000m, rec, 1000m, rec, ..." is read as
    the pair repeated rather than as one long stretch that happens to occur twice --
    the tightest loop is the one the athlete actually runs.

    Only plain steps are considered: a `RepeatBlock` inside the pattern would mean a
    nested group, which `RepeatBlock` doesn't model.
    """
    remaining = len(items) - start
    for length in range(1, remaining // 2 + 1):
        pattern = items[start : start + length]
        if isinstance(pattern[-1], RepeatBlock):
            return None  # a longer pattern would contain it too
        reps = 1
        while items[start + reps * length : start + (reps + 1) * length] == pattern:
            reps += 1
        if reps >= MIN_REPETITIONS:
            # Past Garmin's cap the run is folded in chunks of 99 rather than left flat;
            # the leftovers come back around on the caller's next pass.
            return length, min(reps, MAX_REPETITIONS)
    return None


def _fold_repeated_steps(items: list[SessionStep]) -> list[SessionStep]:
    """Runs of identical consecutive steps collapsed into the `RepeatBlock` they spell
    out, leaving everything else -- blocks Garmin already grouped, one-off steps, an
    odd trailing interval whose recovery was left off -- exactly as it came in."""
    folded: list[SessionStep] = []
    i = 0
    while i < len(items):
        item = items[i]
        if isinstance(item, RepeatBlock):
            folded.append(item)
            i += 1
            continue
        match = _repeated_pattern_at(items, i)
        if match is None:
            folded.append(item)
            i += 1
            continue
        length, reps = match
        folded.append(RepeatBlock(reps=reps, steps=list(items[i : i + length])))
        i += length * reps
    return folded


def _extract_calendar_items(data: dict) -> list[dict]:
    if not isinstance(data, dict):
        return []
    for key in ("calendarItems", "items", "workouts"):
        items = data.get(key)
        if isinstance(items, list):
            return items
    return []


def _parse_calendar_item(item: dict) -> ScheduledWorkout | None:
    if not isinstance(item, dict):
        return None
    if str(item.get("itemType", "workout")).lower() != "workout":
        return None

    scheduled_id = item.get("id") or item.get("scheduleId") or item.get("itemId")
    workout_id = item.get("workoutId")
    raw_date = item.get("date")
    title = item.get("title") or item.get("workoutName") or ""
    # Garmin returns the sport as a flat "sportTypeKey" on calendar items; the other
    # spellings are kept only as fallbacks in case the response shape varies.
    raw_sport = item.get("sport")
    sport_key = (
        item.get("sportTypeKey")
        or (raw_sport.get("sportName") if isinstance(raw_sport, dict) else raw_sport)
        or item.get("sportType")
    )

    if scheduled_id is None or workout_id is None or raw_date is None:
        return None

    try:
        parsed_date = datetime.strptime(str(raw_date)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None

    return ScheduledWorkout(
        scheduled_workout_id=int(scheduled_id),
        workout_id=int(workout_id),
        date=parsed_date,
        sport=str(sport_key or "other"),
        title=str(title),
    )


def _parse_activity_item(item: dict) -> CompletedActivity | None:
    if not isinstance(item, dict):
        return None

    activity_id = item.get("activityId")
    raw_start = item.get("startTimeLocal")
    if activity_id is None or raw_start is None:
        return None

    try:
        parsed_date = datetime.strptime(str(raw_start)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None

    activity_type = item.get("activityType")
    sport_key = activity_type.get("typeKey") if isinstance(activity_type, dict) else None

    distance_m = item.get("distance")
    duration_s = item.get("duration")

    return CompletedActivity(
        activity_id=int(activity_id),
        date=parsed_date,
        sport=str(sport_key or "other"),
        title=str(item.get("activityName") or ""),
        distance_km=round(distance_m / 1000, 2) if isinstance(distance_m, (int, float)) else None,
        duration_min=round(duration_s / 60, 1) if isinstance(duration_s, (int, float)) else None,
    )
