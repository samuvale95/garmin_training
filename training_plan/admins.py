"""Who may open the admin pages (agents today), by email.

Two sources: `PASSO_ADMIN_USER_IDS` (env, Supabase user ids) are the bootstrap admins --
they cannot be removed from the app, so nobody can lock everyone out. Everyone else is a
row here, added and removed by an existing admin from the admin page. An email can be
added before its owner ever signs in; it takes effect on their first login.
"""

from __future__ import annotations

import os
import re
from typing import Any

from psycopg.rows import dict_row

from . import db

SCHEMA = """
CREATE TABLE IF NOT EXISTS app_admins (
    email     TEXT PRIMARY KEY,
    added_by  TEXT,
    added_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class InvalidEmail(ValueError):
    pass


def ensure_schema() -> None:
    with db.connect() as conn:
        conn.execute(SCHEMA)


def bootstrap_ids() -> set[str]:
    return {item.strip() for item in os.getenv("PASSO_ADMIN_USER_IDS", "").split(",") if item.strip()}


def normalize(email: str) -> str:
    email = email.strip().lower()
    if not EMAIL_RE.match(email) or len(email) > 254:
        raise InvalidEmail("Email non valida")
    return email


def is_admin(user_id: str, email: str | None) -> bool:
    if user_id in bootstrap_ids():
        return True
    if not email:
        return False
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM app_admins WHERE email = %s", [email.lower()])
        return cur.fetchone() is not None


def list_admins() -> list[dict[str, Any]]:
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT email, added_by, added_at FROM app_admins ORDER BY added_at")
        return cur.fetchall()


def add(email: str, added_by: str | None) -> dict[str, Any]:
    email = normalize(email)
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """INSERT INTO app_admins (email, added_by) VALUES (%s, %s)
               ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
               RETURNING email, added_by, added_at""",
            [email, added_by],
        )
        return cur.fetchone()


def remove(email: str) -> bool:
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM app_admins WHERE email = %s", [email.strip().lower()])
        return cur.rowcount > 0
