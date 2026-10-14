from datetime import datetime, timedelta, timezone

import pytest

from training_plan import push

NOW = datetime(2026, 10, 14, 10, 0, tzinfo=timezone.utc)


def test_the_public_key_is_the_uncompressed_point_the_browser_expects():
    pem = push.generate_private_pem()
    key = push.public_key_b64(pem)
    raw = __import__("base64").urlsafe_b64decode(key + "=" * (-len(key) % 4))
    assert len(raw) == 65 and raw[0] == 4
    assert "=" not in key


def test_a_generated_key_signs_a_real_webpush_request(monkeypatch):
    """End to end through pywebpush, with the network call replaced: the VAPID header
    and the encrypted body are built from our key and the browser's keys."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    import base64, os

    pem = push.generate_private_pem()
    monkeypatch.setattr(push, "private_pem", lambda: pem)
    # A browser-side key pair, as a real subscription would carry.
    browser = ec.generate_private_key(ec.SECP256R1())
    p256dh = base64.urlsafe_b64encode(
        browser.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    ).rstrip(b"=").decode()
    auth = base64.urlsafe_b64encode(os.urandom(16)).rstrip(b"=").decode()

    sent = {}

    class FakeResponse:
        status_code = 201
        text = ""
        headers: dict = {}

    def fake_post(url, data=None, headers=None, timeout=None, **_):
        sent.update(url=url, headers=headers, data=data)
        return FakeResponse()

    import requests

    monkeypatch.setattr(requests, "post", fake_post)
    monkeypatch.setattr(requests.Session, "post", lambda self, *a, **k: fake_post(*a, **k))
    sub = push.Subscription(endpoint="https://web.push.apple.com/abc", user_id="u", p256dh=p256dh, auth=auth)
    push.webpush_sender(sub, {"title": "Pranzo", "body": "Pasta 105 g"})
    assert sent["url"] == sub.endpoint
    assert sent["headers"]["Urgency"] == "high"
    assert "vapid" in sent["headers"]["authorization"].lower()
    assert push.public_key_b64(pem) in sent["headers"]["authorization"]


def test_delivery_reports_gone_devices_and_survives_broken_ones():
    subs = [push.Subscription(f"https://push/{i}", "u", "k", "a") for i in range(3)]

    def sender(sub, data):
        if sub.endpoint.endswith("0"):
            raise push.Gone()
        if sub.endpoint.endswith("1"):
            raise RuntimeError("timeout")

    delivered, gone = push.deliver(subs, {"title": "x"}, sender)
    assert delivered == 1
    assert gone == ["https://push/0"]


def test_only_plausible_times_are_accepted():
    r = lambda dt: push.Reminder("2026-10-14:x", dt, "t", "b")
    assert push.plausible(r(NOW + timedelta(hours=3)), NOW)
    assert not push.plausible(r(NOW - timedelta(minutes=5)), NOW)
    assert not push.plausible(r(NOW + timedelta(days=3)), NOW)


def test_send_at_must_carry_a_timezone():
    with pytest.raises(ValueError):
        push.utc(datetime(2026, 10, 14, 12, 0))
    assert push.utc(datetime(2026, 10, 14, 12, 0, tzinfo=timezone(timedelta(hours=2)))).hour == 10


def test_the_payload_opens_the_reminders_screen():
    p = push.payload(push.Reminder("2026-10-14:pranzo", NOW, "Pranzo", "Pasta"))
    assert p == {"title": "Pranzo", "body": "Pasta", "tag": "2026-10-14:pranzo", "url": "/today"}


def test_dispatch_skips_stale_reminders(monkeypatch):
    claimed = [
        ("u", push.Reminder("2026-10-14:a", NOW - timedelta(minutes=2), "A", "a")),
        ("u", push.Reminder("2026-10-14:b", NOW - timedelta(hours=2), "B", "b")),
    ]

    # _claim_due filters stale rows itself; feed it raw rows through a fake connection.
    class Cur:
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def execute(self, *a): pass
        def fetchall(self):
            return [dict(user_id=u, tag=r.tag, send_at=r.send_at, title=r.title, body=r.body, url=None) for u, r in claimed]

    class Conn:
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def cursor(self, **_): return Cur()
        def execute(self, *a): pass

    monkeypatch.setattr(push.db, "connect", lambda: Conn())
    monkeypatch.setattr(push, "subscriptions_for", lambda user_id: [push.Subscription("https://push/x", user_id, "k", "a")])
    titles = []
    sent = push.dispatch_due(NOW, sender=lambda sub, data: titles.append(data["title"]))
    assert sent == 1
    assert titles == ["A"]
