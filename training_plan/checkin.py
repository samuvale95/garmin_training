"""The 10-second check-in: how the session felt, and how the body is.

The watch measures the heart; it cannot tell a hard session that felt easy from one that
hurt. Two answers a day are the missing input (`BRAINSTORM-miglioramenti-e-gamification.md`
§0.3: at level 1, "è stata facile?" stands in for the zones a beginner does not have yet).

Words, not a 1-10 scale: a beginner cannot place a "6", but can say "dura". `troppo` is
its own answer because "hard as intended" and "harder than I could handle" lead to
different decisions.

What reads it: the day's verdict (`signals`, below), the move warnings (reported pain),
the weekly summary.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date as date_type
from datetime import timedelta
from typing import Literal

from psycopg.rows import dict_row

from . import db

Effort = Literal["facile", "giusta", "dura", "troppo"]
Body = Literal["bene", "stanco", "dolore"]
PainArea = Literal["piede", "caviglia", "polpaccio", "stinco", "ginocchio", "coscia", "anca", "schiena", "altro"]

EFFORTS: tuple[str, ...] = ("facile", "giusta", "dura", "troppo")
BODIES: tuple[str, ...] = ("bene", "stanco", "dolore")
PAIN_AREAS: tuple[str, ...] = ("piede", "caviglia", "polpaccio", "stinco", "ginocchio", "coscia", "anca", "schiena", "altro")

# How each area is named in a sentence ("dolore al ginocchio").
AREA_PHRASES = {
    "piede": "al piede",
    "caviglia": "alla caviglia",
    "polpaccio": "al polpaccio",
    "stinco": "allo stinco",
    "ginocchio": "al ginocchio",
    "coscia": "alla coscia",
    "anca": "all'anca",
    "schiena": "alla schiena",
    "altro": "",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS checkin (
    user_id     TEXT NOT NULL,
    date        DATE NOT NULL,
    effort      TEXT,
    body        TEXT NOT NULL,
    pain_area   TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, date)
);
"""


class InvalidCheckIn(ValueError):
    pass


@dataclass
class CheckIn:
    date: date_type
    body: str
    effort: str | None = None
    pain_area: str | None = None

    def validate(self, today: date_type) -> None:
        if self.date > today:
            raise InvalidCheckIn("Non si può rispondere per un giorno che non è ancora arrivato.")
        if self.effort is not None and self.effort not in EFFORTS:
            raise InvalidCheckIn(f"Sensazione {self.effort!r} non valida.")
        if self.body not in BODIES:
            raise InvalidCheckIn(f"Stato {self.body!r} non valido.")
        if self.body == "dolore":
            if self.pain_area not in PAIN_AREAS:
                raise InvalidCheckIn("Dove fa male?")
        elif self.pain_area is not None:
            raise InvalidCheckIn("La zona si indica solo con il dolore.")

    def pain_phrase(self) -> str:
        area = AREA_PHRASES.get(self.pain_area or "altro", "")
        return f"Dolore {area}".strip()


def ensure_schema() -> None:
    with db.connect() as conn:
        conn.execute(SCHEMA)


def _from_row(row: dict) -> CheckIn:
    return CheckIn(date=row["date"], body=row["body"], effort=row["effort"], pain_area=row["pain_area"])


def get_range(user_id: str, start: date_type, end: date_type) -> list[CheckIn]:
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT date, effort, body, pain_area FROM checkin WHERE user_id = %s AND date BETWEEN %s AND %s ORDER BY date",
            [user_id, start, end],
        )
        return [_from_row(row) for row in cur.fetchall()]


def save(user_id: str, checkin: CheckIn, *, today: date_type) -> CheckIn:
    checkin.validate(today)
    with db.connect() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """INSERT INTO checkin (user_id, date, effort, body, pain_area) VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (user_id, date) DO UPDATE SET
                 effort = EXCLUDED.effort, body = EXCLUDED.body, pain_area = EXCLUDED.pain_area, updated_at = now()
               RETURNING date, effort, body, pain_area""",
            [user_id, checkin.date, checkin.effort, checkin.body, checkin.pain_area],
        )
        return _from_row(cur.fetchone())


def delete(user_id: str, day: date_type) -> None:
    with db.connect() as conn:
        conn.execute("DELETE FROM checkin WHERE user_id = %s AND date = %s", [user_id, day])


# ---- what the day's verdict reads -------------------------------------------------------


def _when(day: date_type, today: date_type) -> str:
    return "oggi" if day == today else "ieri"


def signals(checkins: list[CheckIn], today: date_type) -> list:
    """Readiness signals from today's and yesterday's answers, strongest first.

    Pain is `forte`, as strong as a crashed HRV: it is the one thing the user knows and
    the watch cannot. The detail says which answer produced it, so the user can see the
    verdict came from what they said, and change it if they misclicked.
    """
    from .readiness import SEVERITY_MODERATE, SEVERITY_STRONG, Signal  # local: readiness imports nothing from here

    recent = sorted(
        (c for c in checkins if today - timedelta(days=1) <= c.date <= today), key=lambda c: c.date, reverse=True
    )
    out: list = []
    pain = next((c for c in recent if c.body == "dolore"), None)
    if pain:
        out.append(
            Signal(
                key="checkin_pain",
                label="Dolore segnalato",
                detail=f"{pain.pain_phrase()} segnalato {_when(pain.date, today)}",
                severity=SEVERITY_STRONG,
            )
        )
    too_hard = next((c for c in recent if c.effort == "troppo"), None)
    if too_hard:
        out.append(
            Signal(
                key="checkin_too_hard",
                label="Seduta troppo dura",
                detail=f"hai detto che la seduta di {_when(too_hard.date, today)} è stata troppo dura",
                severity=SEVERITY_MODERATE,
            )
        )
    tired = next((c for c in recent if c.body == "stanco"), None)
    if tired and not pain:
        out.append(
            Signal(
                key="checkin_tired",
                label="Stanchezza",
                detail=f"hai segnalato stanchezza {_when(tired.date, today)}",
                severity=SEVERITY_MODERATE,
            )
        )
    return out
