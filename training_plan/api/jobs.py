"""In-process async job store for the Garmin write operation (screen 06).

Each job runs on its own background thread, so the HTTP request that starts it returns
immediately and the job keeps going even if the client disconnects (design.md decision
#2). Jobs from different users run concurrently and independently -- each carries its
own `user_id` and materializes its own Garmin tokenstore (see `_run`), unlike the single
shared session the original local-tool design assumed. State is held in memory only --
lost on process restart, an accepted trade-off carried over from that design (see
design.md's Risks section): a mid-flight job disappearing on a redeploy is judged
tolerable for now, same as before.
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
from .cache import invalidate_calendar
from .user_tokenstore import materialized_garmin_tokenstore

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
    user_id: str
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
        user_id: str,
        to_create: list[TrainingSession],
        changed: list[ChangedSession],
        prompt_mfa: Callable[[], str] | None = None,
    ) -> str:
        job_id = uuid.uuid4().hex
        items = [
            SyncItem(date=c.session.date, sport=c.session.sport, title=c.session.title, kind="replace")
            for c in changed
        ] + [SyncItem(date=s.date, sport=s.sport, title=s.title, kind="create") for s in to_create]

        job = SyncJob(job_id=job_id, user_id=user_id, items=items)
        with self._lock:
            self._jobs[job_id] = job

        thread = threading.Thread(
            target=self._run, args=(user_id, job, changed, to_create, prompt_mfa), daemon=True
        )
        thread.start()
        return job_id

    def _run(
        self,
        user_id: str,
        job: SyncJob,
        changed: list[ChangedSession],
        to_create: list[TrainingSession],
        prompt_mfa: Callable[[], str] | None,
    ) -> None:
        # The whole job -- possibly dozens of sequential Garmin writes -- runs against
        # one materialized tokenstore, persisted back to Postgres once at the end
        # (inside the `with`) rather than once per item, matching `garmin_session.run`'s
        # per-request granularity would mean checking the token out and back in per
        # workout for no benefit here: this thread is the only thing touching it.
        with materialized_garmin_tokenstore(user_id) as tmp_dir:
            try:
                sync = GarminSync(tokenstore=str(tmp_dir), prompt_mfa=prompt_mfa)
                sync.login()
            except GarminRateLimitError as exc:
                self._finish(job, "failed", str(exc), "rate_limited")
                return
            except GarminSyncError as exc:
                sync.disconnect()
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
                invalidate_calendar(user_id)

    def request_cancel(self, user_id: str, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.user_id != user_id:
                return False
            job.cancel_requested = True
            return True

    def get(self, user_id: str, job_id: str) -> SyncJob | None:
        """`None` both for an unknown job and for one that belongs to someone else --
        the two look identical to the caller on purpose, so polling a stale or
        guessed job id can't be used to learn whether it exists."""
        with self._lock:
            job = self._jobs.get(job_id)
            return job if job is not None and job.user_id == user_id else None


job_store = SyncJobStore()
