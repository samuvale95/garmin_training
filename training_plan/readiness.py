"""Is today a day to train, and if not, what instead.

The rule this module lives by is `PLAN-analisi-dati.md`'s: **every number here is
deterministic and reproducible by hand**. Each signal below is one comparison against
one threshold, and the verdict is a count of those signals -- so a user who disagrees
can see exactly which measurement produced the answer, and check it against their watch.
A language model is allowed to phrase the result (`llm.write_readiness_narrative`) and
nothing else.

Three things get decided, in order:

1. **How the body reads this morning** -- from sleep, HRV against its own 7-day
   baseline, resting heart rate against its own 7-day average, stress, body battery,
   Garmin's own readiness score, and the acute:chronic load ratio.
2. **What today's session asks for** -- repetitions and long runs are demanding in a way
   an easy 40 minutes is not, and the same tired morning means different things in front
   of each.
3. **What to do about it** -- and, when that is "not this", a concrete alternative that
   knows how far the race is: eight weeks out an easy day costs nothing, ten days out
   the taper is already the point, and a quality session in the last build week is worth
   moving rather than dropping.

Everything degrades. A snapshot with no overnight data produces `state="sconosciuto"`
and no verdict at all, because a guess dressed as a readout is worse than a blank.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date as date_type

from .models import (
    PHASE_PEAK,
    PHASE_TAPER,
    RaceGoal,
    RepeatBlock,
    TrainingSession,
    flatten_steps,
    race_phase,
    session_duration_minutes,
)

# ---- thresholds ----------------------------------------------------------------------
#
# Deliberately plain numbers, and deliberately conservative: these decide whether a
# person is told to skip a workout, and the cost of a false "you're fine" is higher than
# the cost of one unnecessary easy day.

# HRV against the mean of the preceding nights, as a fraction. Overnight HRV swings by a
# few percent for no reason at all; the literature's "meaningful" band starts around 10%.
HRV_DROP_MODERATE = -0.10
HRV_DROP_STRONG = -0.20
# At least this many nights of HRV before a baseline means anything.
HRV_MIN_NIGHTS = 3

# Resting heart rate above its own 7-day average, in bpm.
RHR_RISE_MODERATE = 3
RHR_RISE_STRONG = 6

# Sleep, in minutes.
SLEEP_SHORT = 6 * 60
SLEEP_VERY_SHORT = 5 * 60

# Garmin's own readiness score (0-100). It is a composite that already folds in sleep and
# HRV, so it is scored as one signal among several rather than as the answer.
READINESS_LOW = 55
READINESS_VERY_LOW = 40

# Average daytime stress (0-100) and body battery (0-100).
STRESS_HIGH = 60
BATTERY_LOW = 40

# Acute:chronic workload ratio. Outside this band is the classic overreaching flag.
ACWR_HIGH = 1.35
ACWR_VERY_HIGH = 1.5

# A run at or above this is a long one, whatever the plan calls it.
LONG_RUN_KM = 15.0
# ...and a session at or above this many minutes is a big block of the day.
LONG_SESSION_MINUTES = 90

SEVERITY_INFO = "info"
SEVERITY_MODERATE = "moderato"
SEVERITY_STRONG = "forte"

STATE_READY = "pronto"
STATE_CAUTIOUS = "cauto"
STATE_DEPLETED = "scarico"
STATE_UNKNOWN = "sconosciuto"

DEMAND_REST = "riposo"
DEMAND_EASY = "facile"
DEMAND_MODERATE = "medio"
DEMAND_HARD = "duro"

ACTION_CONFIRM = "conferma"
ACTION_SOFTEN = "alleggerisci"
ACTION_RESCHEDULE = "sposta"
ACTION_REST = "riposa"

# The verb that goes with each alternative. Swapping a quality session for an easy run
# *is* lightening the day, so both land on the same action -- what differs is the
# alternative's own text, which says which of the two it is.
ACTION_BY_ALTERNATIVE = {
    "soften": ACTION_SOFTEN,
    "easy": ACTION_SOFTEN,
    "reschedule": ACTION_RESCHEDULE,
    "rest": ACTION_REST,
}


@dataclass
class Signal:
    """One measurement that moved the verdict, with the number that did it.

    `detail` always carries the figure and what it was compared against -- "HRV 48 ms,
    -18% sulla media di 7 notti" -- because a signal the user cannot check is a signal
    they have to take on faith.
    """

    key: str
    label: str
    detail: str
    severity: str


@dataclass
class Alternative:
    """What to do instead, when the answer is not "do the session as written"."""

    kind: str  # "soften" | "reschedule" | "rest" | "easy"
    label: str
    detail: str


@dataclass
class DayVerdict:
    date: date_type
    state: str
    headline: str
    signals: list[Signal] = field(default_factory=list)
    session_title: str | None = None
    session_demand: str | None = None
    action: str | None = None
    alternative: Alternative | None = None
    phase: str | None = None
    # False when there is no overnight data to read -- the screen says so instead of
    # showing a verdict computed from nothing.
    has_data: bool = True


# ---- 1. how the body reads ------------------------------------------------------------


def _hrv_signal(snapshot) -> Signal | None:
    nights = [value for _, value in snapshot.hrv_seven_day if value is not None]
    if len(nights) < HRV_MIN_NIGHTS or snapshot.hrv_last_night_ms is None:
        return None
    baseline_nights = nights[:-1] if nights[-1] == snapshot.hrv_last_night_ms else nights
    if not baseline_nights:
        return None
    baseline = sum(baseline_nights) / len(baseline_nights)
    if baseline <= 0:
        return None

    change = (snapshot.hrv_last_night_ms - baseline) / baseline
    if change > HRV_DROP_MODERATE:
        return None
    severity = SEVERITY_STRONG if change <= HRV_DROP_STRONG else SEVERITY_MODERATE
    return Signal(
        key="hrv",
        label="HRV sotto la tua media",
        detail=f"{snapshot.hrv_last_night_ms} ms stanotte, {round(change * 100)}% sulla media di {len(baseline_nights)} notti",
        severity=severity,
    )


def _rhr_signal(snapshot) -> Signal | None:
    delta = snapshot.resting_heart_rate_delta
    if delta is None or delta < RHR_RISE_MODERATE:
        return None
    severity = SEVERITY_STRONG if delta >= RHR_RISE_STRONG else SEVERITY_MODERATE
    return Signal(
        key="rhr",
        label="Frequenza a riposo più alta",
        detail=f"{snapshot.resting_heart_rate} bpm, +{delta} sulla media di 7 giorni",
        severity=severity,
    )


def _sleep_signal(snapshot) -> Signal | None:
    minutes = snapshot.sleep.total_minutes if snapshot.sleep else None
    if minutes is None or minutes >= SLEEP_SHORT:
        return None
    severity = SEVERITY_STRONG if minutes < SLEEP_VERY_SHORT else SEVERITY_MODERATE
    return Signal(
        key="sonno",
        label="Hai dormito poco",
        detail=f"{minutes // 60}h{minutes % 60:02d}",
        severity=severity,
    )


def _readiness_signal(snapshot) -> Signal | None:
    score = snapshot.readiness_score
    if score is None or score >= READINESS_LOW:
        return None
    severity = SEVERITY_STRONG if score < READINESS_VERY_LOW else SEVERITY_MODERATE
    return Signal(key="prontezza", label="Prontezza Garmin bassa", detail=f"{score} su 100", severity=severity)


def _stress_signal(snapshot) -> Signal | None:
    stress = snapshot.stress_level
    if stress is None or stress <= STRESS_HIGH:
        return None
    return Signal(key="stress", label="Stress alto", detail=f"{stress} di media ieri", severity=SEVERITY_MODERATE)


def _battery_signal(snapshot) -> Signal | None:
    battery = snapshot.battery_percent
    if battery is None or battery >= BATTERY_LOW:
        return None
    return Signal(key="batteria", label="Body battery basso", detail=f"{battery}%", severity=SEVERITY_MODERATE)


def _load_signal(acute_chronic_ratio: float | None) -> Signal | None:
    """The one signal that isn't about this morning: it says the last week has been
    heavy relative to the last month, which is a reason to be careful today even after a
    good night."""
    if acute_chronic_ratio is None or acute_chronic_ratio < ACWR_HIGH:
        return None
    severity = SEVERITY_STRONG if acute_chronic_ratio >= ACWR_VERY_HIGH else SEVERITY_MODERATE
    return Signal(
        key="carico",
        label="Carico acuto alto",
        detail=f"rapporto acuto/cronico {acute_chronic_ratio:.2f}",
        severity=severity,
    )


def read_signals(snapshot, acute_chronic_ratio: float | None = None) -> list[Signal]:
    """Every threshold that today's numbers cross, strongest first."""
    candidates = [
        _hrv_signal(snapshot),
        _rhr_signal(snapshot),
        _sleep_signal(snapshot),
        _readiness_signal(snapshot),
        _stress_signal(snapshot),
        _battery_signal(snapshot),
        _load_signal(acute_chronic_ratio),
    ]
    signals = [signal for signal in candidates if signal is not None]
    order = {SEVERITY_STRONG: 0, SEVERITY_MODERATE: 1, SEVERITY_INFO: 2}
    return sorted(signals, key=lambda s: order[s.severity])


