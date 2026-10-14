"""Web Push: reminders that arrive with the app closed.

The app used to promise "promemoria attivati" and schedule nothing: a notification
could only be shown by the page itself, so it never came once the app was in the
background -- which is exactly when a reminder is for. Now the client sends the day's
reminders here (meal times, water before the session), and the server delivers them
through the browser's push service at their time.

Three tables:

- `push_vapid`: the server's VAPID key pair, generated on first use and kept, so a
  deploy needs no extra secret (the env vars `VAPID_PRIVATE_KEY_PEM` / `VAPID_SUBJECT`
  override it when set). Rotating it invalidates every subscription.
- `push_subscription`: one row per device that said yes.
- `push_reminder`: what to send and when, keyed by (user, tag). Tags start with the
  date they belong to ("2026-10-14:pranzo"), so a day's reminders are replaced as a
  block whenever its plan changes.

Delivery (`dispatch_due`) claims each due reminder with one UPDATE ... RETURNING, so two
processes running it at once (the in-process loop and the GitHub Actions cron) never
send the same reminder twice. A reminder more than `STALE_AFTER` late is dropped rather
than delivered: "pranzo" at four in the afternoon is noise.
"""

from __future__ import annotations

import base64
import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable, Iterable, Sequence

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from psycopg.rows import dict_row

from . import db

logger = logging.getLogger(__name__)

STALE_AFTER = timedelta(minutes=45)
# How long the push service keeps trying a device that is off: past the stale window
# the reminder is pointless anyway.
PUSH_TTL_SECONDS = int(STALE_AFTER.total_seconds())
MAX_REMINDERS_PER_REQUEST = 40

SCHEMA = """
CREATE TABLE IF NOT EXISTS push_vapid (
    id          SMALLINT PRIMARY KEY DEFAULT 1,
    private_pem TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS push_subscription (
    endpoint    TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    p256dh      TEXT NOT NULL,
    auth        TEXT NOT NULL,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_ok_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS push_subscription_user ON push_subscription (user_id);

CREATE TABLE IF NOT EXISTS push_reminder (
    user_id     TEXT NOT NULL,
    tag         TEXT NOT NULL,
    send_at     TIMESTAMPTZ NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    url         TEXT,
    sent_at     TIMESTAMPTZ,
    PRIMARY KEY (user_id, tag)
);
CREATE INDEX IF NOT EXISTS push_reminder_due ON push_reminder (send_at) WHERE sent_at IS NULL;
"""


@dataclass
class Reminder:
    tag: str
    send_at: datetime  # timezone-aware
    title: str
    body: str
    url: str | None = None


@dataclass
class Subscription:
    endpoint: str
    user_id: str
    p256dh: str
    auth: str


def ensure_schema() -> None:
    with db.connect() as conn:
        conn.execute(SCHEMA)


# ---- VAPID ------------------------------------------------------------------------------


def generate_private_pem() -> str:
    key = ec.generate_private_key(ec.SECP256R1())
    return key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()


def public_key_b64(private_pem: str) -> str:
    """The browser's `applicationServerKey`: the uncompressed P-256 point, base64url."""
    key = serialization.load_pem_private_key(private_pem.encode(), password=None)
    raw = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


_cached_pem: str | None = None


def private_pem() -> str:
    """The key pair this server signs with: from the environment if set, otherwise the
    one stored in the database -- created the first time anything asks for it."""
    global _cached_pem
    env = os.getenv("VAPID_PRIVATE_KEY_PEM")
    if env:
        return env.replace("\\n", "\n")
    if _cached_pem:
        return _cached_pem
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT private_pem FROM push_vapid WHERE id = 1")
        row = cur.fetchone()
        if row is None:
            # Two processes starting together may both generate: the second insert is a
            # no-op and both re-read the same winner.
            cur.execute(
                "INSERT INTO push_vapid (id, private_pem) VALUES (1, %s) ON CONFLICT (id) DO NOTHING",
                [generate_private_pem()],
            )
            cur.execute("SELECT private_pem FROM push_vapid WHERE id = 1")
            row = cur.fetchone()
    _cached_pem = row[0]
    return _cached_pem


