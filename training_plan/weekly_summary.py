"""How the week went, in numbers anyone can recount.

Consistency is the product's main metric (`BRAINSTORM-miglioramenti-e-gamification.md`
§0.2), and this is where it is looked back at: what was planned, what was done, how it
felt, whether the habit is holding. Pure: the route reads the rows, this builds the
answer, and every figure in it is a count over those rows.

Two choices worth knowing:

- **Planned days trained, not sessions matched.** A session moved or swapped still counts
  if the day was trained -- matching titles would punish the flexibility the app promises
  (§0.5).
- **The streak is `progress`'s**: on the history, not the plan (a user with no plan
  builds the habit too), protected by salva-serie tokens and by reported pain, and the
  week in progress only joins it once it is active.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import date as date_type
from datetime import timedelta
from typing import TYPE_CHECKING, Sequence

from .checkin import CheckIn
from .levels import ACTIVE_WEEK_SESSIONS
from .plan_skeleton import SkeletonWeek

if TYPE_CHECKING:
    from .levels import DayTraining

MAX_HIGHLIGHTS = 4
# How far back the streak is counted.
STREAK_WEEKS = 52

_DAY_NAMES = ("lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica")


def monday_of(day: date_type) -> date_type:
    return day - timedelta(days=day.weekday())


def default_monday(today: date_type) -> date_type:
    """Monday to Wednesday the finished week is the interesting one; later, this one."""
    this_week = monday_of(today)
    return this_week - timedelta(weeks=1) if today.weekday() <= 2 else this_week


@dataclass
class PainDay:
    date: date_type
    area: str | None


@dataclass
class NextWeek:
    monday: date_type
    planned_sessions: int
    planned_minutes: int
    reason: str | None = None


@dataclass
class WeekSummary:
    monday: date_type
    sunday: date_type
    complete: bool
    planned_sessions: int
    planned_minutes: int
    # None without a plan for the week: "no plan" is not "zero of zero".
    planned_days_trained: int | None
    planned_days: int
    done_sessions: int
    done_minutes: int
    days_trained: int
    streak_weeks: int
    checkin_days: int
    efforts: dict[str, int] = field(default_factory=dict)
    tired_days: list[date_type] = field(default_factory=list)
    pain_days: list[PainDay] = field(default_factory=list)
    next_week: NextWeek | None = None
    headline: str = ""
    highlights: list[str] = field(default_factory=list)
    # From `progress`: the week's Disciplina points, their lines, and badges earned in it.
    week_points: int = 0
    point_lines: list[str] = field(default_factory=list)
    badges: list[str] = field(default_factory=list)
    # Food: days with something logged, and days under the carbohydrate range the day
    # before a hard or long session.
    food_days: int = 0
    carb_short_days: list[date_type] = field(default_factory=list)


def _week_days(days: Sequence["DayTraining"], monday: date_type) -> list["DayTraining"]:
    return [d for d in days if monday <= d.day <= monday + timedelta(days=6)]


def _planned_minutes(session: dict) -> float:
    from .models import session_duration_minutes
    from .plan_generator import session_from_dict

    return session_duration_minutes(session_from_dict(session)) if session["sport"] == "running" else 0.0


def _day(day: date_type) -> str:
    return _DAY_NAMES[day.weekday()]


def build_summary(
    *,
    monday: date_type,
    today: date_type,
    planned: Sequence[dict],
    days: Sequence["DayTraining"],
    checkins: Sequence[CheckIn],
    skeleton: Sequence[SkeletonWeek] = (),
    reached_level: int = 1,
    all_checkins: Sequence[CheckIn] | None = None,
    food_days: int = 0,
    carb_short_days: Sequence[date_type] = (),
) -> WeekSummary:
    """`all_checkins` spans the streak's weeks (pain protects a week), `checkins` this one."""
    from . import progress

    streak_weeks, lines, badges, points = progress.summary_of_week(
        monday=monday,
        today=today,
        days=days,
        planned=planned,
        checkins=all_checkins if all_checkins is not None else checkins,
        reached_level=reached_level,
    )
    sunday = monday + timedelta(days=6)
    in_week = [s for s in planned if monday.isoformat() <= s["date"] <= sunday.isoformat()]
    week_days = _week_days(days, monday)
    trained = {d.day for d in week_days if d.sessions > 0}
    planned_days = {date_type.fromisoformat(s["date"]) for s in in_week}
    week_checkins = [c for c in checkins if monday <= c.date <= sunday]

    next_monday = monday + timedelta(weeks=1)
    next_planned = [s for s in planned if next_monday.isoformat() <= s["date"] <= (next_monday + timedelta(days=6)).isoformat()]
    next_skeleton = next((w for w in skeleton if w.monday == next_monday), None)

    summary = WeekSummary(
        monday=monday,
        sunday=sunday,
        complete=sunday < today,
        planned_sessions=len(in_week),
        planned_minutes=round(sum(_planned_minutes(s) for s in in_week)),
        planned_days_trained=len(planned_days & trained) if in_week else None,
        planned_days=len(planned_days),
        done_sessions=sum(d.sessions for d in week_days),
        done_minutes=round(sum(d.run_minutes for d in week_days)),
        days_trained=len(trained),
        streak_weeks=streak_weeks,
        week_points=points,
        point_lines=[f"{'+' if line.points > 0 else ''}{line.points} {line.reason}" for line in lines],
        badges=[badge.title for badge in badges],
        food_days=food_days,
        carb_short_days=sorted(carb_short_days),
        checkin_days=len(week_checkins),
        efforts=dict(Counter(c.effort for c in week_checkins if c.effort)),
        tired_days=[c.date for c in week_checkins if c.body == "stanco"],
        pain_days=[PainDay(c.date, c.pain_area) for c in week_checkins if c.body == "dolore"],
        next_week=NextWeek(
            monday=next_monday,
            planned_sessions=len(next_planned),
            planned_minutes=round(sum(_planned_minutes(s) for s in next_planned)),
            reason=next_skeleton.reason if next_skeleton else None,
        )
        if next_planned or next_skeleton
        else None,
    )
    summary.headline = _headline(summary)
    summary.highlights = _highlights(summary)
    return summary


