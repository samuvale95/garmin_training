"""The next weeks of the plan, written by the model inside limits written by the code.

`BRAINSTORM-miglioramenti-e-gamification.md` §0.4 in one module:

1. the code computes the limits -- the skeleton (`plan_skeleton`), the week targets
   capped by today's rules (`plan_rules.volume_limit`), the pace bands from the athlete's
   own streams;
2. the model composes inside them: which sessions, in which order, with which words;
3. the code checks the result (`check`), sends the failures back, and writes nothing that
   did not pass;
4. every week carries its reason, with the user's numbers;
5. sessions the user edited by hand are never touched (`plan_store.replace_unlocked`).

A plan must never depend on a model being up (`llm.py`'s rule), so `compose_fallback`
writes a plain window inside the same limits whenever the model is missing, unreachable,
or never gets it right. It is also the proof that a skeleton can be filled at all.
"""

from __future__ import annotations

import json
import logging
import math
import threading
import time
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from datetime import date as date_type
from datetime import timedelta
from statistics import median
from typing import TYPE_CHECKING, Any

from . import llm, parser, plan_rules, plan_skeleton, prescription
from .models import (
    PaceTarget,
    RaceGoal,
    RepeatBlock,
    Step,
    TrainingSession,
    avg_pace_sec_per_km,
    flatten_steps,
    session_duration_minutes,
)
from .paces import PaceProfile, scale_pace
from .plan_rules import RuleContext
from .plan_skeleton import SkeletonInputs, SkeletonWeek

if TYPE_CHECKING:
    from .levels import DayTraining

logger = logging.getLogger(__name__)

SOURCE_AI = "ai"
SOURCE_RULES = "regole"

MAX_ATTEMPTS = 3
# No attempt starts after this many seconds: with a slow model the worst case is about
# one more call on top, and the usual case is a single call.
TIME_BUDGET_S = 150.0

# A week's planned running minutes must land in this band around its target.
WEEK_LOW = 0.85
WEEK_HIGH = 1.05
# Below this target a week has too little in it for a lower bound to mean anything.
MIN_TARGET_FOR_LOW = 30

EASY_BAND_SEC = 15
# Warm-up and recovery jogs run slower than easy running.
SLOW_MARGIN_SEC = 45
PACED_STEP_TYPES = ("warmup", "interval", "cooldown")

# Running days by count, as weekdays (Monday 0): the long run last, the quality days
# early and apart (design.md decision #8).
DAY_PATTERNS = {
    1: (6,),
    2: (2, 6),
    3: (1, 3, 6),
    4: (1, 3, 5, 6),
    5: (1, 2, 3, 5, 6),
    6: (0, 1, 2, 3, 5, 6),
}
LONG_SHARE_OF_WEEK = 0.5
LONG_RUN_MARGIN_MINUTES = 10
MIN_EASY_MINUTES = plan_skeleton.MIN_SESSION_MINUTES
# Of the hard minutes a week's easy share leaves, what one quality session may use: the
# rest is margin, because the warm-up and recoveries are counted by pace, not by label.
QUALITY_SHARE_OF_ALLOWANCE = 0.8

_DAY_NAMES = ("lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica")


class GenerationInProgress(Exception):
    """A generation for this user is already running."""


class GenerationFailed(Exception):
    """Not even the fallback passed the checks: nothing was written."""

    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__("\n".join(errors))


# ---- pace bands ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PaceBand:
    faster: int
    slower: int

    def target(self) -> PaceTarget:
        return PaceTarget(slower_sec_per_km=self.slower, faster_sec_per_km=self.faster)

    def label(self) -> str:
        return f"{_pace(self.slower)}-{_pace(self.faster)}"


@dataclass(frozen=True)
class PaceBands:
    easy: PaceBand
    threshold: PaceBand
    fast: PaceBand

    @property
    def fastest(self) -> int:
        return self.fast.faster

    @property
    def slowest(self) -> int:
        return self.easy.slower + SLOW_MARGIN_SEC


def pace_bands(profile: PaceProfile | None) -> PaceBands | None:
    """The paces a generated session may use, from the athlete's own streams, or None.

    Both paces or nothing: a quality band guessed from an easy pace alone (or the other
    way round) would be a number nobody can trace back to a run.
    """
    if profile is None or profile.easy is None or profile.threshold is None:
        return None
    easy = scale_pace(profile.easy.sec_per_km, prescription.EASY_PACE_SLOWDOWN)
    threshold = scale_pace(profile.threshold.sec_per_km, prescription.THRESHOLD_PACE_FACTOR)
    fast = scale_pace(profile.threshold.sec_per_km, prescription.VO2_PACE_FACTOR)
    band = prescription.PACE_BAND_SEC
    return PaceBands(
        easy=PaceBand(easy - EASY_BAND_SEC, easy + EASY_BAND_SEC),
        threshold=PaceBand(threshold - band, threshold + band),
        fast=PaceBand(fast - band, fast + band),
    )


