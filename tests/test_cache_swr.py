"""Stale-while-revalidate: an expired snapshot answers at once and refreshes behind."""

import threading
import time

from training_plan.api import cache as cache_module
from training_plan.api.cache import TTLCache


def test_expired_answer_is_served_at_once_and_refreshed_in_background(monkeypatch):
    monkeypatch.setattr(cache_module, "_save_snapshot", lambda *a: None)
    monkeypatch.setattr(cache_module, "_load_snapshot", lambda *a: None)
    c = TTLCache()
    calls = []
    slow = threading.Event()

    def factory():
        calls.append(1)
        if len(calls) > 1:
            slow.wait(2)
        return len(calls)

    assert c.get_or_call("body:today", "u", None, 0.01, factory) == 1
    time.sleep(0.02)
    started = time.monotonic()
    assert c.get_or_call("body:today", "u", None, 0.01, factory) == 1  # stale, instant
    assert time.monotonic() - started < 0.5
    slow.set()
    for _ in range(50):
        if c._lookup("body:today", "u", None) is not None:
            break
        time.sleep(0.01)
    assert c.get_or_call("body:today", "u", None, 60, factory) == 2


def test_calendar_namespaces_never_serve_stale(monkeypatch):
    c = TTLCache()
    values = iter([1, 2])
    c.get_or_call("garmin:workouts", "u", None, 0.01, lambda: next(values))
    time.sleep(0.02)
    assert c.get_or_call("garmin:workouts", "u", None, 60, lambda: next(values)) == 2


def test_a_sleeping_server_answers_from_the_postgres_snapshot(monkeypatch):
    monkeypatch.setattr(cache_module, "_save_snapshot", lambda *a: None)
    monkeypatch.setattr(cache_module, "_load_snapshot", lambda ns, u, k: ("ieri", 3600.0))
    c = TTLCache()
    gate = threading.Event()
    assert c.get_or_call("body:today", "u", None, 600, lambda: gate.wait(1) or "oggi") == "ieri"
    gate.set()


def test_invalidation_drops_snapshots_too(monkeypatch):
    dropped = []
    monkeypatch.setattr(cache_module, "_save_snapshot", lambda *a: None)
    monkeypatch.setattr(cache_module, "_drop_snapshots", lambda ns, u: dropped.append((set(ns), u)))
    c = TTLCache()
    c.get_or_call("body:today", "u", None, 60, lambda: 1)
    c.invalidate(["body:today", "garmin:workouts"], "u")
    assert dropped == [({"body:today"}, "u")]
