"""The limits a plan must respect, whoever wrote it.

The AI plan (phase 2) chooses sessions; this module decides whether a set of them is
safe for this user. The split is the product's rule (`BRAINSTORM-miglioramenti-e-
gamification.md` §0.4): the model proposes, the code sets and checks the boundaries, so a
plan reaches the user only if it passes here -- whatever the model wrote.

The same rules, filtered to `warn_on_move`, are what a user moving a session should be
warned about (§0.5). That filter is where honesty lives: a warning that fires on folk
wisdom stops being read, and then it protects nobody. So every rule carries its evidence,
and only rules with more than `prudenza` behind them can ever warn.

Everything is read from the sessions' *structure* -- sport, duration, repeat blocks,
paces -- never from a title or a label, because the thing being checked is a model's
output and a label is exactly what a model gets wrong.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date as date_type
from datetime import timedelta
from typing import TYPE_CHECKING, Sequence

from .models import RepeatBlock, Step, TrainingSession, avg_pace_sec_per_km, flatten_steps, session_duration_minutes
from .models import session_fallback_pace, step_duration_minutes
from .nutrition import QUALITY_PACE_DELTA_SEC_PER_KM, has_quality_work

if TYPE_CHECKING:
    from .levels import DayTraining

RUNNING = "running"
STRENGTH = "strength_training"

# A continuous run this long is a long run: the same line `readiness` draws.
LONG_RUN_MINUTES = 90
# Fast work below this is strides, not a workout.
MIN_QUALITY_MINUTES = 5

KIND_EASY = "facile"
KIND_LONG = "lungo"
KIND_QUALITY = "qualità"
KIND_STRENGTH = "forza"
KIND_OTHER = "altro"
HARD_KINDS = (KIND_LONG, KIND_QUALITY)

EVIDENCE_RESEARCH = "ricerca"
EVIDENCE_CONSENSUS = "consenso"
EVIDENCE_CAUTION = "prudenza"


@dataclass(frozen=True)
class Rule:
    key: str
    evidence: str
    warn_on_move: bool
    # Threshold per effective level 1, 2, 3.
    limits: tuple[float, float, float]

    def limit(self, level: int) -> float:
        return self.limits[max(1, min(3, level)) - 1]


# The table of design.md decision #2. `hard_after_long` uses 1 for "not allowed" and 0 for
# "allowed". `warn_on_move` is never true for `prudenza`.
RULES: dict[str, Rule] = {
    rule.key: rule
    for rule in (
        # The 10%-a-week rule has little evidence behind it: a sensible brake for a
        # generator, not something to alarm a user with.
        Rule("volume_growth", EVIDENCE_CAUTION, False, (0.10, 0.15, 0.20)),
        Rule("hard_in_a_row", EVIDENCE_CONSENSUS, True, (1, 2, 2)),
        Rule("hard_after_long", EVIDENCE_CONSENSUS, True, (1, 1, 0)),
        Rule("hard_per_week", EVIDENCE_CONSENSUS, True, (1, 2, 3)),
        Rule("rest_days", EVIDENCE_CONSENSUS, False, (2, 1, 1)),
        Rule("easy_share", EVIDENCE_RESEARCH, False, (0.90, 0.80, 0.75)),
        Rule("long_run_growth", EVIDENCE_CAUTION, False, (0.15, 0.15, 0.15)),
        Rule("deload", EVIDENCE_CONSENSUS, False, (0.80, 0.80, 0.85)),
    )
}

# What a user with too little recent running may be given anyway, per level: a first
# week has to be possible for someone with no history at all.
VOLUME_ALLOWANCE = (90, 150, 240)
LONG_RUN_ALLOWANCE = (45, 70, 100)
# The smallest step up the growth rules allow, so a tiny base can grow at all.
MIN_VOLUME_STEP = 20
MIN_LONG_RUN_STEP = 10
# Below this much running in a window there is nothing to take a share of.
MIN_MINUTES_FOR_SHARE = 60
# Weeks of rising volume after which the next must be lighter.
BUILD_WEEKS = 3


@dataclass
class RuleContext:
    effective_level: int
    # None when the history is too thin to compare against: the allowances apply.
    recent_weekly_minutes: float | None
    recent_longest_run: float | None
    today: date_type


@dataclass
class Violation:
    key: str
    message: str
    measured: float
    limit: float
    level: int
    evidence: str
    warn_on_move: bool
    sessions: list[str] = field(default_factory=list)
    dates: list[date_type] = field(default_factory=list)


@dataclass
class _Planned:
    session: TrainingSession
    ref: str  # the id when the session has one, else its date
    kind: str
    minutes: float
    easy_minutes: float


# ---- one session -------------------------------------------------------------------------


def _hard_minutes(session: TrainingSession) -> float:
    """Minutes of work meaningfully faster than the session's own easy pace, or unpaced
    efforts -- the raw count, before deciding whether they make the session hard."""
    steps = flatten_steps(session.steps)
    easy_pace = session_fallback_pace(steps)
    return sum(step_duration_minutes(step, easy_pace) for step in steps if _is_hard_step(step, easy_pace))


def session_kind(session: TrainingSession) -> str:
    if session.sport == STRENGTH:
        return KIND_STRENGTH
    if session.sport != RUNNING:
        return KIND_OTHER
    # A few strides at the end of an easy run are not a quality session: counting them as
    # one made a plan's easy Tuesday a third hard day. It takes a repeat block or enough
    # minutes of real work.
    if any(isinstance(step, RepeatBlock) for step in session.steps) or (
        has_quality_work(session) and _hard_minutes(session) >= MIN_QUALITY_MINUTES
    ):
        return KIND_QUALITY
    if session_duration_minutes(session) >= LONG_RUN_MINUTES:
        return KIND_LONG
    return KIND_EASY


def easy_and_hard_minutes(session: TrainingSession) -> tuple[float, float]:
    """Planned minutes at easy and at hard intensity, step by step.

    Only a `qualità` session has hard minutes, and only in its working steps: a normal
    interval session is mostly warm-up, jog recoveries and cool-down, and counting all
    of it as hard would make every polarized plan look like a grey-zone one.
    """
    steps = flatten_steps(session.steps)
    total = sum(step_duration_minutes(step, session_fallback_pace(steps)) for step in steps)
    if session_kind(session) != KIND_QUALITY:
        return total, 0.0
    hard = _hard_minutes(session)
    return total - hard, hard


def _is_hard_step(step: Step, easy_pace: float | None) -> bool:
    if step.target_pace is not None and easy_pace is not None:
        return easy_pace - avg_pace_sec_per_km(step.target_pace) >= QUALITY_PACE_DELTA_SEC_PER_KM
    # An effort with no pace inside a quality session: the working part, unless proven easy.
    return step.type == "interval" and step.target_pace is None


# ---- weeks -------------------------------------------------------------------------------


def _monday(day: date_type) -> date_type:
    return day - timedelta(days=day.weekday())


def _prepare(sessions: Sequence[TrainingSession], ids: Sequence[str | None] | None) -> list[_Planned]:
    planned = []
    for index, session in enumerate(sessions):
        kind = session_kind(session)
        running = session.sport == RUNNING
        easy, hard = easy_and_hard_minutes(session) if running else (0.0, 0.0)
        ref = (ids[index] if ids and ids[index] else None) or session.date.isoformat()
        planned.append(_Planned(session, ref, kind, easy + hard if running else 0.0, easy))
    return sorted(planned, key=lambda p: p.session.date)


def _weeks(planned: list[_Planned]) -> dict[date_type, list[_Planned]]:
    weeks: dict[date_type, list[_Planned]] = {}
    for item in planned:
        weeks.setdefault(_monday(item.session.date), []).append(item)
    return dict(sorted(weeks.items()))


def _week_minutes(items: list[_Planned]) -> float:
    return sum(item.minutes for item in items)


def _v(key: str, level: int, message: str, measured: float, limit: float, items: list[_Planned]) -> Violation:
    rule = RULES[key]
    return Violation(
        key=key,
        message=message,
        measured=round(measured, 3),
        limit=round(limit, 3),
        level=level,
        evidence=rule.evidence,
        warn_on_move=rule.warn_on_move,
        sessions=[item.ref for item in items],
        dates=[item.session.date for item in items],
    )


def _fmt_day(day: date_type) -> str:
    names = ("lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica")
    return f"{names[day.weekday()]} {day.day}"


# ---- the rules ---------------------------------------------------------------------------


def volume_limit(base: float | None, ctx: RuleContext) -> tuple[float, str]:
    """The most running minutes a week may hold over `base`, and where the limit comes from.

    Public because the generator sizes its week targets with the same function the
    validator checks them with: two copies of this arithmetic would drift apart.
    """
    level = ctx.effective_level
    growth = RULES["volume_growth"].limit(level)
    allowance = VOLUME_ALLOWANCE[level - 1]
    if base is None:
        return allowance, f"il massimo per iniziare al livello {level}"
    limit = max(base * (1 + growth), base + MIN_VOLUME_STEP)
    if ctx.recent_weekly_minutes is None:
        limit = max(limit, allowance)
    return limit, f"+{round(growth * 100)}% su {round(base)} minuti, livello {level}"


def volume_base(ctx: RuleContext, earlier: dict[date_type, float], monday: date_type) -> float | None:
    """What a week's volume is compared against: the recent average, or the highest of
    the planned weeks in the three before it when that is higher.

    The highest, not the last: after a lighter week the plan has to be able to return to
    where it was, and comparing to the lighter week alone made that return a violation.
    It does not compound: each week still grows only by the limit over a week already
    planned.
    """
    recent = [
        minutes
        for week, minutes in earlier.items()
        if monday - timedelta(weeks=BUILD_WEEKS) <= week < monday and minutes > 0
    ]
    return max(filter(None, (*recent, ctx.recent_weekly_minutes)), default=None)


def _volume_growth(weeks, ctx: RuleContext) -> list[Violation]:
    level = ctx.effective_level
    out = []
    earlier: dict[date_type, float] = {}
    for monday, items in weeks.items():
        minutes = _week_minutes(items)
        limit, origin = volume_limit(volume_base(ctx, earlier, monday), ctx)
        if minutes > limit:
            out.append(
                _v(
                    "volume_growth",
                    level,
                    f"La settimana del {_fmt_day(monday)} ha {round(minutes)} minuti di corsa: "
                    f"il limite è {round(limit)} ({origin}).",
                    minutes,
                    limit,
                    items,
                )
            )
        earlier[monday] = minutes
    return out


def _hard_per_week(weeks, ctx: RuleContext) -> list[Violation]:
    level = ctx.effective_level
    limit = RULES["hard_per_week"].limit(level)
    out = []
    for monday, items in weeks.items():
        hard = [item for item in items if item.kind in HARD_KINDS]
        if len(hard) > limit:
            out.append(
                _v(
                    "hard_per_week",
                    level,
                    f"La settimana del {_fmt_day(monday)} ha {len(hard)} sedute dure: al livello {level} "
                    f"il massimo è {int(limit)}.",
                    len(hard),
                    limit,
                    hard,
                )
            )
    return out


def _rest_days(weeks, ctx: RuleContext, start: date_type, end: date_type) -> list[Violation]:
    level = ctx.effective_level
    limit = RULES["rest_days"].limit(level)
    out = []
    for monday, items in weeks.items():
        if monday < start or monday + timedelta(days=6) > end:
            continue  # only weeks the window covers whole
        busy = {item.session.date for item in items}
        rest = 7 - len(busy)
        if rest < limit:
            out.append(
                _v(
                    "rest_days",
                    level,
                    f"La settimana del {_fmt_day(monday)} ha {rest} giorni senza allenamento: al livello "
                    f"{level} ne servono almeno {int(limit)}.",
                    rest,
                    limit,
                    items,
                )
            )
    return out


def _easy_share(planned, ctx: RuleContext) -> list[Violation]:
    level = ctx.effective_level
    limit = RULES["easy_share"].limit(level)
    running = [item for item in planned if item.minutes > 0]
    total = sum(item.minutes for item in running)
    if total < MIN_MINUTES_FOR_SHARE:
        return []
    share = sum(item.easy_minutes for item in running) / total
    if share >= limit:
        return []
    hard = [item for item in running if item.easy_minutes < item.minutes]
    return [
        _v(
            "easy_share",
            level,
            f"Solo il {round(share * 100)}% del tempo di corsa pianificato è facile: al livello {level} "
            f"il riferimento è almeno il {round(limit * 100)}%.",
            share,
            limit,
            hard,
        )
    ]


def long_run_limit(ctx: RuleContext) -> tuple[float, str]:
    """The longest run allowed, and where the limit comes from. Public for the generator."""
    level = ctx.effective_level
    if ctx.recent_longest_run is None:
        return LONG_RUN_ALLOWANCE[level - 1], f"il massimo per iniziare al livello {level}"
    growth = RULES["long_run_growth"].limit(level)
    limit = max(ctx.recent_longest_run * (1 + growth), ctx.recent_longest_run + MIN_LONG_RUN_STEP)
    return limit, (
        f"+{round(growth * 100)}% sul tuo lungo più lungo delle ultime 8 settimane, {round(ctx.recent_longest_run)} minuti"
    )


def _long_run_growth(planned, ctx: RuleContext) -> list[Violation]:
    running = [item for item in planned if item.minutes > 0]
    if not running:
        return []
    longest = max(running, key=lambda item: item.minutes)
    limit, origin = long_run_limit(ctx)
    if longest.minutes <= limit:
        return []
    return [
        _v(
            "long_run_growth",
            ctx.effective_level,
            f"La corsa di {_fmt_day(longest.session.date)} dura {round(longest.minutes)} minuti: il limite è "
            f"{round(limit)} ({origin}).",
            longest.minutes,
            limit,
            [longest],
        )
    ]


def _hard_days(planned) -> list[tuple[date_type, list[_Planned]]]:
    by_day: dict[date_type, list[_Planned]] = {}
    for item in planned:
        if item.kind in HARD_KINDS:
            by_day.setdefault(item.session.date, []).append(item)
    return sorted(by_day.items())


def _hard_in_a_row(planned, ctx: RuleContext) -> list[Violation]:
    level = ctx.effective_level
    limit = RULES["hard_in_a_row"].limit(level)
    out = []
    streak: list[tuple[date_type, list[_Planned]]] = []
    for day, items in _hard_days(planned) + [(None, [])]:
        if streak and day is not None and day - streak[-1][0] == timedelta(days=1):
            streak.append((day, items))
            continue
        if len(streak) > limit:
            involved = [item for _, day_items in streak for item in day_items]
            days = ", ".join(_fmt_day(d) for d, _ in streak)
            out.append(
                _v(
                    "hard_in_a_row",
                    level,
                    f"{len(streak)} giorni duri di fila ({days}): al livello {level} il massimo è {int(limit)}.",
                    len(streak),
                    limit,
                    involved,
                )
            )
        streak = [(day, items)] if day is not None else []
    return out


def _hard_after_long(planned, ctx: RuleContext) -> list[Violation]:
    level = ctx.effective_level
    if not RULES["hard_after_long"].limit(level):
        return []
    hard_by_day = dict(_hard_days(planned))
    out = []
    for item in planned:
        if item.kind != KIND_LONG:
            continue
        next_day = item.session.date + timedelta(days=1)
        for after in hard_by_day.get(next_day, []):
            out.append(
                _v(
                    "hard_after_long",
                    level,
                    f"Seduta dura {_fmt_day(next_day)}, il giorno dopo il lungo: al livello {level} serve un "
                    "giorno facile o di riposo in mezzo.",
                    1,
                    0,
                    [item, after],
                )
            )
    return out


def _deload(weeks, ctx: RuleContext, start: date_type, end: date_type) -> list[Violation]:
    level = ctx.effective_level
    ratio = RULES["deload"].limit(level)
    whole = [(monday, _week_minutes(items), items) for monday, items in weeks.items()
             if monday >= start and monday + timedelta(days=6) <= end]
    out = []
    for i in range(BUILD_WEEKS, len(whole)):
        building = [whole[j][1] for j in range(i - BUILD_WEEKS, i)]
        if all(building[k] < building[k + 1] for k in range(BUILD_WEEKS - 1)):
            limit = building[-1] * ratio
            monday, minutes, items = whole[i]
            if minutes > limit:
                out.append(
                    _v(
                        "deload",
                        level,
                        f"Dopo {BUILD_WEEKS} settimane in crescita, quella del {_fmt_day(monday)} dovrebbe "
                        f"scendere ad al massimo {round(limit)} minuti; ne ha {round(minutes)}.",
                        minutes,
                        limit,
                        items,
                    )
                )
    return out


# ---- the whole thing ---------------------------------------------------------------------


def validate(
    sessions: Sequence[TrainingSession],
    context: RuleContext,
    *,
    ids: Sequence[str | None] | None = None,
    start: date_type | None = None,
    end: date_type | None = None,
    only_move_warnings: bool = False,
) -> list[Violation]:
    """Every rule `sessions` break for this user, in rule order.

    `start`/`end` bound the window; the rules about whole weeks (rest days, deload) look
    only at weeks it covers entirely. By default the window is the sessions' own span.
    """
    if not sessions:
        return []
    planned = _prepare(sessions, ids)
    start = start or planned[0].session.date
    end = end or planned[-1].session.date
    weeks = _weeks(planned)

    violations = [
        *_volume_growth(weeks, context),
        *_hard_in_a_row(planned, context),
        *_hard_after_long(planned, context),
        *_hard_per_week(weeks, context),
        *_rest_days(weeks, context, start, end),
        *_easy_share(planned, context),
        *_long_run_growth(planned, context),
        *_deload(weeks, context, start, end),
    ]
    if only_move_warnings:
        violations = [v for v in violations if v.warn_on_move]
    return violations


# ---- what the rules read from the history ------------------------------------------------

# How many complete weeks the "recent volume" averages, and how many of them must have had
# running for the average to mean anything.
RECENT_WEEKS = 4
MIN_WEEKS_WITH_RUNNING = 2
LONGEST_RUN_WEEKS = 8


def context_from_days(
    days: Sequence["DayTraining"], *, today: date_type, effective_level: int, longest: float | None
) -> RuleContext:
    """Pure part of `build_context`: the recent weekly average from per-day totals."""
    this_week = _monday(today)
    weeks = [this_week - timedelta(weeks=k) for k in range(1, RECENT_WEEKS + 1)]
    minutes = {monday: 0.0 for monday in weeks}
    for day in days:
        monday = _monday(day.day)
        if monday in minutes:
            minutes[monday] += day.run_minutes
    with_running = sum(1 for value in minutes.values() if value > 0)
    recent = sum(minutes.values()) / RECENT_WEEKS if with_running >= MIN_WEEKS_WITH_RUNNING else None
    return RuleContext(
        effective_level=effective_level,
        recent_weekly_minutes=round(recent, 1) if recent is not None else None,
        recent_longest_run=longest,
        today=today,
    )


def gather_context(
    user_id: str, today: date_type, *, threshold_available: bool
) -> tuple[RuleContext, list["DayTraining"]]:
    """The rules' context, and the per-day totals it was read from (the generator needs
    both: the days also say how often, and what was already run this week)."""
    from . import history, intensity, levels  # local: history imports nothing from here

    level_days = [
        levels.DayTraining(**row)
        for row in history.daily_training(
            user_id,
            today - timedelta(days=levels.LOOKBACK_DAYS),
            today,
            running_sports=intensity.RUNNING_SPORTS,
            min_minutes=levels.MIN_SESSION_MINUTES,
        )
    ]
    profile = history.load_profile(user_id)
    assessment = levels.assess(
        level_days,
        today=today,
        threshold_available=threshold_available,
        reached_level=profile["reached_level"],
        adaptation_mode=profile["adaptation_mode"],
    )
    last_monday = _monday(today)
    longest = history.longest_run(
        user_id,
        last_monday - timedelta(weeks=LONGEST_RUN_WEEKS),
        last_monday - timedelta(days=1),
        running_sports=intensity.RUNNING_SPORTS,
    )
    context = context_from_days(level_days, today=today, effective_level=assessment.effective_level, longest=longest)
    return context, level_days


def build_context(user_id: str, today: date_type, *, threshold_available: bool) -> RuleContext:
    return gather_context(user_id, today, threshold_available=threshold_available)[0]
