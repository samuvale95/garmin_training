"""Fuelling endpoints: targets, the food log, and the photo estimate.

Thin adapters, same discipline as the other route modules -- the arithmetic is in
`nutrition.py`, the storage in `db.py`, the model call in `llm.py`, and nothing here
does any of the three.

Two shapes differ from every other module in this package, both for the same reason:

- **Targets are a POST, not a GET with a date.** The plan file lives on the device, so
  the server has no way to look up what tomorrow's session is; the client sends it, the
  way `/body/conflict` already does.
- **The narrative is its own endpoint.** Folding the model call into `/nutrition/targets`
  would put a 3-second third-party round-trip in front of a screen that is fully
  renderable without it. The screen paints from the deterministic advice and the sentence
  replaces it when (and if) it arrives.
"""

from __future__ import annotations

import logging
from datetime import date as date_type
from datetime import timedelta

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi import Form

from .. import db, llm, nutrition
from . import routes_body, schemas
from .auth import current_user_id
from fastapi.concurrency import run_in_threadpool

logger = logging.getLogger(__name__)

router = APIRouter()

# The full photo is held in memory only, for exactly as long as the vision model call
# takes, and then discarded -- never written to disk. Phone cameras produce 3-8 MB
# JPEGs, so the ceiling is generous, but it is a ceiling: without one, a request body is
# bounded only by what the client feels like sending.
MAX_PHOTO_BYTES = 12 * 1024 * 1024

# The thumbnail is a different animal: the client generates it by downscaling the same
# photo to icon size before upload, so a well-behaved client never gets near this. The
# ceiling exists for the client that lies -- generous for a low-quality JPEG, nowhere
# close to what a full photo would need.
MAX_THUMBNAIL_BYTES = 200 * 1024


def _resolve_weight(user_id: str, requested: float | None) -> tuple[float | None, str | None]:
    """(weight, source). A weight sent by the client is one the user typed in, and it
    wins: they are standing on the scale, Garmin is remembering a number from 2023."""
    if requested is not None and requested > 0:
        return requested, "manual"
    # Through the module, not a direct import: the name has to stay late-bound so a test
    # (or anything else) can substitute it without also getting a live Garmin session.
    metrics = routes_body.body_metrics_or_empty(user_id)
    weight = metrics.get("weight_kg")
    return (weight, metrics.get("source")) if weight else (None, None)


@router.get("/nutrition/config", response_model=schemas.NutritionConfigResponse)
async def nutrition_config() -> schemas.NutritionConfigResponse:
    return schemas.NutritionConfigResponse(**llm.config_state())


@router.post("/nutrition/targets", response_model=schemas.FuelTargetsResponse)
async def nutrition_targets(
    payload: schemas.FuelTargetsRequest, user_id: str = Depends(current_user_id)
) -> schemas.FuelTargetsResponse:
    day = payload.date or date_type.today()
    weight, source = await run_in_threadpool(_resolve_weight, user_id, payload.weight_kg)
    fuelling = nutrition.daily_fuelling(
        day, [s.to_model() for s in payload.sessions], weight_kg=weight, weight_source=source
    )
    return schemas.FuelTargetsResponse.from_model(fuelling)


@router.post("/nutrition/narrative", response_model=schemas.NarrativeResponse)
async def nutrition_narrative(
    payload: schemas.FuelTargetsRequest, user_id: str = Depends(current_user_id)
) -> schemas.NarrativeResponse:
    """The same targets, phrased by the model -- falling back to the template it would
    have replaced. Never fails: `source` says which one came back."""
    day = payload.date or date_type.today()
    weight, source = await run_in_threadpool(_resolve_weight, user_id, payload.weight_kg)
    fuelling = nutrition.daily_fuelling(
        day, [s.to_model() for s in payload.sessions], weight_kg=weight, weight_source=source
    )
    consumed = await run_in_threadpool(db.totals_for_date, user_id, day.isoformat())
    facts = nutrition.fuelling_facts(fuelling, consumed if consumed["entries"] else None)

    text = await run_in_threadpool(llm.write_fuelling_narrative, facts)
    if text:
        return schemas.NarrativeResponse(text=text, source="model")
    return schemas.NarrativeResponse(text=fuelling.advice, source="template")


@router.get("/nutrition/day", response_model=schemas.FoodDayResponse)
async def nutrition_day(
    date: date_type | None = None, user_id: str = Depends(current_user_id)
) -> schemas.FoodDayResponse:
    day = (date or date_type.today()).isoformat()
    entries = await run_in_threadpool(db.entries_for_date, user_id, day)
    totals = await run_in_threadpool(db.totals_for_date, user_id, day)
    return schemas.FoodDayResponse(
        date=day,
        entries=[schemas.FoodEntryOut.from_model(e) for e in entries],
        totals=schemas.DayTotals(**totals),
    )


