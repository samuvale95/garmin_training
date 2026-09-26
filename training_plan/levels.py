"""Where a user is on the way from a first run to training like an athlete.

Three levels, and the app is meant to talk differently at each (see
`BRAINSTORM-miglioramenti-e-gamification.md` §0.3):

1. **abitudine** -- the goal is showing up. Sessions and minutes, nothing else.
2. **struttura** -- zones, easy against hard, a first plan towards a goal.
3. **atleta** -- polarization, thresholds, load: what `/coach` already does.

Rules decided with the product owner, and the reason for each:

- **Computed, never chosen.** A level is a claim about the history, so only the history
  sets it. A user arriving with two years on Garmin is classified straight from the
  backfill.
- **Never lowered.** Losing a level after an injury is exactly the moment an app should
  not add a demotion. Instead a long stop puts the user in *pausa*, then *ripresa*, and
  for that time the *effective* level -- what loads and warnings are sized for -- is one
  lower. The level itself stays.
- **Consistency counts every sport, structure needs running.** Tennis on Tuesday is
  showing up. But levels 2 and 3 are about zones anchored on a running threshold, so
  they also need runs with a heart rate.

Everything here is pure: the caller hands in per-day totals and gets back the level with
every criterion measured against what it requires, so the screen can say what is missing
rather than show a badge, and every rule is a unit test.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date as date_type
from datetime import timedelta
from typing import Sequence

# An activity shorter than this is not a session: a walk to the shop, a warm-up saved on
# its own. Long enough to exclude those, short enough that a real easy run always counts.
MIN_SESSION_MINUTES = 15

# A week with at least this many sessions is an active week. One session a week is
# something; two is a habit starting.
ACTIVE_WEEK_SESSIONS = 2

# Level 2: most recent weeks active, and enough running with a heart rate to have zones
# worth reading. Two months, because a habit that has lasted that long tends to stay.
LEVEL2_WINDOW_WEEKS = 8
LEVEL2_ACTIVE_WEEKS = 6
LEVEL2_RUNS_WITH_HR = 4

# Level 3: half a year of three-session weeks, a running volume where the distribution
# of intensity starts to matter, and a threshold to anchor the zones on. Strict on
# purpose: the level never goes down, so a bar set too low cannot be taken back.
LEVEL3_WINDOW_WEEKS = 26
LEVEL3_FULL_WEEK_SESSIONS = 3
LEVEL3_FULL_WEEKS = 20
LEVEL3_VOLUME_WINDOW_WEEKS = 12
LEVEL3_RUN_MINUTES_PER_WEEK = 150

# A stop long enough to need a way back in: four weeks with at most one session. The
# return lasts three weeks from the day the pause ends.
PAUSE_DAYS = 28
PAUSE_MAX_SESSIONS = 1
RETURN_DAYS = 21

# How far back the caller has to read for `assess` to see everything it uses.
LOOKBACK_DAYS = LEVEL3_WINDOW_WEEKS * 7 + 7 + PAUSE_DAYS + RETURN_DAYS

STATE_ACTIVE = "attivo"
STATE_PAUSE = "pausa"
STATE_RETURN = "ripresa"

MODE_AUTOMATIC = "automatico"
MODE_PROPOSAL = "proposta"
ADAPTATION_MODES = (MODE_AUTOMATIC, MODE_PROPOSAL)

LEVEL_NAMES = {1: "abitudine", 2: "struttura", 3: "atleta"}
LEVEL_MEANINGS = {
    1: "Conta presentarsi: sedute fatte e minuti, senza zone né numeri da interpretare.",
    2: "Arrivano le zone, la differenza fra facile e duro e un primo piano verso un obiettivo.",
    3: "Distribuzione dell'intensità, soglie e carico: ti leggiamo come un atleta.",
}


@dataclass
class DayTraining:
    """One day's totals, from canonical sessions of at least `MIN_SESSION_MINUTES`."""

    day: date_type
    sessions: int
    runs_with_hr: int
    run_minutes: float


@dataclass
class Criterion:
    key: str
    label: str
    measured: float
    required: float
    unit: str

    @property
    def met(self) -> bool:
        return self.measured >= self.required


@dataclass
class LevelAssessment:
    level: int
    computed_level: int
    effective_level: int
    state: str
    # The criteria of the current level ("what keeps you here" at level 3) and of the
    # next one. Level 1 has no criteria of its own; level 3 has no next.
    current: list[Criterion] = field(default_factory=list)
    next: list[Criterion] = field(default_factory=list)
    adaptation_mode: str = MODE_AUTOMATIC
    adaptation_mode_is_default: bool = True

    @property
    def name(self) -> str:
        return LEVEL_NAMES[self.level]

    @property
    def missing(self) -> list[str]:
        return [criterion.key for criterion in self.next if not criterion.met]


# ---- weeks ------------------------------------------------------------------------------


def _week_start(day: date_type) -> date_type:
    return day - timedelta(days=day.weekday())


def _complete_weeks(days: Sequence[DayTraining], today: date_type, count: int) -> list[list[DayTraining]]:
    """The last `count` complete Monday-to-Sunday weeks before this one, newest first."""
    this_week = _week_start(today)
    starts = [this_week - timedelta(weeks=k) for k in range(1, count + 1)]
    buckets: dict[date_type, list[DayTraining]] = {start: [] for start in starts}
    for day in days:
        start = _week_start(day.day)
        if start in buckets:
            buckets[start].append(day)
    return [buckets[start] for start in starts]


