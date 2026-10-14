"""Web Push endpoints (see `training_plan/push.py`).

`/push/dispatch` is not behind the JWT gate -- an external cron has no user session --
and takes the same shared secret as `/agents/cron` instead. While the server is awake
the in-process loop (`dispatch_loop`) does the same job every minute; the cron is what
wakes it, since Render's free plan sleeps when idle.
"""

from __future__ import annotations

import asyncio
import hmac
import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from .. import push
from .auth import current_user_id

logger = logging.getLogger(__name__)

router = APIRouter()
cron_router = APIRouter()

DISPATCH_EVERY_SECONDS = 60


class PublicKeyResponse(BaseModel):
    public_key: str


class SubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class SubscribeRequest(BaseModel):
    endpoint: str = Field(min_length=8, max_length=2000)
    keys: SubscriptionKeys


class UnsubscribeRequest(BaseModel):
    endpoint: str


class ReminderIn(BaseModel):
    tag: str = Field(min_length=12, max_length=80)
    send_at: datetime
    title: str = Field(max_length=120)
    body: str = Field(max_length=400)
    url: str | None = Field(default=None, max_length=200)


class RemindersRequest(BaseModel):
    """The full set of pending reminders for `days`: whatever of those days is not in
    `reminders` is dropped."""

    days: list[str] = Field(max_length=3)
    reminders: list[ReminderIn] = Field(default_factory=list, max_length=push.MAX_REMINDERS_PER_REQUEST)


class RemindersResponse(BaseModel):
    pending: int
    subscribed: bool


class SentResponse(BaseModel):
    delivered: int


@router.get("/push/public-key", response_model=PublicKeyResponse)
async def push_public_key(user_id: str = Depends(current_user_id)) -> PublicKeyResponse:
    pem = await run_in_threadpool(push.private_pem)
    return PublicKeyResponse(public_key=push.public_key_b64(pem))


@router.post("/push/subscribe", status_code=204)
async def push_subscribe(payload: SubscribeRequest, request: Request, user_id: str = Depends(current_user_id)) -> None:
    await run_in_threadpool(
        push.save_subscription, user_id, payload.endpoint, payload.keys.p256dh, payload.keys.auth, request.headers.get("user-agent")
    )


@router.post("/push/unsubscribe", status_code=204)
async def push_unsubscribe(payload: UnsubscribeRequest, user_id: str = Depends(current_user_id)) -> None:
    await run_in_threadpool(push.delete_subscription, user_id, payload.endpoint)


@router.put("/push/reminders", response_model=RemindersResponse)
async def push_reminders(payload: RemindersRequest, user_id: str = Depends(current_user_id)) -> RemindersResponse:
    for day in payload.days:
        if len(day) != 10:
            raise HTTPException(status_code=422, detail="days must be YYYY-MM-DD")
    now = datetime.now(timezone.utc)
    reminders = []
    for r in payload.reminders:
        if not any(r.tag.startswith(f"{day}:") for day in payload.days):
            raise HTTPException(status_code=422, detail=f"tag {r.tag} does not belong to the days sent")
        try:
            reminder = push.Reminder(tag=r.tag, send_at=push.utc(r.send_at), title=r.title, body=r.body, url=r.url)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if push.plausible(reminder, now):
            reminders.append(reminder)
    pending = await run_in_threadpool(push.replace_reminders, user_id, payload.days, reminders)
    subscribed = bool(await run_in_threadpool(push.subscriptions_for, user_id))
    return RemindersResponse(pending=pending, subscribed=subscribed)


@router.post("/push/test", response_model=SentResponse)
async def push_test(user_id: str = Depends(current_user_id)) -> SentResponse:
    """A real push, through the push service -- the only honest test: a notification
    shown by the open page proves nothing about the closed app."""
    delivered = await run_in_threadpool(
        push.send_now,
        user_id,
        {
            "title": "Passo · notifiche attive",
            "body": "Così ti arriveranno i promemoria di pasti e acqua, anche ad app chiusa.",
            "tag": "passo-test",
            "url": "/nutrition",
        },
    )
    if delivered == 0:
        raise HTTPException(status_code=409, detail="Nessun dispositivo iscritto alle notifiche")
    return SentResponse(delivered=delivered)


@cron_router.post("/push/dispatch", response_model=SentResponse)
async def push_dispatch(x_cron_secret: str | None = Header(default=None)) -> SentResponse:
    expected = os.getenv("PUSH_CRON_SECRET") or os.getenv("AGENTS_CRON_SECRET")
    if not expected or not x_cron_secret or not hmac.compare_digest(expected, x_cron_secret):
        raise HTTPException(status_code=401, detail="Secret non valido")
    return SentResponse(delivered=await run_in_threadpool(push.dispatch_due))


async def dispatch_loop() -> None:
    """Deliver due reminders every minute for as long as the process is up."""
    while True:
        try:
            await run_in_threadpool(push.dispatch_due)
        except Exception:  # noqa: BLE001 - the loop must outlive a bad minute
            logger.warning("push dispatch failed", exc_info=True)
        await asyncio.sleep(DISPATCH_EVERY_SECONDS)
