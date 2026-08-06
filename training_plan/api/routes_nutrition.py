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

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi import Form
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from .. import db, llm, nutrition
from . import routes_body, schemas

logger = logging.getLogger(__name__)

router = APIRouter()

# Photos are held in memory while the vision model looks at them, then written to disk.
# Phone cameras produce 3-8 MB JPEGs, so the ceiling is generous, but it is a ceiling:
# without one, a request body is bounded only by what the client feels like sending.
MAX_PHOTO_BYTES = 12 * 1024 * 1024


def _resolve_weight(requested: float | None) -> tuple[float | None, str | None]:
    """(weight, source). A weight sent by the client is one the user typed in, and it
    wins: they are standing on the scale, Garmin is remembering a number from 2023."""
    if requested is not None and requested > 0:
        return requested, "manual"
    # Through the module, not a direct import: the name has to stay late-bound so a test
    # (or anything else) can substitute it without also getting a live Garmin session.
    metrics = routes_body.body_metrics_or_empty()
    weight = metrics.get("weight_kg")
    return (weight, metrics.get("source")) if weight else (None, None)


@router.get("/nutrition/config", response_model=schemas.NutritionConfigResponse)
async def nutrition_config() -> schemas.NutritionConfigResponse:
    return schemas.NutritionConfigResponse(**llm.config_state())


@router.post("/nutrition/targets", response_model=schemas.FuelTargetsResponse)
async def nutrition_targets(payload: schemas.FuelTargetsRequest) -> schemas.FuelTargetsResponse:
    day = payload.date or date_type.today()
    weight, source = await run_in_threadpool(_resolve_weight, payload.weight_kg)
    fuelling = nutrition.daily_fuelling(
        day, [s.to_model() for s in payload.sessions], weight_kg=weight, weight_source=source
    )
    return schemas.FuelTargetsResponse.from_model(fuelling)


@router.post("/nutrition/narrative", response_model=schemas.NarrativeResponse)
async def nutrition_narrative(payload: schemas.FuelTargetsRequest) -> schemas.NarrativeResponse:
    """The same targets, phrased by the model -- falling back to the template it would
    have replaced. Never fails: `source` says which one came back."""
    day = payload.date or date_type.today()
    weight, source = await run_in_threadpool(_resolve_weight, payload.weight_kg)
    fuelling = nutrition.daily_fuelling(
        day, [s.to_model() for s in payload.sessions], weight_kg=weight, weight_source=source
    )
    consumed = await run_in_threadpool(db.totals_for_date, day.isoformat())
    facts = nutrition.fuelling_facts(fuelling, consumed if consumed["entries"] else None)

    text = await run_in_threadpool(llm.write_fuelling_narrative, facts)
    if text:
        return schemas.NarrativeResponse(text=text, source="model")
    return schemas.NarrativeResponse(text=fuelling.advice, source="template")


@router.get("/nutrition/day", response_model=schemas.FoodDayResponse)
async def nutrition_day(date: date_type | None = None) -> schemas.FoodDayResponse:
    day = (date or date_type.today()).isoformat()
    entries = await run_in_threadpool(db.entries_for_date, day)
    totals = await run_in_threadpool(db.totals_for_date, day)
    return schemas.FoodDayResponse(
        date=day,
        entries=[schemas.FoodEntryOut.from_model(e) for e in entries],
        totals=schemas.DayTotals(**totals),
    )


@router.get("/nutrition/history", response_model=schemas.FoodHistoryResponse)
async def nutrition_history(days: int = 7, end: date_type | None = None) -> schemas.FoodHistoryResponse:
    last = end or date_type.today()
    first = last - timedelta(days=max(1, min(days, 120)) - 1)
    rows = await run_in_threadpool(db.totals_between, first, last)
    return schemas.FoodHistoryResponse(days=[schemas.DayTotalsOut(**row) for row in rows])


@router.post("/nutrition/photo", response_model=schemas.FoodEntryOut)
async def nutrition_photo(
    image: UploadFile = File(...),
    date: date_type | None = Form(None),
) -> schemas.FoodEntryOut:
    """Estimate one plate and store it.

    The entry is written **even when the model can't read it**: the photo is the record,
    and a user who took it should not have to take it again because a third-party API
    was down. The row simply arrives with null macros and no confidence, which is the
    same state as a manual entry waiting to be filled in.
    """
    payload = await image.read()
    if not payload:
        raise HTTPException(status_code=422, detail="Empty image")
    if len(payload) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Image too large")

    day = (date or date_type.today()).isoformat()
    suffix = ".png" if (image.content_type or "").endswith("png") else ".jpg"
    path = await run_in_threadpool(db.save_photo, payload, suffix)
    estimate = await run_in_threadpool(
        llm.estimate_macros_from_photo, payload, image.content_type or "image/jpeg"
    )

    entry = await run_in_threadpool(
        lambda: db.add_entry(
            date=day,
            source="photo",
            description=estimate.description if estimate else None,
            kcal=estimate.kcal if estimate else None,
            carb_g=estimate.carb_g if estimate else None,
            protein_g=estimate.protein_g if estimate else None,
            fat_g=estimate.fat_g if estimate else None,
            confidence=estimate.confidence if estimate else None,
            image_path=path,
        )
    )
    return schemas.FoodEntryOut.from_model(entry)


@router.post("/nutrition/entry", response_model=schemas.FoodEntryOut)
async def nutrition_add_entry(payload: schemas.ManualEntryRequest) -> schemas.FoodEntryOut:
    entry = await run_in_threadpool(
        lambda: db.add_entry(
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
    entry_id: int, payload: schemas.EntryPatchRequest
) -> schemas.FoodEntryOut:
    fields = payload.model_dump(exclude_unset=True)
    entry = await run_in_threadpool(lambda: db.update_entry(entry_id, **fields))
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    return schemas.FoodEntryOut.from_model(entry)


@router.delete("/nutrition/entry/{entry_id}", response_model=schemas.DeleteEntryResponse)
async def nutrition_delete_entry(entry_id: int) -> schemas.DeleteEntryResponse:
    deleted = await run_in_threadpool(db.delete_entry, entry_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Entry not found")
    return schemas.DeleteEntryResponse(deleted=True)


@router.get("/nutrition/entry/{entry_id}/photo")
async def nutrition_entry_photo(entry_id: int) -> FileResponse:
    """Serve the stored photo by entry id.

    By id, never by path: the filename is a uuid on the server's disk and the browser
    has no business knowing it, let alone being able to ask for a neighbouring one.
    """
    entry = await run_in_threadpool(db.get_entry, entry_id)
    if entry is None or not entry.image_path:
        raise HTTPException(status_code=404, detail="No photo for this entry")
    return FileResponse(entry.image_path)