def _pace(sec: float) -> str:
    sec = int(round(sec))
    return f"{sec // 60}:{sec % 60:02d}"


# ---- the window ---------------------------------------------------------------------------


def _monday(day: date_type) -> date_type:
    return day - timedelta(days=day.weekday())


def _fmt_day(day: date_type) -> str:
    return f"{_DAY_NAMES[day.weekday()]} {day.day}"


def window_dates(today: date_type, goal: RaceGoal | None = None) -> tuple[date_type, date_type]:
    """Tomorrow to the Sunday of the week two weeks after tomorrow's: 15 to 21 days.
    Cut at the race: what comes after it is a different plan."""
    start = today + timedelta(days=1)
    end = _monday(start) + timedelta(days=20)
    if goal is not None and start <= goal.race_date <= end:
        end = goal.race_date
    return start, end


@dataclass
class WindowWeek:
    skeleton: SkeletonWeek
    first_day: date_type
    last_day: date_type
    # The week's running minutes, all included: min(skeleton, today's volume limit).
    target: int
    target_reason: str
    long_run_max: int
    # Minutes already in the week that the generator does not write: run before the
    # window, sessions locked by the user, the race.
    fixed_minutes: float = 0.0
    fixed_running_days: int = 0
    fixed_quality: int = 0

    @property
    def monday(self) -> date_type:
        return self.skeleton.monday

    @property
    def whole(self) -> bool:
        return self.first_day == self.monday and self.last_day == self.monday + timedelta(days=6)

    @property
    def minimum(self) -> int:
        if not self.whole or self.target < MIN_TARGET_FOR_LOW:
            return 0
        return max(0, math.ceil(self.target * WEEK_LOW - self.fixed_minutes))

    @property
    def maximum(self) -> int:
        return max(0, math.floor(self.target * WEEK_HIGH - self.fixed_minutes))

    @property
    def to_plan(self) -> int:
        return max(0, round(self.target - self.fixed_minutes))

    @property
    def running_days_left(self) -> int:
        return max(0, self.skeleton.running_days - self.fixed_running_days)

    @property
    def quality_left(self) -> int:
        return max(0, self.skeleton.quality_sessions - self.fixed_quality)

    def days(self) -> list[date_type]:
        return [self.first_day + timedelta(days=k) for k in range((self.last_day - self.first_day).days + 1)]


@dataclass
class Window:
    today: date_type
    start: date_type
    end: date_type
    context: RuleContext
    weeks: list[WindowWeek]
    bands: PaceBands | None
    goal: RaceGoal | None = None
    # Sessions inside the window the generator must not replace.
    locked: list[TrainingSession] = field(default_factory=list)
    # Sessions the code writes itself (the race).
    fixed: list[TrainingSession] = field(default_factory=list)
    # What already happened this week, and today's planned session: context for the
    # rules, never written.
    before: list[TrainingSession] = field(default_factory=list)

    @property
    def level(self) -> int:
        return self.context.effective_level

    @property
    def background(self) -> list[TrainingSession]:
        return [*self.before, *self.locked, *self.fixed]

    @property
    def taken_days(self) -> set[date_type]:
        return {s.date for s in (*self.locked, *self.fixed)}

    def week_of(self, day: date_type) -> WindowWeek | None:
        monday = _monday(day)
        return next((week for week in self.weeks if week.monday == monday), None)


def _running_minutes(session: TrainingSession) -> float:
    return session_duration_minutes(session) if session.sport == plan_rules.RUNNING else 0.0


def race_session(goal: RaceGoal) -> TrainingSession:
    """The race itself, written by the code: the model does not schedule the race."""
    pace = None
    if goal.target_time_seconds:
        centre = round(goal.target_time_seconds / goal.distance_km)
        pace = PaceTarget(slower_sec_per_km=centre + 5, faster_sec_per_km=centre - 5)
    name = goal.name or f"{goal.distance_km:g} km"
    return TrainingSession(
        date=goal.race_date,
        sport=plan_rules.RUNNING,
        title=f"Gara: {name}",
        description="Il giorno per cui hai lavorato. Parti controllato, il ritmo vero arriva dopo i primi chilometri.",
        steps=[Step("interval", "distance", goal.distance_km, pace)],
    )