@router.get("/nutrition/history", response_model=schemas.FoodHistoryResponse)
async def nutrition_history(
    days: int = 7, end: date_type | None = None, user_id: str = Depends(current_user_id)
) -> schemas.FoodHistoryResponse:
    last = end or date_type.today()
    first = last - timedelta(days=max(1, min(days, 120)) - 1)
    rows = await run_in_threadpool(db.totals_between, user_id, first, last)
    return schemas.FoodHistoryResponse(days=[schemas.DayTotalsOut(**row) for row in rows])


@router.post("/nutrition/photo", response_model=schemas.FoodEntryOut)
async def nutrition_photo(
    image: UploadFile = File(...),
    thumbnail: UploadFile | None = File(None),
    date: date_type | None = Form(None),
    user_id: str = Depends(current_user_id),
) -> schemas.FoodEntryOut:
    """Estimate one plate from the full photo, but only ever store the thumbnail.

    The entry is written **even when the model can't read it**: a user who took the
    photo should not have to take it again because a third-party API was down. The row
    simply arrives with null macros and no confidence, the same state as a manual entry
    waiting to be filled in. The full-resolution image bytes exist only for the
    duration of this request -- they are read, sent to the vision model, and then go
    out of scope; there is no disk write and nothing to clean up. `thumbnail`, a small
    client-downscaled copy of the same photo meant only for the meal-list icon, is the
    one thing that gets persisted (see `db.py`).
    """
    payload = await image.read()
    if not payload:
        raise HTTPException(status_code=422, detail="Empty image")
    if len(payload) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Image too large")

    thumbnail_bytes: bytes | None = None
    if thumbnail is not None:
        thumbnail_bytes = await thumbnail.read()
        if thumbnail_bytes and len(thumbnail_bytes) > MAX_THUMBNAIL_BYTES:
            raise HTTPException(status_code=413, detail="Thumbnail too large")

    day = (date or date_type.today()).isoformat()
    estimate = await run_in_threadpool(
        llm.estimate_macros_from_photo, payload, image.content_type or "image/jpeg"
    )

    entry = await run_in_threadpool(
        lambda: db.add_entry(
            user_id=user_id,
            date=day,
            source="photo",
            description=estimate.description if estimate else None,
            kcal=estimate.kcal if estimate else None,
            carb_g=estimate.carb_g if estimate else None,
            protein_g=estimate.protein_g if estimate else None,
            fat_g=estimate.fat_g if estimate else None,
            confidence=estimate.confidence if estimate else None,
            thumbnail=thumbnail_bytes or None,
        )
    )
    return schemas.FoodEntryOut.from_model(entry)


@router.post("/nutrition/entry", response_model=schemas.FoodEntryOut)
async def nutrition_add_entry(
    payload: schemas.ManualEntryRequest, user_id: str = Depends(current_user_id)
) -> schemas.FoodEntryOut:
    entry = await run_in_threadpool(
        lambda: db.add_entry(
            user_id=user_id,
            date=payload.date.isoformat(),
            source="manual",
            description=payload.description,
            kcal=payload.kcal,
            carb_g=payload.carb_g,
            protein_g=payload.protein_g,
            fat_g=payload.fat_g,
            # Typed in by a human, so it carries the same weight as a corrected estimate
            # -- which is exactly what `corrected` records.
            corrected=True,
        )
    )
    return schemas.FoodEntryOut.from_model(entry)


@router.patch("/nutrition/entry/{entry_id}", response_model=schemas.FoodEntryOut)
async def nutrition_update_entry(
    entry_id: int, payload: schemas.EntryPatchRequest, user_id: str = Depends(current_user_id)
) -> schemas.FoodEntryOut:
    fields = payload.model_dump(exclude_unset=True)
    entry = await run_in_threadpool(lambda: db.update_entry(user_id, entry_id, **fields))
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    return schemas.FoodEntryOut.from_model(entry)


@router.delete("/nutrition/entry/{entry_id}", response_model=schemas.DeleteEntryResponse)
async def nutrition_delete_entry(
    entry_id: int, user_id: str = Depends(current_user_id)
) -> schemas.DeleteEntryResponse:
    deleted = await run_in_threadpool(db.delete_entry, user_id, entry_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Entry not found")
    return schemas.DeleteEntryResponse(deleted=True)
