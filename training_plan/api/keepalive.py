"""Keeps the API awake during the day on Render's free plan.

Render puts a free web service to sleep after 15 minutes without inbound traffic, and
the first request after that waits 30-60 seconds for it to wake. Between
`PASSO_KEEPALIVE_HOURS` (default 8-24, the app's local time, Europe/Rome) the process
calls its own public `/health` every 10 minutes; that goes through Render's proxy, so it
counts as traffic and the service stays up. Outside the window it does nothing and the
service sleeps, which keeps the month inside the free 750 hours (16 h a day is about
500 h).

A sleeping service cannot wake itself: the first wake-up of the day comes from outside
(`.github/workflows/keepalive.yml`, just before 8).

Off unless the public URL is known (`RENDER_EXTERNAL_URL`, set by Render, or
`PASSO_KEEPALIVE_URL`), so local runs and tests never ping anything.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from datetime import datetime

import httpx

logger = logging.getLogger(__name__)

INTERVAL_S = 10 * 60
_started = False


def window() -> tuple[int, int]:
    """(start hour, end hour), end exclusive: "8-24" means 08:00 to 23:59."""
    raw = os.getenv("PASSO_KEEPALIVE_HOURS", "8-24")
    try:
        start, end = (int(part) for part in raw.split("-", 1))
    except ValueError:
        return 8, 24
    return max(0, min(start, 24)), max(0, min(end, 24))


def in_window(now: datetime) -> bool:
    start, end = window()
    return start <= now.hour < end


def _loop(url: str) -> None:
    while True:
        if in_window(datetime.now()):
            try:
                httpx.get(url, timeout=30)
            except Exception as error:  # noqa: BLE001 - a missed ping only means a nap
                logger.warning("keepalive ping failed: %s", error)
        time.sleep(INTERVAL_S)


def start() -> bool:
    """Starts the background pinger once per process; False when it is off."""
    global _started
    base = os.getenv("PASSO_KEEPALIVE_URL") or os.getenv("RENDER_EXTERNAL_URL")
    if _started or not base or os.getenv("PASSO_KEEPALIVE_HOURS") == "off":
        return False
    _started = True
    threading.Thread(target=_loop, args=(base.rstrip("/") + "/health",), daemon=True, name="keepalive").start()
    logger.warning("keepalive on: %s, hours %s", base, window())
    return True