def done_sessions(days: Sequence["DayTraining"], start: date_type, end: date_type) -> list[TrainingSession]:
    """What was run in `[start, end]`, as easy sessions of the right length.

    The history knows minutes, not the shape of the session, so a hard day already done
    reads as easy here: the day-order rules cannot see it (design.md, Risks).
    """
    out = []
    for day in days:
        if not start <= day.day <= end:
            continue
        if day.run_minutes > 0:
            out.append(
                TrainingSession(day.day, plan_rules.RUNNING, "Corsa fatta", steps=[Step("interval", "time", day.run_minutes)])
            )
        elif day.sessions > 0:
            out.append(TrainingSession(day.day, "other", "Allenamento fatto"))
    return out


def build_window(
    *,
    today: date_type,
    skeleton: Sequence[SkeletonWeek],
    context: RuleContext,
    stored: Sequence[dict],
    days: Sequence["DayTraining"],
    bands: PaceBands | None,
    goal: RaceGoal | None,
) -> Window:
    """Everything the model and the checks need about the next weeks. Pure."""
    start, end = window_dates(today, goal)
    first_monday = _monday(start)

    locked = [session_from_dict(s) for s in stored if s["locked"] and start.isoformat() <= s["date"] <= end.isoformat()]
    before = done_sessions(days, first_monday, today)
    if not any(s.date == today for s in before):
        before += [session_from_dict(s) for s in stored if s["date"] == today.isoformat()]
    before = [s for s in before if s.date >= first_monday]

    fixed: list[TrainingSession] = []
    if goal is not None and start <= goal.race_date <= end and not any(s.date == goal.race_date for s in locked):
        fixed.append(race_session(goal))

    by_monday = {week.monday: week for week in skeleton}
    long_limit, _ = plan_rules.long_run_limit(context)
    weeks: list[WindowWeek] = []
    earlier: dict[date_type, float] = {}
    monday = first_monday
    while monday <= end:
        if monday not in by_monday:
            raise ValueError(f"the skeleton has no week starting {monday}")
        sk = by_monday[monday]
        limit, origin = plan_rules.volume_limit(plan_rules.volume_base(context, earlier, monday), context)
        target = min(sk.target_minutes, math.floor(limit))
        reason = sk.reason
        if target < sk.target_minutes:
            reason += f" Per ora al massimo {target} minuti ({origin})."
        week = WindowWeek(
            skeleton=sk,
            first_day=max(start, monday),
            last_day=min(end, monday + timedelta(days=6)),
            target=target,
            target_reason=reason,
            long_run_max=min(sk.long_run_minutes, math.floor(long_limit)),
        )
        in_week = [s for s in (*before, *locked, *fixed) if _monday(s.date) == monday]
        week.fixed_minutes = sum(_running_minutes(s) for s in in_week)
        week.fixed_running_days = len({s.date for s in in_week if _running_minutes(s) > 0})
        week.fixed_quality = sum(
            1 for s in (*locked, *fixed) if _monday(s.date) == monday and plan_rules.session_kind(s) == plan_rules.KIND_QUALITY
        )
        weeks.append(week)
        earlier[monday] = target
        monday += timedelta(weeks=1)

    return Window(
        today=today,
        start=start,
        end=end,
        context=context,
        weeks=weeks,
        bands=bands,
        goal=goal,
        locked=locked,
        fixed=fixed,
        before=before,
    )


# ---- sessions as data ---------------------------------------------------------------------


def session_to_dict(session: TrainingSession) -> dict[str, Any]:
    """The stored / API shape (`plan_store`, `schemas.TrainingSessionIn`)."""
    data = asdict(session)
    data["date"] = session.date.isoformat()
    return data


def _step_from_dict(raw: dict) -> Step | RepeatBlock:
    if "reps" in raw:
        return RepeatBlock(reps=raw["reps"], steps=[_step_from_dict(s) for s in raw.get("steps") or []])
    pace = raw.get("target_pace")
    return Step(
        type=raw["type"],
        duration_type=raw["duration_type"],
        duration_value=float(raw["duration_value"]),
        target_pace=PaceTarget(**pace) if pace else None,
    )


def session_from_dict(raw: dict) -> TrainingSession:
    return TrainingSession(
        date=date_type.fromisoformat(raw["date"]),
        sport=raw["sport"],
        title=raw["title"],
        description=raw.get("description"),
        steps=[_step_from_dict(s) for s in raw.get("steps") or []],
    )


def parse_proposal(raw: str) -> tuple[list[TrainingSession], list[str]]:
    """The model's answer as sessions, in the plan file's own format (`parser`)."""
    data = llm.parse_json_object(raw)
    if data is None or not isinstance(data.get("sessions"), list):
        return [], ['La risposta non è un oggetto JSON con una lista "sessions".']
    return parser.parse_sessions(data["sessions"])


# ---- the checks ---------------------------------------------------------------------------


