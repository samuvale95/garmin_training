"""Many reads in one round trip: `POST /batch`.

A cold home screen asked for ~23 resources, each its own request. On a free host far
from the user every request pays the full latency, and browsers open only a few at a
time. Here the client sends the list once; the server runs each read against the app
itself, in-process and in parallel, and streams every answer back as one NDJSON line
the moment it is ready. A slow Garmin call therefore delays only its own line, not the
whole batch.

Each inner request goes through the full app, middleware included: same auth (the
caller's Authorization header is forwarded), same cache, same errors. Only GETs, only
app paths, no nesting.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

MAX_REQUESTS = 40

router = APIRouter()


class BatchBody(BaseModel):
    paths: list[str]


def _valid(path: str) -> bool:
    return path.startswith("/") and not path.startswith("//") and not path.startswith("/batch")


@router.post("/batch")
async def batch(body: BatchBody, request: Request) -> StreamingResponse:
    if not body.paths or len(body.paths) > MAX_REQUESTS or not all(_valid(p) for p in body.paths):
        raise HTTPException(status_code=422, detail="Percorsi non validi")

    headers = {k: v for k, v in request.headers.items() if k.lower() in ("authorization",)}
    transport = httpx.ASGITransport(app=request.app)

    async def run(client: httpx.AsyncClient, index: int, path: str) -> dict[str, Any]:
        try:
            response = await client.get(path, headers=headers)
            try:
                payload: Any = response.json()
            except ValueError:
                payload = response.text
            return {"i": index, "status": response.status_code, "body": payload}
        except Exception as error:  # noqa: BLE001 - one failing read must not sink the rest
            return {"i": index, "status": 500, "body": {"detail": type(error).__name__}}

    async def stream():
        async with httpx.AsyncClient(transport=transport, base_url="http://batch.internal", timeout=60) as client:
            tasks = [asyncio.create_task(run(client, i, p)) for i, p in enumerate(body.paths)]
            for done in asyncio.as_completed(tasks):
                yield json.dumps(await done, ensure_ascii=False, default=str) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")
