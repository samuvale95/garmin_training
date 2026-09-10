"""Does the plan you already have go where the race is?

The question this answers is the one a runner asks the moment they name a goal: *these
sessions I already wrote — do they add up to that race?* Nothing needs re-importing and
nothing is rewritten; the sessions that were already there are read again, this time
against a date and a distance.

Same rule as everywhere else in this app (`PLAN-analisi-dati.md`): **every figure here is
arithmetic over the plan file, reproducible by hand.** The observations below are
comparisons against rules of thumb that are stated in the output, not hidden coaching
opinion — "il tuo lungo più lungo è 24 km, per una maratona di solito se ne fa almeno
30" is checkable and arguable. A language model may phrase the result
(`llm.write_goal_fit_narrative`); it never produces a number and never reaches a
different conclusion.

The honest failure mode, and it is common: a calendar pulled from Garmin carries only
dates and titles, with no steps at all. Kilometres are then unknowable, and every
distance-based observation is skipped and *said to be skipped* rather than computed from
zeros -- which would report a plan of 0 km and call it thin.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date as date_type
from datetime import timedelta

from .models import (
    RaceGoal,
    TrainingSession,
    days_to_race,
    flatten_steps,
    race_phase,
    session_distance_km,
    weeks_to_race,
)

# The longest single run a plan for each distance usually builds to, in km, and the
# tolerance below it that still counts as "there". Rules of thumb, not physiology: they
# are shown to the user as such, with the number, so they can be argued with.
LONGEST_RUN_GUIDE = [
    (42.0, 30.0),  # marathon
    (21.0, 18.0),  # half
    (10.0, 12.0),  # 10k -- the long run is longer than the race
    (5.0, 8.0),
]
LONGEST_RUN_TOLERANCE = 0.9

# A plan that stops more than this many days before the race leaves a hole nobody
# planned; inside it, the last sessions are simply the taper.
COVERAGE_GAP_DAYS = 10

# Weekly volume growth above this is the classic too-much-too-soon flag.
WEEKLY_RAMP_LIMIT = 0.12

# Race week above this share of the peak week is not a taper.
TAPER_FRACTION = 0.8

SEVERITY_OK = "ok"
SEVERITY_WATCH = "attenzione"
SEVERITY_UNKNOWN = "sconosciuto"

ALIGNMENT_ON_TRACK = "in linea"
ALIGNMENT_WATCH = "da guardare"
ALIGNMENT_SHORT = "non arriva"
ALIGNMENT_UNKNOWN = "non valutabile"


@dataclass
class Observation:
    """One comparison, with both numbers in it -- what the plan says, and what it was
    compared against."""

    key: str
    label: str
    detail: str
    severity: str


@dataclass
class WeekVolume:
    week_start: date_type
    km: float
    sessions: int


@dataclass
class GoalFit:
    race_date: date_type
    days_to_race: int
    phase: str
    alignment: str
    headline: str
    observations: list[Observation] = field(default_factory=list)
    # Everything below is the arithmetic the observations are made of, exposed so the
    # screen can show the same figures the verdict was built from.
    sessions_ahead: int = 0
    weeks_covered: int = 0
    last_session_date: date_type | None = None
    longest_run_km: float | None = None
    longest_run_date: date_type | None = None
    longest_run_guide_km: float | None = None
    peak_week_km: float | None = None
    weekly_volume: list[WeekVolume] = field(default_factory=list)
    quality_sessions: int = 0
    # How many of the sessions ahead carry no steps -- i.e. how much of the above is
    # blind. Anything above zero is stated on screen.
    sessions_without_detail: int = 0


def _days_label(days: int) -> str:
    return "1 giorno" if days == 1 else f"{days} giorni"


def _longest_run_guide(distance_km: float) -> float | None:
    for race_km, guide_km in LONGEST_RUN_GUIDE:
        if distance_km >= race_km * 0.95:
            return guide_km
    return None


def _week_start(day: date_type) -> date_type:
    return day - timedelta(days=day.weekday())


def _is_quality(session: TrainingSession) -> bool:
    """More than one hard effort in a session is repetition work. One continuous effort
    -- however long -- is not: that is a long run, and it is counted as volume."""
    from .models import RepeatBlock  # local: avoids a cycle-shaped import at module load

    steps = session.steps or []
    if any(isinstance(item, RepeatBlock) for item in steps):
        return True
    return len([s for s in flatten_steps(steps) if s.type == "interval"]) > 1


def assess_plan_fit(
    sessions: list[TrainingSession],
    goal: RaceGoal,
    today: date_type | None = None,
) -> GoalFit:
    """Read the sessions that already exist against a race that has just been named.

    Only the sessions from today to the race are judged: what was run in July is history
    and cannot be changed by naming a goal today, and counting it would flatter or damn a
    plan for weeks nobody is going to run again.
    """
    day = today or date_type.today()
    left = days_to_race(goal, day)
    phase = race_phase(goal, day)

    ahead = sorted(
        (s for s in sessions if day <= s.date <= goal.race_date),
        key=lambda s: s.date,
    )
    running_ahead = [s for s in ahead if s.sport == "running"]
    without_detail = sum(1 for s in ahead if not s.steps)
    has_detail = len(ahead) > without_detail

    # Weekly volume, weeks with nothing included: a gap week is information.
    by_week: dict[date_type, WeekVolume] = {}
    for session in ahead:
        start = _week_start(session.date)
        bucket = by_week.setdefault(start, WeekVolume(week_start=start, km=0.0, sessions=0))
        bucket.km += session_distance_km(session)
        bucket.sessions += 1
    weekly = [by_week[key] for key in sorted(by_week)]

    longest = max(running_ahead, key=session_distance_km, default=None)
    longest_km = session_distance_km(longest) if longest and has_detail else None
    guide_km = _longest_run_guide(goal.distance_km)
    peak_km = max((w.km for w in weekly), default=0.0) if has_detail else None
    quality = sum(1 for s in ahead if _is_quality(s))
    last_date = max((s.date for s in sessions), default=None)

    observations: list[Observation] = []

    # --- does the plan reach the race at all ---
    if left < 0:
        observations.append(
            Observation(
                key="passata",
                label="La gara è passata",
                detail=f"era il {goal.race_date.isoformat()}",
                severity=SEVERITY_UNKNOWN,
            )
        )
    elif not ahead:
        observations.append(
            Observation(
                key="copertura",
                label="Nessuna seduta fra oggi e la gara",
                detail=f"mancano {left} giorni e il piano non copre nessuno di questi",
                severity=SEVERITY_WATCH,
            )
        )
    else:
        gap = (goal.race_date - ahead[-1].date).days
        if gap > COVERAGE_GAP_DAYS:
            observations.append(
                Observation(
                    key="copertura",
                    label="Il piano finisce prima della gara",
                    detail=f"ultima seduta il {ahead[-1].date.isoformat()}, {_days_label(gap)} prima",
                    severity=SEVERITY_WATCH,
                )
            )
        else:
            observations.append(
                Observation(
                    key="copertura",
                    label="Il piano arriva alla gara",
                    detail=f"{len(ahead)} sedute in {len(weekly)} settimane, fino a {_days_label(gap)} dal via",
                    severity=SEVERITY_OK,
                )
            )

    # --- the long run ---
    if guide_km is None or not has_detail:
        if ahead and not has_detail:
            observations.append(
                Observation(
                    key="dettaglio",
                    label="Sedute senza dettaglio",
                    detail=f"{without_detail} sedute arrivano dal calendario senza passi: i chilometri non li so",
                    severity=SEVERITY_UNKNOWN,
                )
            )
    elif longest_km is not None and guide_km is not None:
        if longest_km >= guide_km * LONGEST_RUN_TOLERANCE:
            observations.append(
                Observation(
                    key="lungo",
                    label="Il lungo ci sta",
                    detail=f"il più lungo in programma è {longest_km:.0f} km, per questa distanza se ne fanno almeno {guide_km:.0f}",
                    severity=SEVERITY_OK,
                )
            )
        else:
            observations.append(
                Observation(
                    key="lungo",
                    label="Il lungo è corto per la distanza",
                    detail=f"il più lungo in programma è {longest_km:.0f} km, per questa distanza se ne fanno almeno {guide_km:.0f}",
                    severity=SEVERITY_WATCH,
                )
            )

    # --- how fast the volume grows ---
    if has_detail and len(weekly) >= 3:
        # Compared over the whole stretch rather than week to week: a single big week
        # inside an otherwise flat block is a long run, not a ramp.
        first, last = weekly[0].km, weekly[-1].km
        span = len(weekly) - 1
        if first > 0 and span > 0:
            weekly_growth = (last / first) ** (1 / span) - 1
            if weekly_growth > WEEKLY_RAMP_LIMIT:
                observations.append(
                    Observation(
                        key="crescita",
                        label="Il volume sale in fretta",
                        detail=f"da {first:.0f} a {last:.0f} km a settimana, +{weekly_growth * 100:.0f}% a settimana",
                        severity=SEVERITY_WATCH,
                    )
                )

    # --- quality work, and only when the goal names a time *and* the steps are
    # readable: a Garmin calendar entry may well be a set of repetitions, and saying
    # "there is no quality work" about sessions whose contents are invisible is a claim
    # about data this function does not have.
    if goal.target_time_seconds is not None and ahead and has_detail and quality == 0:
        observations.append(
            Observation(
                key="qualita",
                label="Nessuna seduta di qualità",
                detail="hai un tempo obiettivo, ma da qui alla gara non ci sono ripetute in programma",
                severity=SEVERITY_WATCH,
            )
        )

    # --- the taper ---
    #
    # The seven days before the race, not the last calendar bucket. A race on a Thursday
    # leaves a three-day final "week", which is a taper by arithmetic and by nothing
    # else -- that bug made a plan running flat into race day look perfectly tapered.
    if has_detail and len(weekly) >= 3 and peak_km:
        final_week = sum(
            session_distance_km(s) for s in ahead if goal.race_date - timedelta(days=7) <= s.date < goal.race_date
        )
        if final_week > peak_km * TAPER_FRACTION:
            observations.append(
                Observation(
                    key="scarico",
                    label="Manca lo scarico",
                    detail=f"nei 7 giorni prima della gara ci sono {final_week:.0f} km, contro un picco di {peak_km:.0f}",
                    severity=SEVERITY_WATCH,
                )
            )

    alignment, headline = _summarise(observations, left)

    return GoalFit(
        race_date=goal.race_date,
        days_to_race=left,
        phase=phase,
        alignment=alignment,
        headline=headline,
        observations=observations,
        sessions_ahead=len(ahead),
        weeks_covered=len(weekly),
        last_session_date=last_date,
        longest_run_km=longest_km,
        longest_run_date=longest.date if longest and longest_km is not None else None,
        longest_run_guide_km=guide_km,
        peak_week_km=peak_km,
        weekly_volume=weekly,
        quality_sessions=quality,
        sessions_without_detail=without_detail,
    )


def _summarise(observations: list[Observation], days_left: int) -> tuple[str, str]:
    if days_left < 0:
        return ALIGNMENT_UNKNOWN, "La gara è passata"

    watch = [o for o in observations if o.severity == SEVERITY_WATCH]
    coverage = next((o for o in observations if o.key == "copertura"), None)

    if coverage and coverage.severity == SEVERITY_WATCH:
        return ALIGNMENT_SHORT, "Il piano non arriva alla gara"
    if not watch:
        if any(o.severity == SEVERITY_UNKNOWN for o in observations):
            return ALIGNMENT_UNKNOWN, "Quello che vedo è in linea"
        return ALIGNMENT_ON_TRACK, "Il piano che hai va verso questa gara"
    if len(watch) == 1:
        return ALIGNMENT_WATCH, "Una cosa da guardare"
    return ALIGNMENT_WATCH, f"{len(watch)} cose da guardare"


def fit_facts(fit: GoalFit, goal: RaceGoal) -> dict:
    """The already-decided dict the model is allowed to phrase. No plan contents, no
    identifiers -- the conclusion is settled before this is built."""
    facts: dict = {
        "gara_fra_giorni": fit.days_to_race,
        "gara_settimane": round(weeks_to_race(goal, fit.race_date - timedelta(days=fit.days_to_race)), 1),
        "distanza_km": round(goal.distance_km, 1),
        "fase": fit.phase,
        "giudizio": fit.alignment,
        "sedute_da_qui_alla_gara": fit.sessions_ahead,
        "settimane_coperte": fit.weeks_covered,
        "osservazioni": [{"cosa": o.label, "misura": o.detail, "peso": o.severity} for o in fit.observations],
    }
    if goal.target_time_seconds is not None:
        facts["tempo_obiettivo_secondi"] = goal.target_time_seconds
    if fit.longest_run_km is not None:
        facts["lungo_massimo_km"] = round(fit.longest_run_km, 1)
    if fit.peak_week_km is not None:
        facts["settimana_di_picco_km"] = round(fit.peak_week_km, 1)
    return facts
