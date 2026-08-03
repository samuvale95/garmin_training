"""In-process async job store for the Garmin write operation (screen 06).

Runs one session at a time, on a background thread, so the HTTP request that starts
the job returns immediately and the job keeps going even if the client disconnects
(design.md decision #2). State is held in memory only -- lost on process restart,
an accepted trade-off for a local single-user tool (see design.md's Risks section).
"""

from __future__ import annotations

import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date as date_type

from ..garmin_sync import ChangedSession, GarminRateLimitError, GarminSync, GarminSyncError
from ..models import TrainingSession


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

    @property
    def completed(self) -> int:
        return sum(1 for item in self.items if item.status != "pending")

    @property
    def total(self) -> int:
        return len(self.items)


class SyncJobStore:
    """Holds every sync job started this process's lifetime, keyed by job id."""

    def __init__(self) -> None:
        self._jobs: dict[str, SyncJob] = {}
        self._lock = threading.Lock()

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
            sync = GarminSync(prompt_mfa=prompt_mfa)
            sync.login()
        except GarminRateLimitError as exc:
            with self._lock:
                job.status, job.failure, job.failure_category = "failed", str(exc), "rate_limited"
            return
        except GarminSyncError as exc:
            with self._lock:
                job.status, job.failure, job.failure_category = "failed", str(exc), "auth_failed"
            return

        index = 0
        for change in changed:
            with self._lock:
                if job.cancel_requested:
                    job.status = "cancelled"
                    return
            result = sync.replace_session(change)
            with self._lock:
                job.items[index].status = "ok" if result.success else "failed"
                job.items[index].error = result.error
            index += 1

        for session in to_create:
            with self._lock:
                if job.cancel_requested:
                    job.status = "cancelled"
                    return
            result = sync.create_and_schedule(session)
            with self._lock:
                job.items[index].status = "ok" if result.success else "failed"
                job.items[index].error = result.error
            index += 1

        with self._lock:
            job.status = "done"

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
