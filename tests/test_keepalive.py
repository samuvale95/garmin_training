from datetime import datetime

from training_plan.api import keepalive


def test_the_default_window_is_eight_to_midnight(monkeypatch):
    monkeypatch.delenv("PASSO_KEEPALIVE_HOURS", raising=False)
    assert not keepalive.in_window(datetime(2026, 11, 2, 7, 59))
    assert keepalive.in_window(datetime(2026, 11, 2, 8, 0))
    assert keepalive.in_window(datetime(2026, 11, 2, 23, 59))
    assert not keepalive.in_window(datetime(2026, 11, 3, 0, 5))


def test_it_never_starts_without_a_public_url(monkeypatch):
    monkeypatch.delenv("RENDER_EXTERNAL_URL", raising=False)
    monkeypatch.delenv("PASSO_KEEPALIVE_URL", raising=False)
    assert keepalive.start() is False