def _check_paces(session: TrainingSession, bands: PaceBands | None) -> list[str]:
    errors = []
    label = f"{_fmt_day(session.date)} ({session.title})"
    for step in flatten_steps(session.steps):
        if bands is None:
            if step.target_pace is not None:
                errors.append(
                    f"{label}: non ci sono fasce di ritmo per questo atleta, quindi nessun passo può avere un ritmo; "
                    "descrivi lo sforzo a parole."
                )
                break
            continue
        if step.target_pace is None:
            if step.type in PACED_STEP_TYPES:
                errors.append(f"{label}: il passo '{step.type}' non ha un ritmo.")
            continue
        pace = avg_pace_sec_per_km(step.target_pace)
        if not bands.fastest <= pace <= bands.slowest:
            errors.append(
                f"{label}: il ritmo {_pace(pace)}/km è fuori dalle fasce ammesse "
                f"({_pace(bands.slowest)}-{_pace(bands.fastest)}/km)."
            )
    return errors


def check(proposal: Sequence[TrainingSession], window: Window) -> list[str]:
    """Every reason `proposal` may not be written; empty when it may.

    Structure first, rules after: on a proposal with a missing step the rule messages
    would be noise the model then tries to fix instead of the real problem.
    """
    if not proposal:
        return ["La proposta non contiene sedute."]

    errors: list[str] = []
    seen: set[date_type] = set()
    for session in proposal:
        label = f"{_fmt_day(session.date)} ({session.title})"
        if not window.start <= session.date <= window.end:
            errors.append(f"{label}: è fuori dalla finestra {window.start.isoformat()} - {window.end.isoformat()}.")
            continue
        if session.sport != plan_rules.RUNNING:
            errors.append(f"{label}: sport '{session.sport}', sono ammesse solo corse ('running').")
        if not session.steps:
            errors.append(f"{label}: non ha passi.")
        if session.date in window.taken_days:
            errors.append(f"{label}: quel giorno c'è già una seduta fissa, lascialo libero.")
        if session.date in seen:
            errors.append(f"{label}: c'è già un'altra seduta proposta lo stesso giorno.")
        seen.add(session.date)
        errors += _check_paces(session, window.bands)
    if errors:
        return errors

    for week in window.weeks:
        mine = [s for s in proposal if _monday(s.date) == week.monday]
        planned = sum(_running_minutes(s) for s in mine)
        when = f"Settimana del {_fmt_day(week.monday)}"
        if planned > week.maximum:
            errors.append(f"{when}: {round(planned)} minuti di corsa proposti, il massimo è {week.maximum}.")
        if planned < week.minimum:
            errors.append(f"{when}: {round(planned)} minuti di corsa proposti, il minimo è {week.minimum}.")
        days = len({s.date for s in mine})
        if days > week.running_days_left:
            errors.append(f"{when}: {days} giorni di corsa, al massimo {week.running_days_left}.")
        quality = sum(1 for s in mine if plan_rules.session_kind(s) == plan_rules.KIND_QUALITY)
        if quality > week.quality_left:
            errors.append(f"{when}: {quality} sedute di qualità, al massimo {week.quality_left}.")
        for session in mine:
            minutes = _running_minutes(session)
            if minutes > week.long_run_max:
                errors.append(
                    f"{_fmt_day(session.date)} ({session.title}): {round(minutes)} minuti, "
                    f"il lungo di questa settimana arriva al massimo a {week.long_run_max}."
                )

    background = window.background
    sessions = [*background, *proposal]
    ids = [None] * len(background) + [f"proposta-{i}" for i in range(len(proposal))]
    for violation in plan_rules.validate(
        sessions, window.context, ids=ids, start=_monday(window.start), end=window.end
    ):
        # Only what the proposal can fix: a rule broken by the user's own locked sessions
        # alone is theirs to keep (§0.4 rule 5), not a reason to refuse every proposal.
        if any(ref.startswith("proposta-") for ref in violation.sessions):
            errors.append(violation.message)
    return errors


# ---- the brief ----------------------------------------------------------------------------

