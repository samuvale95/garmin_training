"""Progress: the streak, Disciplina points, badges and the mascot.

The gamification's first slice (`BRAINSTORM-miglioramenti-e-gamification.md` §5bis). It
serves one thing, consistency, and follows three rules:

- **Every point has a reason with the user's numbers**, and is recomputed from rows the
  app already keeps -- history, plan, check-ins, level. No ledger: a rule fixed later
  applies to the whole history, and nothing can drift out of sync.
- **Never volume.** Points come from showing up, respecting rest and listening to the
  body. Running more than planned earns nothing, and far more loses points.
- **Resting when hurt never breaks a streak.** A week with pain reported is protected
  without spending a token.

"As planned" is soft until the plan adapts itself (phase 2): a planned day counts if any
training happened that day, not only the exact session.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date as date_type
from datetime import timedelta
from typing import TYPE_CHECKING, Sequence

from . import plan_rules
from .checkin import CheckIn
from .levels import ACTIVE_WEEK_SESSIONS

if TYPE_CHECKING:
    from .levels import DayTraining

WEEKS = 52
TOKEN_EVERY = 4
MAX_TOKENS = 2

POINTS_PLANNED_DAY = 10
POINTS_REST_RESPECTED = 5
MAX_REST_DAYS_SCORED = 2
POINTS_CHECKIN = 3
POINTS_SMART_CHOICE = 10
SMART_CHOICE_SHARE = 0.7
POINTS_ACTIVE_WEEK = 20
POINTS_ALL_PLANNED = 20
POINTS_OVER_PLAN = -10
OVER_PLAN_RATIO = 1.3
POINTS_UNPLANNED_DAY = 10
MAX_UNPLANNED_DAYS = 5

STREAK_BADGES = (4, 12, 26)
CHECKINS_BADGE = 7
RECENT_BADGE_DAYS = 3

_DAY_NAMES = ("lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica")


def _monday(day: date_type) -> date_type:
    return day - timedelta(days=day.weekday())


def _fmt(day: date_type) -> str:
    return f"{_DAY_NAMES[day.weekday()]} {day.day}"


@dataclass
class PointLine:
    date: date_type
    points: int
    reason: str


@dataclass
class WeekState:
    monday: date_type
    sessions: int
    active: bool
    protected: bool
    token_spent: bool
    streak: int
    tokens: int


@dataclass
class Badge:
    key: str
    title: str
    description: str
    earned: bool
    earned_on: date_type | None
    progress: int
    target: int


@dataclass
class Mascot:
    state: str  # esultanza | corsa | riposo | attesa
    sentence: str


@dataclass
class Progress:
    streak: int
    tokens: int
    week_points: int
    week_lines: list[PointLine]
    total_points: int
    badges: list[Badge]
    mascot: Mascot
    weeks: list[WeekState] = field(default_factory=list)


# ---- inputs, by day ----------------------------------------------------------------------


@dataclass
class _Inputs:
    today: date_type
    trained: dict[date_type, "DayTraining"]
    planned: dict[date_type, list]  # day -> TrainingSession list
    checkins: dict[date_type, CheckIn]

    def sessions(self, monday: date_type) -> int:
        return sum(self.trained[d].sessions for d in self._days(monday) if d in self.trained)

    def _days(self, monday: date_type) -> list[date_type]:
        return [monday + timedelta(days=k) for k in range(7)]

    def pain_in_week(self, monday: date_type) -> bool:
        return any(c.body == "dolore" for d, c in self.checkins.items() if monday <= d <= monday + timedelta(days=6))


def _inputs(today, days, planned, checkins) -> _Inputs:
    from .plan_generator import session_from_dict

    by_day: dict[date_type, list] = {}
    for raw in planned:
        session = session_from_dict(raw)
        by_day.setdefault(session.date, []).append(session)
    return _Inputs(
        today=today,
        trained={d.day: d for d in days if d.sessions > 0},
        planned=by_day,
        checkins={c.date: c for c in checkins},
    )


# ---- the streak ---------------------------------------------------------------------------


def walk_weeks(inputs: _Inputs, until: date_type | None = None) -> list[WeekState]:
    """The last `WEEKS` weeks, oldest first, with the streak and tokens after each."""
    this_week = _monday(until or inputs.today)
    streak = tokens = run = 0
    out: list[WeekState] = []
    for k in range(WEEKS - 1, -1, -1):
        monday = this_week - timedelta(weeks=k)
        sessions = inputs.sessions(monday)
        active = sessions >= ACTIVE_WEEK_SESSIONS
        in_progress = monday + timedelta(days=6) >= inputs.today
        protected = token_spent = False
        if active:
            streak += 1
            run += 1
            if run % TOKEN_EVERY == 0:
                tokens = min(MAX_TOKENS, tokens + 1)
        elif in_progress:
            pass  # a week still running only counts once it is active
        elif inputs.pain_in_week(monday):
            protected = True
        elif tokens > 0 and streak > 0:
            tokens -= 1
            token_spent = protected = True
        else:
            streak = run = 0
        if not active and not in_progress:
            run = 0  # tokens come from consecutive active weeks only
        out.append(WeekState(monday, sessions, active, protected, token_spent, streak, tokens))
    return out


def streak_at(weeks: Sequence[WeekState], monday: date_type) -> int:
    return next((w.streak for w in weeks if w.monday == monday), 0)


# ---- points -------------------------------------------------------------------------------


def _planned_minutes(sessions: list) -> float:
    return sum(sum(plan_rules.easy_and_hard_minutes(s)) for s in sessions if s.sport == plan_rules.RUNNING)


def week_points(inputs: _Inputs, monday: date_type, weeks: Sequence[WeekState]) -> list[PointLine]:
    """Every point of one week, with its reason."""
    today = inputs.today
    days = [monday + timedelta(days=k) for k in range(7)]
    sunday = days[-1]
    lines: list[PointLine] = []
    planned_days = [d for d in days if d in inputs.planned]
    has_plan = bool(planned_days)
    week_trained = [d for d in days if d in inputs.trained and d <= today]

    if has_plan:
        rest_scored = 0
        for day in days:
            if day >= today:
                continue
            if day in inputs.planned:
                if day in inputs.trained:
                    titles = ", ".join(s.title for s in inputs.planned[day])
                    lines.append(PointLine(day, POINTS_PLANNED_DAY, f"{_fmt(day)}: allenamento del piano fatto ({titles})"))
            elif day not in inputs.trained and week_trained and rest_scored < MAX_REST_DAYS_SCORED:
                rest_scored += 1
                lines.append(PointLine(day, POINTS_REST_RESPECTED, f"{_fmt(day)}: riposo del piano rispettato"))
    else:
        for day in week_trained[:MAX_UNPLANNED_DAYS]:
            if day < today:
                lines.append(PointLine(day, POINTS_UNPLANNED_DAY, f"{_fmt(day)}: allenamento fatto"))

    for day in days:
        if day in inputs.checkins and day <= today:
            lines.append(PointLine(day, POINTS_CHECKIN, f"{_fmt(day)}: check-in fatto"))

    for day in planned_days:
        if day >= today:
            continue
        hard = [s for s in inputs.planned[day] if plan_rules.session_kind(s) in plan_rules.HARD_KINDS]
        if not hard:
            continue
        report = next(
            (inputs.checkins[d] for d in (day, day - timedelta(days=1)) if d in inputs.checkins and inputs.checkins[d].body in ("dolore", "stanco")),
            None,
        )
        if report is None:
            continue
        done = inputs.trained[day].run_minutes if day in inputs.trained else 0.0
        if done <= _planned_minutes(hard) * SMART_CHOICE_SHARE:
            said = report.pain_phrase().lower() if report.body == "dolore" else "stanchezza"
            lines.append(
                PointLine(day, POINTS_SMART_CHOICE, f"{_fmt(day)}: hai ascoltato il corpo ({said} segnalato), seduta dura alleggerita")
            )

    state = next((w for w in weeks if w.monday == monday), None)
    if state and state.active:
        lines.append(PointLine(sunday, POINTS_ACTIVE_WEEK, f"settimana attiva: {state.sessions} allenamenti"))
    if has_plan and sunday < today:
        done_planned = sum(1 for d in planned_days if d in inputs.trained)
        if done_planned == len(planned_days):
            lines.append(PointLine(sunday, POINTS_ALL_PLANNED, f"tutti i {len(planned_days)} giorni del piano fatti"))
        planned_minutes = sum(_planned_minutes(inputs.planned[d]) for d in planned_days)
        done_minutes = sum(inputs.trained[d].run_minutes for d in days if d in inputs.trained)
        if planned_minutes > 0 and done_minutes > planned_minutes * OVER_PLAN_RATIO:
            over = round((done_minutes / planned_minutes - 1) * 100)
            lines.append(
                PointLine(
                    sunday,
                    POINTS_OVER_PLAN,
                    f"oltre il piano del {over}% ({round(done_minutes)} minuti contro {round(planned_minutes)}): "
                    "correre di più non vale punti",
                )
            )
    return sorted(lines, key=lambda line: line.date)


# ---- badges -------------------------------------------------------------------------------


def _badges(inputs: _Inputs, weeks: Sequence[WeekState], reached_level: int) -> list[Badge]:
    trained_days = sorted(inputs.trained)
    # Only 52 weeks are read: a first session in the window's first week may be older
    # than the window, so it is earned without a date rather than with a wrong one.
    first = trained_days[0] if trained_days else None
    window_start = weeks[0].monday if weeks else None
    first_known = first if first and window_start and first >= window_start + timedelta(weeks=1) else None
    out = [
        Badge(
            "primo_passo", "Primo passo", "Il primo allenamento registrato.",
            first is not None, first_known, min(1, len(trained_days)), 1,
        )
    ]

    complete = None
    for w in weeks:
        days = [w.monday + timedelta(days=k) for k in range(7)]
        planned_days = [d for d in days if d in inputs.planned]
        if planned_days and days[-1] < inputs.today and all(d in inputs.trained for d in planned_days):
            complete = days[-1]
            break
    out.append(Badge("settimana_completa", "Settimana completa", "Tutti i giorni del piano di una settimana fatti.", complete is not None, complete, int(complete is not None), 1))

    best = max((w.streak for w in weeks), default=0)
    for target in STREAK_BADGES:
        earned = next((w.monday + timedelta(days=6) for w in weeks if w.streak >= target), None)
        out.append(
            Badge(
                f"serie_{target}", f"{target} settimane di fila", f"{target} settimane attive consecutive, con almeno {ACTIVE_WEEK_SESSIONS} allenamenti.",
                earned is not None, earned, min(best, target), target,
            )
        )

    smart = None
    for w in weeks:
        line = next((l for l in week_points(inputs, w.monday, weeks) if l.points == POINTS_SMART_CHOICE and "ascoltato" in l.reason), None)
        if line:
            smart = line.date
            break
    out.append(Badge("ascolti_il_corpo", "Ascolti il corpo", "Hai alleggerito una seduta dura dopo aver segnalato dolore o stanchezza.", smart is not None, smart, int(smart is not None), 1))

    checkin_days = sorted(inputs.checkins)
    seventh = checkin_days[CHECKINS_BADGE - 1] if len(checkin_days) >= CHECKINS_BADGE else None
    out.append(Badge("check_in", f"{CHECKINS_BADGE} check-in", f"{CHECKINS_BADGE} giorni con il check-in.", seventh is not None, seventh, min(len(checkin_days), CHECKINS_BADGE), CHECKINS_BADGE))

    for level, title in ((2, "Livello struttura"), (3, "Livello atleta")):
        out.append(Badge(f"livello_{level}", title, f"Hai raggiunto il livello {level}.", reached_level >= level, None, min(reached_level, level), level))
    return out


# ---- mascot -------------------------------------------------------------------------------


def _mascot(inputs: _Inputs, weeks: Sequence[WeekState], badges: Sequence[Badge]) -> Mascot:
    today = inputs.today
    recent = [b for b in badges if b.earned_on and today - timedelta(days=RECENT_BADGE_DAYS) <= b.earned_on <= today]
    this_week = weeks[-1] if weeks else None
    before_today = sum(
        inputs.trained[d].sessions for d in inputs.trained if _monday(today) <= d < today
    )
    just_active = bool(this_week and this_week.active and before_today < ACTIVE_WEEK_SESSIONS)
    if recent:
        return Mascot("esultanza", f"Nuovo traguardo: {recent[-1].title}.")
    if just_active:
        return Mascot("esultanza", f"Settimana attiva: sono {this_week.streak} di fila.")
    pain = next((inputs.checkins[d] for d in (today, today - timedelta(days=1)) if d in inputs.checkins and inputs.checkins[d].body == "dolore"), None)
    if today in inputs.trained:
        return Mascot("corsa", "Allenamento fatto oggi. Il resto lo fa il recupero.")
    if pain:
        return Mascot("riposo", f"{pain.pain_phrase()}: oggi il recupero conta più della seduta.")
    if inputs.planned and today not in inputs.planned:
        return Mascot("riposo", "Oggi riposo: fa parte del piano, ed è lì che si migliora.")
    return Mascot("attesa", "La giornata è ancora tutta da scrivere.")


# ---- the whole thing ----------------------------------------------------------------------


def build_progress(
    *,
    today: date_type,
    days: Sequence["DayTraining"],
    planned: Sequence[dict],
    checkins: Sequence[CheckIn],
    reached_level: int,
) -> Progress:
    inputs = _inputs(today, days, planned, checkins)
    weeks = walk_weeks(inputs)
    this_monday = _monday(today)
    lines = week_points(inputs, this_monday, weeks)
    total = sum(sum(l.points for l in week_points(inputs, w.monday, weeks)) for w in weeks)
    badges = _badges(inputs, weeks, reached_level)
    current = weeks[-1]
    streak = current.streak if current.active else (weeks[-2].streak if len(weeks) > 1 else 0)
    return Progress(
        streak=streak,
        tokens=current.tokens,
        week_points=sum(l.points for l in lines),
        week_lines=lines,
        total_points=total,
        badges=badges,
        mascot=_mascot(inputs, weeks, badges),
        weeks=weeks,
    )


def summary_of_week(
    *, monday: date_type, today: date_type, days: Sequence["DayTraining"], planned: Sequence[dict], checkins: Sequence[CheckIn], reached_level: int
) -> tuple[int, list[PointLine], list[Badge], int]:
    """What the weekly summary shows: the streak as of that week, its points, its badges."""
    inputs = _inputs(today, days, planned, checkins)
    weeks = walk_weeks(inputs)
    state = next((w for w in weeks if w.monday == monday), None)
    if state is None:
        streak = 0
    elif state.active or monday + timedelta(days=6) < today:
        streak = state.streak
    else:
        previous = next((w for w in weeks if w.monday == monday - timedelta(weeks=1)), None)
        streak = previous.streak if previous else 0
    lines = week_points(inputs, monday, weeks)
    earned = [b for b in _badges(inputs, weeks, reached_level) if b.earned_on and monday <= b.earned_on <= monday + timedelta(days=6)]
    return streak, lines, earned, sum(l.points for l in lines)