def _sessions(week: list[DayTraining]) -> int:
    return sum(day.sessions for day in week)


# ---- criteria ---------------------------------------------------------------------------


def level2_criteria(days: Sequence[DayTraining], today: date_type) -> list[Criterion]:
    weeks = _complete_weeks(days, today, LEVEL2_WINDOW_WEEKS)
    return [
        Criterion(
            key="settimane_attive",
            label=f"Settimane con almeno {ACTIVE_WEEK_SESSIONS} sedute, sulle ultime {LEVEL2_WINDOW_WEEKS}",
            measured=sum(1 for week in weeks if _sessions(week) >= ACTIVE_WEEK_SESSIONS),
            required=LEVEL2_ACTIVE_WEEKS,
            unit="settimane",
        ),
        Criterion(
            key="corse_con_cardio",
            label=f"Corse con la frequenza cardiaca, nelle ultime {LEVEL2_WINDOW_WEEKS} settimane",
            measured=sum(day.runs_with_hr for week in weeks for day in week),
            required=LEVEL2_RUNS_WITH_HR,
            unit="corse",
        ),
    ]


def level3_criteria(days: Sequence[DayTraining], today: date_type, *, threshold_available: bool) -> list[Criterion]:
    weeks = _complete_weeks(days, today, LEVEL3_WINDOW_WEEKS)
    volume_weeks = weeks[:LEVEL3_VOLUME_WINDOW_WEEKS]
    run_minutes = sum(day.run_minutes for week in volume_weeks for day in week)
    return [
        *level2_criteria(days, today),
        Criterion(
            key="settimane_piene",
            label=f"Settimane con almeno {LEVEL3_FULL_WEEK_SESSIONS} sedute, sulle ultime {LEVEL3_WINDOW_WEEKS}",
            measured=sum(1 for week in weeks if _sessions(week) >= LEVEL3_FULL_WEEK_SESSIONS),
            required=LEVEL3_FULL_WEEKS,
            unit="settimane",
        ),
        Criterion(
            key="minuti_di_corsa",
            label=f"Minuti di corsa a settimana, in media sulle ultime {LEVEL3_VOLUME_WINDOW_WEEKS}",
            measured=round(run_minutes / LEVEL3_VOLUME_WINDOW_WEEKS),
            required=LEVEL3_RUN_MINUTES_PER_WEEK,
            unit="minuti",
        ),
        Criterion(
            key="soglia",
            label="Frequenza di soglia stimata da Garmin",
            measured=1 if threshold_available else 0,
            required=1,
            unit="",
        ),
    ]


# ---- pause and return -------------------------------------------------------------------


def training_state(days: Sequence[DayTraining], today: date_type) -> str:
    """`pausa`, `ripresa` or `attivo`.

    A day is *in pause* when the `PAUSE_DAYS` ending on it hold at most
    `PAUSE_MAX_SESSIONS` sessions and there was training before them -- a brand-new user
    with nothing before this month is starting, not pausing. The return is the
    `RETURN_DAYS` after the last day in pause.

    Defined on days rather than on "the first session back" because that one is
    ambiguous: with one session allowed inside a pause, the second session back also has
    a quiet month behind it, and the return would never end.
    """
    by_day = {day.day: day.sessions for day in days if day.sessions > 0}
    if not by_day:
        return STATE_ACTIVE
    first_session = min(by_day)

    def in_pause(day: date_type) -> bool:
        window_start = day - timedelta(days=PAUSE_DAYS - 1)
        if first_session >= window_start:
            return False
        held = sum(count for d, count in by_day.items() if window_start <= d <= day)
        return held <= PAUSE_MAX_SESSIONS

    if in_pause(today):
        return STATE_PAUSE
    if any(in_pause(today - timedelta(days=k)) for k in range(1, RETURN_DAYS + 1)):
        return STATE_RETURN
    return STATE_ACTIVE


# ---- the whole thing --------------------------------------------------------------------


def default_adaptation_mode(effective_level: int) -> str:
    """Automatic while the user is learning the ropes, a proposal once they have their own
    opinion about their training."""
    return MODE_PROPOSAL if effective_level >= 3 else MODE_AUTOMATIC


def assess(
    days: Sequence[DayTraining],
    *,
    today: date_type,
    threshold_available: bool,
    reached_level: int = 1,
    adaptation_mode: str | None = None,
) -> LevelAssessment:
    l2 = level2_criteria(days, today)
    l3 = level3_criteria(days, today, threshold_available=threshold_available)
    computed = 3 if all(c.met for c in l3) else 2 if all(c.met for c in l2) else 1
    level = max(reached_level, computed)

    state = training_state(days, today)
    effective = max(1, level - 1) if state != STATE_ACTIVE else level

    current = {1: [], 2: l2, 3: l3}[level]
    upcoming = {1: l2, 2: l3, 3: []}[level]

    return LevelAssessment(
        level=level,
        computed_level=computed,
        effective_level=effective,
        state=state,
        current=current,
        next=upcoming,
        adaptation_mode=adaptation_mode or default_adaptation_mode(effective),
        adaptation_mode_is_default=adaptation_mode is None,
    )
