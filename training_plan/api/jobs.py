"""In-process async job store for the Garmin write operation (screen 06).

Runs one session at a time, on a background thread, so the HTTP request that starts
the job returns immediately and the job keeps going even if the client disconnects
(design.md decision #2). State is held in memory only -- lost on process restart,
an accepted trade-off for a local single-user tool (see design.md's Risks section).
"""

from __future__ import annotations

import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date as date_type

from ..garmin_sync import ChangedSession, GarminRateLimitError, GarminSync, GarminSyncError
from ..models import TrainingSession
from . import garmin_session
from .cache import invalidate_calendar

# Finished jobs are kept only long enough for the client to read their final state
# (the sync-result screen polls until `status != "running"`, then stops). Without this
# the store grew for the life of the process, holding on to every session ever synced.
FINISHED_JOB_RETENTION_SECONDS = 60 * 60


@dataclass
class SyncItem:
    date: date_type
    sport: str
    title: str
    kind: str  # "create" | "replace"
    status: str = "pending"  # pending | ok | failed
    error: str | None = None


@dataclass
class SyncJob:
    job_id: str
    items: list[SyncItem]
    status: str = "running"  # running | done | cancelled | failed
    cancel_requested: bool = False
    failure: str | None = None
    failure_category: str | None = None
    finished_at: float | None = None

    @property
    def completed(self) -> int:
        return sum(1 for item in self.items if item.status != "pending")

    @property
    def total(self) -> int:
        return len(self.items)


class SyncJobStore:
    """Holds in-flight and recently-finished sync jobs, keyed by job id."""

    def __init__(self) -> None:
        self._jobs: dict[str, SyncJob] = {}
        self._lock = threading.Lock()

    def _cancel_requested(self, job: SyncJob) -> bool:
        with self._lock:
            return job.cancel_requested

    def _finish(self, job: SyncJob, status: str, failure: str | None = None, category: str | None = None) -> None:
        """Mark a job terminal (under the lock) and drop long-finished ones."""
        with self._lock:
            job.status = status
            job.failure = failure
            job.failure_category = category
            job.finished_at = time.monotonic()
            cutoff = time.monotonic() - FINISHED_JOB_RETENTION_SECONDS
            for job_id in [
                jid
                for jid, existing in self._jobs.items()
                if existing.finished_at is not None and existing.finished_at < cutoff
            ]:
                del self._jobs[job_id]

    def start(
        self,
        to_create: list[TrainingSession],
        changed: list[ChangedSession],
        prompt_mfa: Callable[[], str] | None = None,
    ) -> str:
        job_id = uuid.uuid4().hex
        items = [
            SyncItem(date=c.session.date, sport=c.session.sport, title=c.session.title, kind="replace")
            for c in changed
        ] + [SyncItem(date=s.date, sport=s.sport, title=s.title, kind="create") for s in to_create]

        job = SyncJob(job_id=job_id, items=items)
        with self._lock:
            self._jobs[job_id] = job

        thread = threading.Thread(target=self._run, args=(job, changed, to_create, prompt_mfa), daemon=True)
        thread.start()
        return job_id

    def _run(
        self,
        job: SyncJob,
        changed: list[ChangedSession],
        to_create: list[TrainingSession],
        prompt_mfa: Callable[[], str] | None,
    ) -> None:
        try:
            # The shared session, unless this job carries its own MFA prompt (then it
            # needs a login of its own to route the challenge through).
            if prompt_mfa is not None:
                sync = GarminSync(prompt_mfa=prompt_mfa)
                sync.login()
            else:
                sync = garmin_session.get_sync()
        except GarminRateLimitError as exc:
            self._finish(job, "failed", str(exc), "rate_limited")
            return
        except GarminSyncError as exc:
            garmin_session.reset()
            self._finish(job, "failed", str(exc), "auth_failed")
            return

        try:
            index = 0
            for change in changed:
                if self._cancel_requested(job):
                    self._finish(job, "cancelled")
                    return
                result = sync.replace_session(change)
                with self._lock:
                    job.items[index].status = "ok" if result.success else "failed"
                    job.items[index].error = result.error
                index += 1

            for session in to_create:
                if self._cancel_requested(job):
                    self._finish(job, "cancelled")
                    return
                result = sync.create_and_schedule(session)
                with self._lock:
                    job.items[index].status = "ok" if result.success else "failed"
                    job.items[index].error = result.error
                index += 1

            self._finish(job, "done")
        finally:
            # Whatever happened -- done, cancelled halfway, or an item that failed --
            # the Garmin calendar may have changed, so every cached view of it is stale.
            invalidate_calendar()

    def request_cancel(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return False
            job.cancel_requested = True
            return True

    def get(self, job_id: str) -> SyncJob | None:
        with self._lock:
            return self._jobs.get(job_id)


job_store = SyncJobStore()