def vapid_subject() -> str:
    """Who to contact about this sender. Apple rejects a subject that isn't a real
    mailto: or https: URL, so the default is the web app's own origin."""
    subject = os.getenv("VAPID_SUBJECT")
    if subject:
        return subject
    origin = os.getenv("PASSO_WEB_ORIGIN", "").split(",")[0].strip()
    return origin if origin.startswith("https://") else "mailto:passo-app@users.noreply.github.com"


# ---- subscriptions ----------------------------------------------------------------------


def save_subscription(user_id: str, endpoint: str, p256dh: str, auth: str, user_agent: str | None) -> None:
    with db.connect() as conn:
        conn.execute(
            """INSERT INTO push_subscription (endpoint, user_id, p256dh, auth, user_agent)
               VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh,
                   auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent""",
            [endpoint, user_id, p256dh, auth, (user_agent or "")[:300]],
        )


def delete_subscription(user_id: str, endpoint: str) -> None:
    with db.connect() as conn:
        conn.execute("DELETE FROM push_subscription WHERE endpoint = %s AND user_id = %s", [endpoint, user_id])


def subscriptions_for(user_id: str) -> list[Subscription]:
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT endpoint, user_id, p256dh, auth FROM push_subscription WHERE user_id = %s", [user_id])
        return [Subscription(**row) for row in cur.fetchall()]


# ---- reminders --------------------------------------------------------------------------


# A pending reminder this close to its time (or past it, waiting for the next dispatch)
# is left alone by a replace: the client stops listing a reminder a minute before it is
# due, and dropping it then would mean it is never sent.
KEEP_IMMINENT = timedelta(minutes=3)


def replace_reminders(
    user_id: str, days: Sequence[str], reminders: Sequence[Reminder], now: datetime | None = None
) -> int:
    """Make the pending reminders of `days` exactly `reminders`.

    Already-sent ones are kept (so a re-plan never sends "colazione" twice), and so are
    imminent ones (`KEEP_IMMINENT`); other pending ones of those days that are no longer
    in the list are dropped. Returns how many are pending afterwards.
    """
    keep_before = (now or datetime.now(timezone.utc)) + KEEP_IMMINENT
    with db.connect() as conn:
        for day in days:
            conn.execute(
                "DELETE FROM push_reminder WHERE user_id = %s AND sent_at IS NULL AND tag LIKE %s AND send_at > %s",
                [user_id, f"{day}:%", keep_before],
            )
        for r in reminders[:MAX_REMINDERS_PER_REQUEST]:
            conn.execute(
                """INSERT INTO push_reminder (user_id, tag, send_at, title, body, url)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   ON CONFLICT (user_id, tag) DO UPDATE SET send_at = EXCLUDED.send_at, title = EXCLUDED.title,
                       body = EXCLUDED.body, url = EXCLUDED.url
                   WHERE push_reminder.sent_at IS NULL""",
                [user_id, r.tag, r.send_at, r.title, r.body, r.url],
            )
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM push_reminder WHERE user_id = %s AND sent_at IS NULL", [user_id])
            return int(cur.fetchone()[0])


def pending_reminders(user_id: str) -> list[Reminder]:
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT tag, send_at, title, body, url FROM push_reminder WHERE user_id = %s AND sent_at IS NULL ORDER BY send_at",
            [user_id],
        )
        return [Reminder(**row) for row in cur.fetchall()]