PLAN_SYSTEM_PROMPT = """Sei l'allenatore di Passo, un'app di allenamento per la corsa.

Componi le sedute di corsa per i giorni indicati, dentro i limiti che ti passo. I limiti
li ha calcolati l'app dai dati di chi corre: non si discutono e non si superano.

Come lavori:
- Per ogni settimana: minuti totali di corsa fra "minuti_minimi" e "minuti_massimi",
  non più di "giorni_di_corsa_max" giorni di corsa, non più di "qualita_max" sedute di
  qualità, nessuna corsa più lunga di "lungo_max_minuti".
- Una seduta è di qualità se contiene un blocco di ripetute ("repeat") o almeno 5 minuti
  più veloci della fascia facile. Una corsa di 90 minuti o più è un lungo. Qualità e
  lungo sono sedute dure.
- Rispetta le "regole" del livello, alla lettera.
- Usa solo giorni in "giorni_disponibili" e al massimo una seduta al giorno. Non toccare
  le "sedute_fisse" e lascia liberi i loro giorni.
- Ritmi: se ci sono "fasce_di_ritmo", ogni passo warmup, interval e cooldown ha un
  "target_pace" dentro quelle fasce ("M:SS" o "M:SS-M:SS", minuti al km). Se non ci sono,
  nessun passo ha "target_pace" e lo sforzo si descrive a parole.
- Ogni seduta ha una "description" di una o due frasi, in italiano, che dice a cosa serve
  e come farla. Non citare numeri diversi da quelli della seduta.
- Titoli brevi e concreti ("Fondo facile 45'", "Soglia 5x5'", "Lungo lento 80'").

Rispondi SOLO con un oggetto JSON, senza testo intorno e senza blocchi di codice:
{"sessions": [
  {"date": "YYYY-MM-DD", "sport": "running", "title": "...", "description": "...",
   "steps": [
     {"type": "warmup", "duration_type": "time", "duration_value": 15, "target_pace": "6:30"},
     {"repeat": 5, "steps": [
       {"type": "interval", "duration_type": "time", "duration_value": 5, "target_pace": "5:05"},
       {"type": "recovery", "duration_type": "time", "duration_value": 2}
     ]},
     {"type": "cooldown", "duration_type": "time", "duration_value": 10, "target_pace": "6:30"}
   ]}
]}
"type" è uno fra warmup, interval, recovery, cooldown; "duration_type" è "time" (minuti)
o "distance" (chilometri)."""


def _rules_in_words(level: int) -> list[str]:
    rule = plan_rules.RULES
    out = [
        f"Al massimo {int(rule['hard_in_a_row'].limit(level))} "
        f"{'giorno duro' if rule['hard_in_a_row'].limit(level) == 1 else 'giorni duri'} di fila.",
        f"Al massimo {int(rule['hard_per_week'].limit(level))} sedute dure a settimana.",
        f"Almeno {int(rule['rest_days'].limit(level))} giorni senza allenamento a settimana.",
        f"Almeno il {round(rule['easy_share'].limit(level) * 100)}% del tempo di corsa a intensità facile, "
        "contando riscaldamento, recuperi e defaticamento come facili.",
    ]
    if rule["hard_after_long"].limit(level):
        out.append("Mai una seduta dura il giorno dopo il lungo.")
    return out


def brief(window: Window) -> list[dict]:
    from .levels import LEVEL_MEANINGS, LEVEL_NAMES

    level = window.level
    goal = window.goal
    facts = {
        "oggi": window.today.isoformat(),
        "livello": {"numero": level, "nome": LEVEL_NAMES[level], "significato": LEVEL_MEANINGS.get(level)},
        "obiettivo": None
        if goal is None
        else {
            "nome": goal.name,
            "data": goal.race_date.isoformat(),
            "distanza_km": goal.distance_km,
            "tempo_obiettivo": _hms(goal.target_time_seconds) if goal.target_time_seconds else None,
        },
        "finestra": {"dal": window.start.isoformat(), "al": window.end.isoformat()},
        "settimane": [
            {
                "dal": week.first_day.isoformat(),
                "al": week.last_day.isoformat(),
                "fase": week.skeleton.phase,
                "minuti_minimi": week.minimum,
                "minuti_massimi": week.maximum,
                "minuti_da_pianificare": week.to_plan,
                "giorni_di_corsa_max": week.running_days_left,
                "qualita_max": week.quality_left,
                "lungo_max_minuti": week.long_run_max,
                "giorni_disponibili": [d.isoformat() for d in week.days() if d not in window.taken_days],
                "perche": week.target_reason,
            }
            for week in window.weeks
        ],
        "fasce_di_ritmo": None
        if window.bands is None
        else {
            "facile": window.bands.easy.label(),
            "soglia": window.bands.threshold.label(),
            "veloce": window.bands.fast.label(),
            "ammesse": f"{_pace(window.bands.slowest)}-{_pace(window.bands.fastest)}",
        },
        "sedute_fisse": [
            {
                "data": s.date.isoformat(),
                "titolo": s.title,
                "minuti": round(_running_minutes(s)),
                "tipo": plan_rules.session_kind(s),
            }
            for s in sorted((*window.locked, *window.fixed), key=lambda s: s.date)
        ],
        "regole": _rules_in_words(level),
    }
    return [
        {"role": "system", "content": PLAN_SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(facts, ensure_ascii=False)},
    ]


