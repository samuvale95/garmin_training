"""Presentation-independent orchestration: parse/diff/sync/list/delete.

Every function here takes plain arguments and returns plain dataclasses, or
raises. Nothing in this module prints, prompts, or exits the process — that is
`cli.py`'s job. This is the seam a future consumer (CLI today, a web backend
later) is meant to call directly.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date as date_type

from .garmin_sync import (
    ChangedSession,
    CompletedActivity,
    DeleteResult,
    GarminSync,
    PlanDiff,
    ScheduledWorkout,
    SyncResult,
)
from .models import TrainingSession


@dataclass
class PlanPreview:
    """What a plan sync would do, computed without writing anything to Garmin."""

    to_create: list[TrainingSession]
    diff: PlanDiff | None  # None when the diff step was skipped (no_diff=True)
    sync: GarminSync  # authenticated; pass straight through to apply_plan_sync


@dataclass
class DeletionPreview:
    """The workouts a deletion would remove, computed without deleting anything."""

    selected: list[ScheduledWorkout]
    sync: GarminSync  # authenticated; pass straight through to apply_deletion


def verify_login(prompt_mfa: Callable[[], str] | None = None) -> None:
    """Log in on its own, raising on failure. Callers decide how to report success."""
    GarminSync(prompt_mfa=prompt_mfa).login()


def preview_plan_sync(
    sessions: list[TrainingSession],
    no_diff: bool = False,
    check_content: bool = False,
    prompt_mfa: Callable[[], str] | None = None,
    on_authenticated: Callable[[], None] | None = None,
) -> PlanPreview:
    """Log in and compute what a sync of `sessions` would do. Writes nothing.

    With no_diff, every session is treated as needing creation (no calendar read
    beyond login). Otherwise the sessions are diffed against the calendar first.

    on_authenticated, if given, is invoked once login succeeds and before the
    (potentially slow, with check_content) diff call — the same "caller supplies the
    interactive/reporting behavior, this module never calls print/input itself"
    pattern already used for prompt_mfa. This exists so a caller can show a "this may
    take a moment" message at exactly the right point without this function needing
    to print anything itself, and without paying for a second login just to split
    "log in" and "diff" into separately orderable steps.
    """
    sync = GarminSync(prompt_mfa=prompt_mfa)
    sync.login()
    if on_authenticated is not None:
        on_authenticated()

    if no_diff:
        return PlanPreview(to_create=list(sessions), diff=None, sync=sync)

    diff = sync.diff_plan(sessions, check_content=check_content)
    return PlanPreview(to_create=diff.to_create, diff=diff, sync=sync)


def apply_plan_sync(
    preview: PlanPreview, changed: list[ChangedSession] = ()
) -> list[SyncResult]:
    """Perform the writes a preview described: replace `changed`, then create the rest."""
    return preview.sync.replace_all(list(changed)) + preview.sync.sync_all(preview.to_create)


def list_workouts(
    start: date_type, end: date_type, prompt_mfa: Callable[[], str] | None = None
) -> list[ScheduledWorkout]:
    """Log in and list scheduled workouts in a date range."""
    sync = GarminSync(prompt_mfa=prompt_mfa)
    sync.login()
    return sync.list_scheduled_workouts(start, end)


def get_workout_session(
    workout_id: int,
    date: date_type,
    sport: str,
    title: str,
    prompt_mfa: Callable[[], str] | None = None,
) -> TrainingSession:
    """Log in and fetch the full step structure Garmin holds for a scheduled workout."""
    sync = GarminSync(prompt_mfa=prompt_mfa)
    sync.login()
    return sync.get_workout_session(workout_id, date, sport, title)


def list_activities(
    start: date_type, end: date_type, prompt_mfa: Callable[[], str] | None = None
) -> list[CompletedActivity]:
    """Log in and list actually-completed activities in a date range."""
    sync = GarminSync(prompt_mfa=prompt_mfa)
    sync.login()
    return sync.list_activities(start, end)


def preview_deletion(
    start: date_type,
    end: date_type,
    sport: str | None = None,
    title_match: str | None = None,
    prompt_mfa: Callable[[], str] | None = None,
) -> DeletionPreview:
    """Log in and compute which workouts a deletion would select. Deletes nothing."""
    sync = GarminSync(prompt_mfa=prompt_mfa)
    sync.login()
    workouts = sync.list_scheduled_workouts(start, end)
    selected = sync.select_workouts(workouts, sport=sport, title_match=title_match)
    return DeletionPreview(selected=selected, sync=sync)


def apply_deletion(preview: DeletionPreview) -> list[DeleteResult]:
    """Delete exactly the workouts a preview selected."""
    return preview.sync.delete_all(preview.selected)
