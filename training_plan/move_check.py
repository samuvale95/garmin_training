"""Moving a session is always allowed; this says when the move is genuinely risky.

`BRAINSTORM-miglioramenti-e-gamification.md` §0.5: the user moves what they like, the app
warns only when the resulting sequence is dangerous for their level, and the warning has
to be truthful -- a warning that fires too often stops being read, and then it protects
nobody. Three things keep it truthful here:

- only the rules `plan_rules` marks `warn_on_move` (never the `prudenza` ones), plus
  reported pain before a hard session;
- only what the move *adds*: the sequence is checked with and without it, and a rule the
  week already broke is not the move's fault;
- once the user confirms a sequence, that same sequence does not warn again.

The answer comes with an adapted version of the session for the same day, offered only
when it clears every warning -- "Adatta" must never answer a warning with another.
"""

from __future__ import annotations

import dataclasses
import hashlib
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date as date_type
from datetime import timedelta
from typing import TYPE_CHECKING

from . import plan_rules
from .checkin import CheckIn
from .models import RepeatBlock, Step, TrainingSession, flatten_steps, session_duration_minutes, session_fallback_pace
from .models import PaceTarget, step_duration_minutes
from .plan_generator import done_sessions, session_from_dict
from .plan_rules import RuleContext

if TYPE_CHECKING:
    from .levels import DayTraining

# How far either side of the target day the sequence is read.
SPAN_DAYS = 7
# Days after reported pain in which a hard session warns.
PAIN_DAYS = 2
# A long run adapted for a crowded day stops being a long run.
ADAPTED_LONG_MINUTES = plan_rules.LONG_RUN_MINUTES - 10

_DAY_NAMES = ("lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica")


def _fmt_day(day: date_type) -> str:
    return f"{_DAY_NAMES[day.weekday()]} {day.day}"


@dataclass
class Warning:
    key: str
    message: str
    evidence: str
    dates: list[date_type]
    sessions: list[str]

    @property
    def problem(self) -> str:
        """The rule and the sessions, without the days: moving a session inside a week that
        already had too many hard sessions is the same problem, not a new one."""
        return "|".join([self.key, *sorted(self.sessions)])

    @property
    def fingerprint(self) -> str:
        """The rule, the sessions and the days: what a confirmation silences."""
        raw = "|".join([self.key, *sorted(self.sessions), *sorted(d.isoformat() for d in self.dates)])
        return hashlib.sha1(raw.encode()).hexdigest()[:20]


@dataclass
class MoveCheck:
    warnings: list[Warning] = field(default_factory=list)
    adapted: TrainingSession | None = None


def _sequence(
    stored: Sequence[dict], days: Sequence["DayTraining"], today: date_type, start: date_type, end: date_type
) -> tuple[list[TrainingSession], list[str]]:
    """What the days `[start, end]` hold: the history for the past, the plan from today."""
    sessions: list[TrainingSession] = []
    refs: list[str] = []
    for done in done_sessions(days, start, min(end, today - timedelta(days=1))):
        sessions.append(done)
        refs.append(f"fatto-{done.date.isoformat()}")
    for raw in stored:
        day = date_type.fromisoformat(raw["date"])
        if max(start, today) <= day <= end:
            sessions.append(session_from_dict(raw))
            refs.append(raw["id"])
    return sessions, refs


def _titles(violation: plan_rules.Violation, by_ref: dict[str, TrainingSession]) -> str:
    named = [
        f"{_fmt_day(by_ref[ref].date)}: {by_ref[ref].title}" for ref in violation.sessions if ref in by_ref
    ]
    return f" ({'; '.join(named)})" if named else ""


def _rule_warnings(
    sessions: list[TrainingSession], refs: list[str], moved_id: str, context: RuleContext, start: date_type, end: date_type
) -> list[Warning]:
    by_ref = dict(zip(refs, sessions))
    out = []
    for violation in plan_rules.validate(
        sessions, context, ids=refs, start=start, end=end, only_move_warnings=True
    ):
        out.append(
            Warning(
                key=violation.key,
                message=violation.message + _titles(violation, by_ref),
                evidence=violation.evidence,
                dates=violation.dates,
                sessions=violation.sessions,
            )
        )
    return out


def _pain_warning(session: TrainingSession, moved_id: str, checkins: Sequence[CheckIn]) -> Warning | None:
    if plan_rules.session_kind(session) not in plan_rules.HARD_KINDS:
        return None
    reports = [
        c for c in checkins if c.body == "dolore" and session.date - timedelta(days=PAIN_DAYS) <= c.date <= session.date
    ]
    if not reports:
        return None
    last = max(reports, key=lambda c: c.date)
    return Warning(
        key="pain_before_hard",
        message=(
            f"{last.pain_phrase()} segnalato {_fmt_day(last.date)}, e {_fmt_day(session.date)} diventa una seduta dura "
            f"({session.title}): su un dolore recente il carico va tolto, non aggiunto."
        ),
        evidence=plan_rules.EVIDENCE_CONSENSUS,
        dates=[last.date, session.date],
        sessions=[moved_id],
    )