def _headline(s: WeekSummary) -> str:
    when = "Questa settimana" if not s.complete else "La settimana"
    if s.done_sessions == 0:
        return f"{when} nessun allenamento registrato." if s.complete else "Settimana ancora da iniziare."
    if s.planned_days_trained is not None and s.planned_days:
        return f"{when}: {s.planned_days_trained} giorni su {s.planned_days} del piano, {s.done_minutes} minuti di corsa."
    return f"{when}: {s.done_sessions} {'allenamento' if s.done_sessions == 1 else 'allenamenti'}, {s.done_minutes} minuti di corsa."


def _highlights(s: WeekSummary) -> list[str]:
    """Health first, then the habit, then the plan, then how it felt."""
    from .checkin import AREA_PHRASES

    out: list[str] = []
    for pain in s.pain_days:
        area = AREA_PHRASES.get(pain.area or "altro", "")
        out.append(" ".join(f"Dolore {area} {_day(pain.date)}: se torna, la seduta dura dopo va alleggerita.".split()))
    if s.streak_weeks >= 2:
        out.append(f"{s.streak_weeks}ª settimana di fila con almeno {ACTIVE_WEEK_SESSIONS} allenamenti.")
    elif s.streak_weeks == 1:
        out.append(f"Settimana attiva: almeno {ACTIVE_WEEK_SESSIONS} allenamenti. La serie comincia qui.")
    if s.planned_days_trained is not None and s.planned_days:
        missed = s.planned_days - s.planned_days_trained
        if missed == 0 and s.complete:
            out.append(f"Tutti i {s.planned_days} giorni del piano fatti.")
        elif missed > 0 and s.complete:
            out.append(f"{s.planned_days_trained} giorni su {s.planned_days} del piano: {missed} saltati.")
    hard = s.efforts.get("dura", 0) + s.efforts.get("troppo", 0)
    easy = s.efforts.get("facile", 0) + s.efforts.get("giusta", 0)
    if s.efforts.get("troppo"):
        out.append(f"{s.efforts['troppo']} {'seduta' if s.efforts['troppo'] == 1 else 'sedute'} troppo dure secondo te.")
    elif hard or easy:
        out.append(f"Sensazioni: {easy} sedute facili o giuste, {hard} dure.")
    if s.carb_short_days:
        named = ", ".join(_day(d) for d in s.carb_short_days)
        out.append(f"Carboidrati sotto il range {named}, il giorno prima di una seduta dura.")
    if len(s.tired_days) >= 2:
        out.append(f"Stanchezza segnalata {len(s.tired_days)} giorni.")
    return out[:MAX_HIGHLIGHTS]


def facts(s: WeekSummary) -> dict:
    """What the model may phrase: the figures and the highlights, nothing else."""
    return {
        "settimana_completa": s.complete,
        "sedute_pianificate": s.planned_sessions,
        "giorni_del_piano_allenati": s.planned_days_trained,
        "giorni_del_piano": s.planned_days,
        "allenamenti_fatti": s.done_sessions,
        "minuti_di_corsa": s.done_minutes,
        "settimane_attive_di_fila": s.streak_weeks,
        "sensazioni": s.efforts,
        "giorni_con_dolore": [{"giorno": _day(p.date), "zona": p.area} for p in s.pain_days],
        "punti": s.highlights,
        "prossima_settimana": s.next_week.reason if s.next_week else None,
        "giorni_con_cibo_registrato": s.food_days,
        "carboidrati_bassi_prima_di_seduta_dura": [_day(d) for d in s.carb_short_days],
    }