def _hms(seconds: int) -> str:
    return f"{seconds // 3600}:{seconds % 3600 // 60:02d}:{seconds % 60:02d}"


def _feedback(errors: list[str]) -> str:
    listed = "\n".join(f"- {e}" for e in errors)
    return (
        "La proposta non rispetta questi vincoli:\n"
        f"{listed}\n"
        "Correggila e rispondi di nuovo con l'oggetto JSON completo, solo quello."
    )


@dataclass
class Attempts:
    sessions: list[TrainingSession] | None
    count: int
    # Why the model's plan was not used; None when it was.
    reason: str | None = None
    errors: list[str] = field(default_factory=list)


def ask_model(
    window: Window,
    compose: Callable[[list[dict]], str | None] = llm.compose_plan,
    *,
    clock: Callable[[], float] = time.monotonic,
) -> Attempts:
    """Ask, check, send the failures back; at most `MAX_ATTEMPTS`, within the budget."""
    messages = brief(window)
    started = clock()
    errors: list[str] = []
    attempts = 0
    for attempt in range(1, MAX_ATTEMPTS + 1):
        if attempt > 1 and clock() - started > TIME_BUDGET_S:
            return Attempts(None, attempts, "tempo esaurito", errors)
        raw = compose(messages)
        attempts = attempt
        if raw is None:
            return Attempts(None, attempts, "modello non raggiungibile", errors)
        sessions, errors = parse_proposal(raw)
        if not errors:
            errors = check(sessions, window)
        if not errors:
            return Attempts(sessions, attempts)
        logger.info("plan attempt %d rejected: %s", attempt, errors)
        messages = [*messages, {"role": "assistant", "content": raw}, {"role": "user", "content": _feedback(errors)}]
    return Attempts(None, attempts, f"nessuna proposta valida in {attempts} tentativi", errors)


# ---- the fallback -------------------------------------------------------------------------


def _round5(value: float) -> int:
    return int(value / 5 + 0.5) * 5


def _easy_run(day: date_type, minutes: int, bands: PaceBands | None) -> TrainingSession:
    return TrainingSession(
        date=day,
        sport=plan_rules.RUNNING,
        title=f"Fondo facile {minutes}'",
        description="Corsa facile: devi riuscire a parlare per tutto il tempo. Serve a costruire la base.",
        steps=[Step("interval", "time", minutes, bands.easy.target() if bands else None)],
    )


def _long_run(day: date_type, minutes: int, bands: PaceBands | None) -> TrainingSession:
    return TrainingSession(
        date=day,
        sport=plan_rules.RUNNING,
        title=f"Lungo lento {minutes}'",
        description="La corsa più lunga della settimana, tutta a ritmo facile. Conta il tempo sulle gambe, non la velocità.",
        steps=[Step("interval", "time", minutes, bands.easy.target() if bands else None)],
    )


QUALITY_WARMUP_MINUTES = 15
QUALITY_COOLDOWN_MINUTES = 10


def _quality(
    day: date_type, index: int, hard_budget: float, max_minutes: int, bands: PaceBands | None
) -> TrainingSession | None:
    """Threshold repeats first, short fast repeats second; sized to the hard minutes the
    week's easy share leaves, and never longer than the week's long run (on the real
    account a 6x5' was the longest session of a light week). None when not even the
    shortest version fits."""
    work, recovery = (5, 2) if index == 0 else (3, 2)
    room = max_minutes - QUALITY_WARMUP_MINUTES - QUALITY_COOLDOWN_MINUTES
    reps = min(6, math.floor(hard_budget / work), math.floor(room / (work + recovery)))
    if reps < 3:
        return None
    easy = bands.easy.target() if bands else None
    band = (bands.threshold if index == 0 else bands.fast).target() if bands else None
    name = "Soglia" if index == 0 else "Ripetute"
    return TrainingSession(
        date=day,
        sport=plan_rules.RUNNING,
        title=f"{name} {reps}x{work}'",
        description=(
            "Ripetute a ritmo di soglia: sostenuto ma controllato. Alzano il ritmo che riesci a tenere a lungo."
            if index == 0
            else "Ripetute brevi e veloci, con recupero di corsa lenta. Allenano la velocità senza accumulare fatica."
        ),
        steps=[
            Step("warmup", "time", QUALITY_WARMUP_MINUTES, easy),
            RepeatBlock(reps=reps, steps=[Step("interval", "time", work, band), Step("recovery", "time", recovery)]),
            Step("cooldown", "time", QUALITY_COOLDOWN_MINUTES, easy),
        ],
    )