def state_from_signals(signals: list[Signal]) -> str:
    """Counting, not weighting.

    Two strong signals, or one strong plus any other, or three moderate ones, is a body
    saying the same thing in several ways at once -- that is what `scarico` means here.
    One isolated signal is a reason to pay attention, not to stop.
    """
    strong = sum(1 for s in signals if s.severity == SEVERITY_STRONG)
    moderate = sum(1 for s in signals if s.severity == SEVERITY_MODERATE)
    if strong >= 2 or (strong == 1 and moderate >= 1) or moderate >= 3:
        return STATE_DEPLETED
    if strong == 1 or moderate >= 1:
        return STATE_CAUTIOUS
    return STATE_READY


# ---- 2. what the session asks ---------------------------------------------------------


def session_demand(session: TrainingSession | None) -> str:
    """How much today's session asks of a body, in four steps.

    Reads the same structure the rest of the app does: more than one interval effort (or
    a repeat block) is repetition work; a long continuous run is a long run; everything
    else is easy. A session with no steps at all -- a live Garmin calendar entry, which
    carries only a title -- counts as moderate rather than easy: unknown is not the same
    as nothing, and treating it as nothing is how the app would wave someone into a
    session it never read.
    """
    if session is None:
        return DEMAND_REST
    if session.sport == "strength_training":
        return DEMAND_MODERATE

    steps = session.steps or []
    if not steps:
        return DEMAND_MODERATE

    efforts = [s for s in flatten_steps(steps) if s.type == "interval"]
    if any(isinstance(item, RepeatBlock) for item in steps) or len(efforts) > 1:
        return DEMAND_HARD

    minutes = session_duration_minutes(session)
    if minutes >= LONG_SESSION_MINUTES:
        return DEMAND_HARD
    if minutes >= 45:
        return DEMAND_MODERATE
    return DEMAND_EASY


