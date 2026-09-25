"""From "here is what is wrong" to "here is the session to do about it".

Every other analysis module in this app stops at a finding. This one turns the finding
into a `TrainingSession` -- the same structure the plan file holds and
`garmin_sync.build_workout_payload` writes to the watch -- so the answer to "cosa
cambio?" is a workout the athlete can put in Thursday rather than a paragraph.

Three rules it is built on.

**Every number in a prescribed session comes from this athlete.** The paces are
`paces.py`'s medians out of their own streams, the heart rates come off their own
lactate threshold. Nothing here is a lookup table with a body weight multiplied into it:
a session written from population averages is a session that fits nobody, and this app
already has one number (the old 840 g of carbohydrate) that taught that lesson.

**One prescription per problem, and the problems are ranked.** A screen that hands
someone four new sessions has replaced their training plan, which is not what it was
asked to do. The diagnosis produces an ordered list and the caller shows the top of it.

**A prescription states what it is for.** `rationale` carries the measurement that
produced it, so the session is never "the app said so" -- it is "42% of your running
time sits between the two thresholds, and this is the session that moves it".

A note on heart rate, which this athlete's own data forced
---------------------------------------------------------
For most runners an easy day can be prescribed as a pace. For this one it cannot, and
the history says so plainly: across 393,000 running samples their pace is 5:57/km at
140 bpm and 5:47/km at 170 bpm -- flat across thirty beats, on flat ground, with the
hills filtered out. Pace is not controlling their intensity; duration and fatigue are.

So the easy prescriptions carry a heart-rate ceiling as their primary target and the
pace only as context. `models.Step` has no heart-rate target field yet, so the ceiling
travels in `Prescription.heart_rate_cap` and in the session's own description -- which
is honest but weaker than it should be: until the model carries it, the watch cannot
enforce the one instruction that matters most here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date as date_type
from datetime import timedelta

from . import intensity, paces
from .models import PaceTarget, RepeatBlock, Step, TrainingSession

# How much slower than the measured easy pace an easy prescription is written. The
# measured median is what they *do* run at their aerobic heart rate, and the whole
# finding is that it is too fast -- prescribing it back unchanged would prescribe the
# problem.
EASY_PACE_SLOWDOWN = 1.06

# Cruise intervals sit at threshold; VO2 work sits meaningfully faster. Expressed as
# multipliers on threshold pace, which is how both are written in every coaching text.
THRESHOLD_PACE_FACTOR = 1.00
VO2_PACE_FACTOR = 0.94

# A pace range is a range: this is how far either side of the target the step allows.
PACE_BAND_SEC = 8

EVIDENCE_RESEARCH = intensity.EVIDENCE_RESEARCH
EVIDENCE_MEASURED = intensity.EVIDENCE_MEASURED


@dataclass
class Prescription:
    """One session to do, and the measurement that asked for it."""

    key: str
    title: str
    # What is wrong, in this athlete's own figures.
    rationale: str
    # What the session is meant to change, and how they will know it worked.
    expected: str
    evidence: str
    session: TrainingSession
    # The ceiling that matters more than the pace, when there is one.
    heart_rate_cap: int | None = None
    # Ordered: 0 is the thing to fix first.
    priority: int = 0


def _pace(target_sec: int) -> PaceTarget:
    return PaceTarget(slower_sec_per_km=target_sec + PACE_BAND_SEC, faster_sec_per_km=target_sec - PACE_BAND_SEC)


def _text_pace(sec: int) -> str:
    return f"{sec // 60}:{sec % 60:02d}/km"


# ---- the sessions ------------------------------------------------------------------------


def easy_run(day: date_type, profile: paces.PaceProfile, zones: intensity.Zones, minutes: int = 50) -> TrainingSession:
    """An easy run written to actually be easy: a heart-rate ceiling first, a pace second."""
    steps: list[Step] = []
    if profile.easy:
        target = paces.scale_pace(profile.easy.sec_per_km, EASY_PACE_SLOWDOWN)
        steps.append(Step(type="interval", duration_type="time", duration_value=minutes, target_pace=_pace(target)))
    else:
        steps.append(Step(type="interval", duration_type="time", duration_value=minutes))

    return TrainingSession(
        date=day,
        sport="running",
        title="Fondo facile con tetto",
        description=(
            f"Tieni la frequenza sotto {zones.aerobic_hr} bpm per tutta la seduta. "
            "Se sale, cammina: è la seduta a doverti sembrare troppo lenta."
        ),
        steps=steps,
    )


def cruise_intervals(day: date_type, profile: paces.PaceProfile) -> TrainingSession | None:
    """Threshold repeats -- the session that raises the ceiling the easy runs sit under."""
    if not profile.threshold:
        return None
    target = paces.scale_pace(profile.threshold.sec_per_km, THRESHOLD_PACE_FACTOR)
    easy = paces.scale_pace(profile.easy.sec_per_km, EASY_PACE_SLOWDOWN) if profile.easy else None

    return TrainingSession(
        date=day,
        sport="running",
        title="Ripetute in soglia",
        description=(
            f"Cinque volte sei minuti a {_text_pace(target)}, recupero di 90 secondi molto lento. "
            "Deve essere impegnativo ma controllato: se l'ultima ripetuta crolla, sei partito troppo forte."
        ),
        steps=[
            Step(type="warmup", duration_type="time", duration_value=15,
                 target_pace=_pace(easy) if easy else None),
            RepeatBlock(
                reps=5,
                steps=[
                    Step(type="interval", duration_type="time", duration_value=6, target_pace=_pace(target)),
                    Step(type="recovery", duration_type="time", duration_value=1.5,
                         target_pace=_pace(easy) if easy else None),
                ],
            ),
            Step(type="cooldown", duration_type="time", duration_value=10,
                 target_pace=_pace(easy) if easy else None),
        ],
    )


def vo2_intervals(day: date_type, profile: paces.PaceProfile) -> TrainingSession | None:
    """Short, genuinely hard repeats, for a history that has almost none."""
    if not profile.threshold:
        return None
    target = paces.scale_pace(profile.threshold.sec_per_km, VO2_PACE_FACTOR)
    easy = paces.scale_pace(profile.easy.sec_per_km, EASY_PACE_SLOWDOWN) if profile.easy else None

    return TrainingSession(
        date=day,
        sport="running",
        title="Ripetute brevi",
        description=(
            f"Sei volte tre minuti a {_text_pace(target)}, recupero di due minuti in corsa lenta. "
            "Questa è la fascia che nel tuo storico non esiste quasi: serve per alzare il tetto, non per stancarti."
        ),
        steps=[
            Step(type="warmup", duration_type="time", duration_value=15,
                 target_pace=_pace(easy) if easy else None),
            RepeatBlock(
                reps=6,
                steps=[
                    Step(type="interval", duration_type="time", duration_value=3, target_pace=_pace(target)),
                    Step(type="recovery", duration_type="time", duration_value=2,
                         target_pace=_pace(easy) if easy else None),
                ],
            ),
            Step(type="cooldown", duration_type="time", duration_value=10,
                 target_pace=_pace(easy) if easy else None),
        ],
    )


# ---- the diagnosis, turned into sessions ---------------------------------------------------

# Above this share of grey-zone time the first prescription is always "slow down", no
# matter what else is wrong: adding quality on top of a grey-zone week is how a runner
# ends up doing three hard days and calling one of them easy.
GREY_URGENT_SHARE = 0.30

# Below this share of time *above* threshold there is no VO2-style work in the history.
#
# Read carefully, because the obvious reading is wrong: threshold work sits, by
# definition, at the top of the grey zone rather than above it, so a runner doing proper
# tempo sessions shows a small "hard" share too. A low figure on its own therefore means
# "no short fast work", not "no quality" -- which is why the prescription below also
# requires the distribution to be unpolarized before it fires. An athlete at 82/14/4 is
# doing tempo work and is fine; one at 54/43/3 is not.
HARD_MISSING_SHARE = 0.05


def prescribe(
    block: intensity.BlockDistribution,
    zones: intensity.Zones,
    profile: paces.PaceProfile,
    *,
    today: date_type | None = None,
) -> list[Prescription]:
    """What to change, as sessions, ordered by what to change first.

    Deliberately short. The ranking is the opinion: a runner living in the grey zone is
    told to slow down before they are told to add intervals, because doing the second
    without the first is how the grey zone got there.
    """
    day = today or date_type.today()
    out: list[Prescription] = []

    if block.grey_share > GREY_URGENT_SHARE:
        out.append(
            Prescription(
                key="rallenta",
                title="Rallenta i lenti",
                rationale=(
                    f"Il {round(block.grey_share * 100)}% del tuo tempo di corsa sta fra la soglia aerobica "
                    f"({zones.aerobic_hr} bpm) e la soglia ({zones.threshold_hr}). È la fascia che costa "
                    "recupero come una seduta dura senza darne gli adattamenti."
                ),
                expected=(
                    "Nel giro di tre o quattro settimane la frequenza a parità di passo scende, e le sedute "
                    "dure iniziano a girare perché arrivi riposato."
                ),
                evidence=EVIDENCE_RESEARCH,
                session=easy_run(day + timedelta(days=1), profile, zones),
                heart_rate_cap=zones.aerobic_hr,
                priority=0,
            )
        )

    if block.hard_share < HARD_MISSING_SHARE and block.easy_share < intensity.POLARIZED_EASY_SHARE:
        session = cruise_intervals(day + timedelta(days=3), profile)
        if session:
            out.append(
                Prescription(
                    key="soglia",
                    title="Aggiungi una seduta in soglia",
                    rationale=(
                        f"Solo il {round(block.hard_share * 100)}% del tuo tempo sta sopra la soglia, "
                        f"e il {round(block.easy_share * 100)}% sotto quella aerobica: non è una "
                        "distribuzione con dentro del lavoro strutturato, è una media."
                    ),
                    expected=(
                        "È la seduta che sposta la soglia verso l'alto: quando funziona, il passo a "
                        f"{zones.threshold_hr} bpm diventa più veloce a parità di sforzo."
                    ),
                    evidence=EVIDENCE_RESEARCH,
                    session=session,
                    priority=1,
                )
            )

    if block.easy_share < intensity.POLARIZED_EASY_SHARE and block.hard_share >= HARD_MISSING_SHARE:
        session = vo2_intervals(day + timedelta(days=3), profile)
        if session:
            out.append(
                Prescription(
                    key="brevi",
                    title="Separa le due intensità",
                    rationale=(
                        f"Facile {round(block.easy_share * 100)}%, intermedia "
                        f"{round(block.grey_share * 100)}%, dura {round(block.hard_share * 100)}%: "
                        "le giornate si somigliano tutte."
                    ),
                    expected="Due poli distinti invece di una media: il facile recupera, il duro allena.",
                    evidence=EVIDENCE_RESEARCH,
                    session=session,
                    priority=2,
                )
            )

    out.sort(key=lambda p: p.priority)
    return out


@dataclass
class CoachPlan:
    """Everything the prescription screen renders: the state, and what to do about it."""

    zones: intensity.Zones
    block: intensity.BlockDistribution
    profile: paces.PaceProfile
    prescriptions: list[Prescription] = field(default_factory=list)
    # How much the verdict moves if the threshold estimate is wrong. Shown because the
    # whole analysis pivots on one number Garmin estimated, and eleven beats either way
    # move it between "roughly polarized" and "living in the grey zone".
    sensitivity: list[dict] = field(default_factory=list)