def _pick_days(week: WindowWeek, window: Window, count: int) -> list[date_type]:
    free = [d for d in week.days() if d not in window.taken_days]
    if count <= 0 or not free:
        return []
    pattern = DAY_PATTERNS[min(count, 6)]
    chosen = [d for d in free if d.weekday() in pattern]
    for day in free:
        if len(chosen) >= count:
            break
        if day not in chosen:
            chosen.append(day)
    return sorted(chosen[:count])


def compose_fallback(window: Window) -> list[TrainingSession]:
    """A plain window inside the same limits, with no model: long run last, quality early
    and apart, easy runs for the rest (design.md decision #8)."""
    level = window.level
    easy_share = plan_rules.RULES["easy_share"].limit(level)
    after_long_ok = not plan_rules.RULES["hard_after_long"].limit(level)
    hard_days = {s.date for s in window.background if plan_rules.session_kind(s) in plan_rules.HARD_KINDS}
    long_days = {s.date for s in window.background if plan_rules.session_kind(s) == plan_rules.KIND_LONG}
    out: list[TrainingSession] = []

    for week in window.weeks:
        days = _pick_days(week, window, week.running_days_left)
        budget = week.to_plan
        if not days or budget < MIN_EASY_MINUTES:
            continue

        sessions: dict[date_type, TrainingSession] = {}
        remaining = budget
        if len(days) >= 2:
            # The skeleton already sized the long run for the week; half the budget caps it
            # only in a short first week.
            long_minutes = min(week.long_run_max, _round5(budget * LONG_SHARE_OF_WEEK))
            # A long run only when it is clearly longer than an even split: in a 60-minute
            # beginner week a 25-minute "long run" just starves the other days.
            if long_minutes >= MIN_EASY_MINUTES and long_minutes >= budget / len(days) + LONG_RUN_MARGIN_MINUTES:
                sessions[days[-1]] = _long_run(days[-1], long_minutes, window.bands)
                remaining -= long_minutes
                if long_minutes >= plan_rules.LONG_RUN_MINUTES:
                    hard_days.add(days[-1])
                long_days.add(days[-1])

        hard_budget = (1 - easy_share) * budget * QUALITY_SHARE_OF_ALLOWANCE
        wanted = week.quality_left
        for day in days:
            if wanted <= 0:
                break
            if day in sessions:
                continue
            if day - timedelta(days=1) in hard_days or day + timedelta(days=1) in hard_days:
                continue
            if not after_long_ok and day - timedelta(days=1) in long_days:
                continue
            session = _quality(
                day, week.quality_left - wanted, hard_budget / max(1, week.quality_left), week.long_run_max, window.bands
            )
            if session is None:
                break
            sessions[day] = session
            hard_days.add(day)
            remaining -= session_duration_minutes(session)
            wanted -= 1

        easy_days = [d for d in days if d not in sessions]
        while easy_days and remaining / len(easy_days) < MIN_EASY_MINUTES:
            easy_days.pop(0)
        for day in easy_days:
            # Whole minutes, rounded down: rounding up on every day can push the week past
            # its maximum, and rounding down to 5 can drop a small week under its minimum.
            minutes = min(week.long_run_max, int(remaining / len(easy_days)))
            sessions[day] = _easy_run(day, minutes, window.bands)
        out += [sessions[d] for d in sorted(sessions)]
    return out


# ---- the whole thing ----------------------------------------------------------------------

_running: set[str] = set()
_running_lock = threading.Lock()


@contextmanager
def _one_at_a_time(user_id: str) -> Iterator[None]:
    """One generation per user: a second click would race the first to the same rows.
    In-process, which is enough for the single API process (design.md decision #10)."""
    with _running_lock:
        if user_id in _running:
            raise GenerationInProgress(user_id)
        _running.add(user_id)
    try:
        yield
    finally:
        with _running_lock:
            _running.discard(user_id)


@dataclass
class GenerationResult:
    source: str
    attempts: int
    window: Window
    written: list[dict]
    conflicts: list[dict]
    fallback_reason: str | None = None
    skeleton_regenerated: bool = False


def goal_from_dict(raw: dict | None) -> RaceGoal | None:
    if not raw:
        return None
    return RaceGoal(
        race_date=date_type.fromisoformat(str(raw["race_date"])),
        distance_km=float(raw["distance_km"]),
        name=raw.get("name"),
        target_time_seconds=raw.get("target_time_seconds"),
    )


def recent_running_days(days: Sequence["DayTraining"], today: date_type) -> int | None:
    """Median running days per complete week over the last 4, or None with no running."""
    this_week = _monday(today)
    weeks = {this_week - timedelta(weeks=k): set() for k in range(1, plan_rules.RECENT_WEEKS + 1)}
    for day in days:
        monday = _monday(day.day)
        if monday in weeks and day.run_minutes > 0:
            weeks[monday].add(day.day)
    counts = [len(v) for v in weeks.values()]
    if not any(counts):
        return None
    return int(median(counts))