def adapt(session: TrainingSession) -> TrainingSession:
    """The same day, easier: quality becomes the same minutes easy, a long run is cut
    below the long-run line. Structural, like everything the rules read."""
    kind = plan_rules.session_kind(session)
    steps = flatten_steps(session.steps)
    easy_pace = session_fallback_pace(steps)
    easy_target = (
        PaceTarget(slower_sec_per_km=round(easy_pace) + 10, faster_sec_per_km=round(easy_pace) - 10) if easy_pace else None
    )
    if kind == plan_rules.KIND_LONG:
        minutes = min(ADAPTED_LONG_MINUTES, round(session_duration_minutes(session)))
        return dataclasses.replace(
            session,
            title=f"{session.title} (accorciato)",
            description=f"Versione accorciata a {minutes} minuti facili, per non avere due giorni duri vicini.",
            steps=[Step("interval", "time", minutes, easy_target)],
        )
    if kind == plan_rules.KIND_QUALITY:
        minutes = round(sum(step_duration_minutes(step, easy_pace) for step in steps))
        return dataclasses.replace(
            session,
            title=f"Fondo facile {minutes}' (al posto di {session.title})",
            description="Stessi minuti, tutti a ritmo facile: il lavoro veloce torna quando la sequenza lo permette.",
            steps=[Step("interval", "time", minutes, easy_target)],
        )
    return session


def check_move(
    *,
    session_id: str,
    new_date: date_type,
    stored: Sequence[dict],
    days: Sequence["DayTraining"],
    checkins: Sequence[CheckIn],
    context: RuleContext,
    today: date_type,
    confirmed: set[str] = frozenset(),
    from_date: date_type | None = None,
) -> MoveCheck:
    """The warnings moving `session_id` to `new_date` would add, and an adapted session.

    `from_date` is where the session was before the move: the screens apply a move before
    asking, so by the time this runs the stored plan may already have it on `new_date`,
    and "the sequence without the move" has to be rebuilt from the day it left.
    """
    original = next((s for s in stored if s["id"] == session_id), None)
    if original is None or new_date < today:
        return MoveCheck()
    if from_date is not None:
        stored = [{**s, "date": from_date.isoformat()} if s["id"] == session_id else s for s in stored]
        original = {**original, "date": from_date.isoformat()}
    start = new_date - timedelta(days=SPAN_DAYS)
    start -= timedelta(days=start.weekday())  # whole weeks, for `hard_per_week`
    end = new_date + timedelta(days=SPAN_DAYS)
    end += timedelta(days=6 - end.weekday())

    before_sessions, before_refs = _sequence(stored, days, today, start, end)
    before = {w.problem for w in _rule_warnings(before_sessions, before_refs, session_id, context, start, end)}

    moved_stored = [{**s, "date": new_date.isoformat()} if s["id"] == session_id else s for s in stored]
    after_sessions, after_refs = _sequence(moved_stored, days, today, start, end)
    warnings = [
        w
        for w in _rule_warnings(after_sessions, after_refs, session_id, context, start, end)
        if session_id in w.sessions and w.problem not in before
    ]
    moved = dataclasses.replace(session_from_dict(original), date=new_date)
    pain = _pain_warning(moved, session_id, checkins)
    if pain:
        warnings.append(pain)
    warnings = [w for w in warnings if w.fingerprint not in confirmed]
    if not warnings:
        return MoveCheck()

    adapted = adapt(moved)
    if adapted is moved:
        return MoveCheck(warnings)
    adapted_sessions = [adapted if ref == session_id else s for s, ref in zip(after_sessions, after_refs)]
    remaining = [
        w
        for w in _rule_warnings(adapted_sessions, after_refs, session_id, context, start, end)
        if session_id in w.sessions and w.problem not in before
    ]
    if remaining or _pain_warning(adapted, session_id, checkins):
        return MoveCheck(warnings)
    return MoveCheck(warnings, adapted)


# ---- decisions ------------------------------------------------------------------------------

DECISION_SCHEMA = """
CREATE TABLE IF NOT EXISTS move_decision (
    user_id      TEXT NOT NULL,
    session_id   TEXT NOT NULL,
    new_date     DATE NOT NULL,
    choice       TEXT NOT NULL,
    warnings     JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS move_decision_user_idx ON move_decision (user_id, created_at);
"""

CHOICES = ("confermo", "adatta", "annulla")


def ensure_schema() -> None:
    from . import db

    with db.connect() as conn:
        conn.execute(DECISION_SCHEMA)


def record_decision(user_id: str, session_id: str, new_date: date_type, choice: str, warnings: list[dict]) -> None:
    """Every answer, kept: which rules users override is how a too-strict rule shows up."""
    from psycopg.types.json import Jsonb

    from . import db

    if choice not in CHOICES:
        raise ValueError(choice)
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO move_decision (user_id, session_id, new_date, choice, warnings) VALUES (%s, %s, %s, %s, %s)",
            [user_id, session_id, new_date, choice, Jsonb(warnings)],
        )


def confirmed_fingerprints(user_id: str) -> set[str]:
    from . import db

    with db.connect() as conn:
        rows = conn.execute(
            "SELECT DISTINCT jsonb_array_elements(warnings)->>'fingerprint' FROM move_decision "
            "WHERE user_id = %s AND choice = 'confermo'",
            [user_id],
        ).fetchall()
    return {row[0] for row in rows if row[0]}