# ---- 3. what to do about it -----------------------------------------------------------


def _alternative(state: str, demand: str, phase: str | None) -> Alternative | None:
    """What to do instead, in the terms the race makes relevant.

    The phase is why this isn't one fixed answer. Far from a race, a quality session
    swapped for an easy hour costs almost nothing and the fitness comes back. Close to
    one -- `picco` -- that session is the point of the week and is worth moving by a day
    rather than losing. Inside the taper, cutting is not damage: it is what the taper is
    for, and the app should say so plainly instead of apologising for it.
    """
    near_race = phase in (PHASE_PEAK, PHASE_TAPER)

    if state == STATE_DEPLETED:
        if demand == DEMAND_HARD:
            if phase == PHASE_TAPER:
                return Alternative(
                    kind="rest",
                    label="Riposa",
                    detail="in scarico la seduta di qualità non ti aggiunge niente, e il recupero sì",
                )
            if near_race:
                return Alternative(
                    kind="reschedule",
                    label="Spostala a domani",
                    detail="a ridosso della gara questa seduta vale: falla riposato, non oggi",
                )
            return Alternative(
                kind="easy",
                label="Sostituiscila con un fondo facile",
                detail="40 minuti in conversazione, e la qualità la recuperi più avanti nel blocco",
            )
        if demand == DEMAND_MODERATE:
            return Alternative(kind="easy", label="Falla facile e corta", detail="30-40 minuti senza guardare il passo")
        return Alternative(kind="rest", label="Riposa", detail="oggi il corpo chiede quello, e nel piano non manca niente")

    if state == STATE_CAUTIOUS and demand == DEMAND_HARD:
        if phase == PHASE_TAPER:
            return Alternative(kind="soften", label="Togli una ripetuta", detail="in scarico il volume conta meno della freschezza")
        return Alternative(
            kind="soften",
            label="Tienila, ma più morbida",
            detail="una ripetuta in meno, e se dopo il riscaldamento non gira, chiudila lì",
        )

    return None