def skeleton_is_current(
    stored: dict | None, *, goal: dict | None, level: int, mondays: Sequence[date_type]
) -> bool:
    if not stored:
        return False
    inputs = stored.get("inputs") or {}
    if inputs.get("goal") != goal or inputs.get("effective_level") != level:
        return False
    covered = {week["monday"] for week in stored.get("weeks") or []}
    return all(monday.isoformat() in covered for monday in mondays)


# Times a write refused because the plan changed underneath is re-checked and retried.
MAX_REWRITES = 2


def _fallback_or_fail(user_id: str, window: Window) -> list[TrainingSession]:
    sessions = compose_fallback(window)
    errors = check(sessions, window)
    if errors:
        logger.warning("fallback plan rejected for %s: %s", user_id, errors)
        raise GenerationFailed(errors)
    return sessions


def generate(
    user_id: str,
    today: date_type,
    *,
    profile: PaceProfile | None,
    threshold_available: bool,
    regenerate_skeleton: bool = False,
    compose: Callable[[list[dict]], str | None] = llm.compose_plan,
) -> GenerationResult:
    from . import db, plan_store  # local: keeps the pure parts importable without a DB

    with _one_at_a_time(user_id):
        context, days = plan_rules.gather_context(user_id, today, threshold_available=threshold_available)
        raw_goal = db.current_goal(user_id)
        goal = goal_from_dict(raw_goal)
        start, end = window_dates(today, goal)
        if goal is not None and goal.race_date < start:
            goal, raw_goal = None, None
            start, end = window_dates(today)
        mondays = [_monday(start) + timedelta(weeks=k) for k in range((_monday(end) - _monday(start)).days // 7 + 1)]

        stored_skeleton = db.get_skeleton(user_id)
        regenerated = regenerate_skeleton or not skeleton_is_current(
            stored_skeleton, goal=raw_goal, level=context.effective_level, mondays=mondays
        )
        if regenerated:
            weeks = plan_skeleton.build_skeleton(
                SkeletonInputs(
                    start=_monday(start),
                    effective_level=context.effective_level,
                    recent_weekly_minutes=context.recent_weekly_minutes,
                    recent_running_days=recent_running_days(days, today),
                    goal=goal,
                )
            )
            db.save_skeleton(
                user_id,
                {
                    "inputs": {"goal": raw_goal, "effective_level": context.effective_level},
                    "weeks": [week.to_dict() for week in weeks],
                },
            )
        else:
            weeks = [SkeletonWeek.from_dict(week) for week in stored_skeleton["weeks"]]

        # Everything `build_window` reads from the plan: this week before the window, and
        # the window. Snapshotted before reading, checked again at write time.
        span = (_monday(start), end)

        def fresh_window() -> tuple[Window, dict[str, str]]:
            seen = plan_store.snapshot(user_id, *span)
            window = build_window(
                today=today,
                skeleton=weeks,
                context=context,
                stored=plan_store.list_sessions(user_id),
                days=days,
                bands=pace_bands(profile),
                goal=goal,
            )
            return window, seen

        window, seen = fresh_window()
        if llm.configured():
            attempts = ask_model(window, compose)
        else:
            attempts = Attempts(None, 0, "modello non configurato")

        source, sessions, reason = SOURCE_AI, attempts.sessions, attempts.reason
        if sessions is None:
            source, sessions = SOURCE_RULES, _fallback_or_fail(user_id, window)

        for _ in range(MAX_REWRITES + 1):
            try:
                written = plan_store.replace_unlocked(
                    user_id,
                    window.start,
                    window.end,
                    [session_to_dict(s) for s in (*sessions, *window.fixed)],
                    origin="ai",
                    expected=(*span, seen),
                )
                break
            except plan_store.PlanChanged:
                # The user changed the plan while the model was writing: what was checked
                # is no longer what would be written around. Check the same proposal
                # against the plan as it is now; if it no longer fits, the rules write a
                # window that does -- quickly, so the user is not made to wait again.
                window, seen = fresh_window()
                if check(sessions, window):
                    source, sessions = SOURCE_RULES, _fallback_or_fail(user_id, window)
                    reason = "hai modificato il piano mentre lo scrivevo"
        else:
            raise GenerationFailed(["Il piano continua a cambiare mentre lo scrivo: riprova tra poco."])

        return GenerationResult(
            source=source,
            attempts=attempts.count,
            window=window,
            written=written.written,
            conflicts=written.conflicts,
            fallback_reason=reason if source == SOURCE_RULES else None,
            skeleton_regenerated=regenerated,
        )