def _claim_due(now: datetime) -> list[tuple[str, Reminder]]:
    """Mark every due reminder sent and return it -- in one statement, so a reminder
    belongs to exactly one dispatcher. Stale ones are marked too, and not returned."""
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """UPDATE push_reminder SET sent_at = %s
               WHERE sent_at IS NULL AND send_at <= %s
               RETURNING user_id, tag, send_at, title, body, url""",
            [now, now],
        )
        rows = cur.fetchall()
    return [
        (row["user_id"], Reminder(tag=row["tag"], send_at=row["send_at"], title=row["title"], body=row["body"], url=row["url"]))
        for row in rows
        if now - row["send_at"] <= STALE_AFTER
    ]


# ---- delivery ---------------------------------------------------------------------------


class Gone(Exception):
    """The push service says this subscription no longer exists (404/410)."""


Sender = Callable[[Subscription, dict], None]


def payload(reminder: Reminder) -> dict:
    return {"title": reminder.title, "body": reminder.body, "tag": reminder.tag, "url": reminder.url or "/today"}


def webpush_sender(subscription: Subscription, data: dict) -> None:
    from py_vapid import Vapid02
    from pywebpush import WebPushException, webpush

    vapid = Vapid02.from_pem(private_pem().encode())
    try:
        webpush(
            subscription_info={"endpoint": subscription.endpoint, "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth}},
            data=json.dumps(data, ensure_ascii=False),
            vapid_private_key=vapid,
            # A fresh dict each time: webpush writes the audience of this endpoint into it.
            vapid_claims={"sub": vapid_subject()},
            ttl=PUSH_TTL_SECONDS,
            headers={"Urgency": "high"},
            timeout=10,
        )
    except WebPushException as exc:
        status = getattr(exc.response, "status_code", None)
        if status in (404, 410):
            raise Gone() from exc
        raise


def deliver(user_subs: Iterable[Subscription], data: dict, sender: Sender) -> tuple[int, list[str]]:
    """Send one payload to each subscription. Returns (delivered, gone endpoints)."""
    delivered = 0
    gone: list[str] = []
    for sub in user_subs:
        try:
            sender(sub, data)
            delivered += 1
        except Gone:
            gone.append(sub.endpoint)
        except Exception:  # noqa: BLE001 - one bad device must not stop the others
            logger.warning("push delivery failed", exc_info=True)
    return delivered, gone


def _forget(endpoints: Sequence[str]) -> None:
    if not endpoints:
        return
    with db.connect() as conn:
        conn.execute("DELETE FROM push_subscription WHERE endpoint = ANY(%s)", [list(endpoints)])


def _mark_ok(endpoints: Sequence[str], now: datetime) -> None:
    if not endpoints:
        return
    with db.connect() as conn:
        conn.execute("UPDATE push_subscription SET last_ok_at = %s WHERE endpoint = ANY(%s)", [now, list(endpoints)])


def send_now(user_id: str, data: dict, sender: Sender = webpush_sender) -> int:
    subs = subscriptions_for(user_id)
    delivered, gone = deliver(subs, data, sender)
    _forget(gone)
    _mark_ok([s.endpoint for s in subs if s.endpoint not in gone], datetime.now(timezone.utc))
    return delivered


def dispatch_due(now: datetime | None = None, sender: Sender = webpush_sender) -> int:
    """Send every reminder whose time has come. Returns how many notifications went out."""
    moment = now or datetime.now(timezone.utc)
    claimed = _claim_due(moment)
    if not claimed:
        return 0
    by_user: dict[str, list[Subscription]] = {}
    sent = 0
    for user_id, reminder in claimed:
        subs = by_user.setdefault(user_id, subscriptions_for(user_id))
        delivered, gone = deliver(subs, payload(reminder), sender)
        sent += delivered
        if gone:
            _forget(gone)
            by_user[user_id] = [s for s in subs if s.endpoint not in gone]
    return sent


def utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        raise ValueError("send_at must carry a timezone")
    return dt.astimezone(timezone.utc)


def plausible(reminder: Reminder, now: datetime) -> bool:
    """Only reminders from a minute ago to two days ahead: anything else is a clock bug
    on the device, not a plan."""
    return now - timedelta(minutes=1) <= reminder.send_at <= now + timedelta(days=2)
