"""Interaction-event ingest (see `interactions.py`). Never an error the UI could feel."""

from __future__ import annotations

import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.concurrency import run_in_threadpool

from .. import interactions
from . import schemas
from .auth import current_user_id

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/events/batch", status_code=204)
async def post_events(payload: schemas.EventBatchIn, user_id: str = Depends(current_user_id)) -> Response:
    # Server-side kill switch: the client sees this header and stops tracking, no rebuild.
    if os.getenv("PASSO_EVENTS_ENABLED", "1") == "0":
        return Response(status_code=204, headers={"x-tracking-disabled": "1"})
    if len(payload.events) > interactions.MAX_BATCH:
        raise HTTPException(status_code=422, detail="Troppi eventi in un solo invio")
    if not interactions.allow_batch(user_id):
        raise HTTPException(status_code=429, detail="Troppi invii")
    try:
        await run_in_threadpool(
            lambda: interactions.store_batch(
                user_id,
                payload.session_id,
                payload.events,
                app_version=payload.app_version,
                standalone=payload.standalone,
                user_agent=payload.user_agent,
            )
        )
    except Exception:  # tracking must not break the app: log and move on
        logger.exception("interaction event ingest failed")
    return Response(status_code=204)