def _headline(state: str, demand: str, action: str | None) -> str:
    if state == STATE_UNKNOWN:
        return "Non ho letture di stanotte"
    if state == STATE_READY:
        return "Pronto" if demand != DEMAND_REST else "Pronto, e oggi si riposa"
    if state == STATE_CAUTIOUS:
        return "Vai, ma senza forzare" if action != ACTION_SOFTEN else "Si può fare, più morbida"
    return "Oggi il corpo chiede tregua"


def assess_day(
    snapshot,
    session: TrainingSession | None,
    *,
    acute_chronic_ratio: float | None = None,
    goal: RaceGoal | None = None,
    today: date_type | None = None,
) -> DayVerdict:
    """Today's state, and what it means for today's session.

    Derived on every call and never stored: the body data, the plan and the race can
    each change independently, and a cached verdict would outlive whichever moved.
    """
    day = today or date_type.today()
    phase = race_phase(goal, day) if goal else None
    demand = session_demand(session)
    title = session.title if session else None

    if not snapshot.has_overnight_data:
        return DayVerdict(
            date=day,
            state=STATE_UNKNOWN,
            headline=_headline(STATE_UNKNOWN, demand, None),
            session_title=title,
            session_demand=demand,
            phase=phase,
            has_data=False,
        )

    signals = read_signals(snapshot, acute_chronic_ratio)
    state = state_from_signals(signals)

    # The alternative decides the action, not the other way round: two separate ladders
    # drifted apart the moment one of them grew a case (an "alleggerisci" verdict
    # offering a rescheduled session, say). One ladder, and the verb follows from it.
    alternative = _alternative(state, demand, phase) if state != STATE_READY else None
    if alternative is None:
        action = ACTION_CONFIRM if demand != DEMAND_REST else None
    else:
        action = ACTION_BY_ALTERNATIVE[alternative.kind]

    return DayVerdict(
        date=day,
        state=state,
        headline=_headline(state, demand, action),
        signals=signals,
        session_title=title,
        session_demand=demand,
        action=action,
        alternative=alternative,
        phase=phase,
    )


def verdict_facts(verdict: DayVerdict, goal: RaceGoal | None = None) -> dict:
    """The small, already-decided dict the model is allowed to phrase.

    No raw wellness values beyond the ones already shown on screen, no identifiers, and
    -- critically -- no room to reach a different conclusion: the state, the action and
    the alternative are settled before this is built.
    """
    facts: dict = {
        "stato": verdict.state,
        "seduta": verdict.session_title,
        "impegno_seduta": verdict.session_demand,
        "azione": verdict.action,
        "segnali": [{"cosa": s.label, "misura": s.detail, "peso": s.severity} for s in verdict.signals],
    }
    if verdict.alternative:
        facts["alternativa"] = verdict.alternative.label
    if verdict.phase:
        facts["fase"] = verdict.phase
    if goal:
        facts["gara_fra_giorni"] = (goal.race_date - verdict.date).days
    return facts
