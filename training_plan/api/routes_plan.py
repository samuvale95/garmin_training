"""Plan parse/diff/sync endpoints -- thin adapters over `service.py` and `parser.py`.

No business logic lives here: every handler validates/shapes HTTP input, calls the
existing service-layer function on a thread (it's synchronous, blocking I/O), and
shapes the result back to JSON.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool

from .. import service
from ..parser import parse_training_plan
from . import schemas
from .jobs import job_store

router = APIRouter()


@router.post("/plan/parse", response_model=schemas.ParsePlanResponse)
async def parse_plan(
    file: UploadFile | None = File(None), yaml_text: str | None = Form(None)
) -> schemas.ParsePlanResponse:
    if file is not None:
        content = (await file.read()).decode("utf-8")
    elif yaml_text is not None:
        content = yaml_text
    else:
        raise HTTPException(status_code=400, detail="Provide either 'file' or 'yaml_text'")

    with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    try:
        # TrainingPlanValidationError propagates to the app-level exception handler.
        sessions = await run_in_threadpool(parse_training_plan, tmp_path)
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    return schemas.ParsePlanResponse(sessions=[schemas.TrainingSessionOut.from_model(s) for s in sessions])


@router.post("/plan/diff", response_model=schemas.DiffResponse)
async def diff_plan(payload: schemas.DiffRequest) -> schemas.DiffResponse:
    sessions = [s.to_model() for s in payload.sessions]
    preview = await run_in_threadpool(service.preview_plan_sync, sessions, False, payload.check_content)
    return schemas.DiffResponse.from_model(preview.diff)


@router.post("/plan/sync", response_model=schemas.StartSyncResponse)
async def start_sync(payload: schemas.StartSyncRequest) -> schemas.StartSyncResponse:
    to_create = [s.to_model() for s in payload.to_create]
    changed = [c.to_model() for c in payload.changed]
    job_id = job_store.start(to_create, changed)
    return schemas.StartSyncResponse(job_id=job_id)


@router.get("/plan/sync/{job_id}", response_model=schemas.SyncJobStatus)
async def get_sync_status(job_id: str) -> schemas.SyncJobStatus:
    job = job_store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown job id")
    return schemas.SyncJobStatus(
        job_id=job.job_id,
        total=job.total,
        completed=job.completed,
        status=job.status,
        cancel_requested=job.cancel_requested,
        items=[
            schemas.SyncItemResult(
                date=item.date,
                sport=item.sport,
                title=item.title,
                kind=item.kind,
                status=item.status,
                error=item.error,
            )
            for item in job.items
        ],
        failure=job.failure,
        failure_category=job.failure_category,
    )


@router.post("/plan/sync/{job_id}/cancel")
async def cancel_sync(job_id: str) -> dict:
    if not job_store.request_cancel(job_id):
        raise HTTPException(status_code=404, detail="Unknown job id")
    return {"ok": True}
