"""Carbohydrate and protein availability matched to the training load of a day.

Pure arithmetic over the plan's own sessions: no I/O, no Garmin, no model. Every number
this module produces is a published consensus range multiplied by a body weight, which
means the user can redo it by hand -- the same discipline `goal.py` will need and the
reason none of it is asked of an LLM.

Three things are deliberately *not* here, and their absence is the design:

- **No calorie budget, no deficit, no weight target.** The frame is fuelling, never
  restriction. Exceeding a carbohydrate range is not an error state; missing one before
  a hard session is the only thing worth flagging. The energy figure this module *does*
  compute (`EnergyCheck`) exists to keep the macros honest against what the day actually
  costs -- it is a sanity check on the arithmetic, never a budget to stay under.
- **No claim to precision.** The ranges are wide because the science is wide. A single
  number would imply a confidence nobody has.
- **No judgement of what was eaten.** The module answers "how much fuel does tomorrow
  ask for", not "was that lunch a good idea".

Ranges follow the standard endurance-nutrition consensus (Burke et al., and what every
sports-nutrition body has published for two decades): carbohydrate scaled to the day's
training, protein and fat flat across the day.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date as date_type
from datetime import timedelta
from typing import Literal

from .models import (
    TrainingSession,
    avg_pace_sec_per_km,
    flatten_steps,
    session_duration_minutes,
    session_fallback_pace,
)

# How hard a day asks the body to work, in the only granularity the carbohydrate ranges
# actually distinguish. Not the same axis as `sessionVisuals.ts`'s `SessionKind`, which
# classifies a session by *shape* (ripetute / lungo / forza) to pick a colour: a 40-minute
# interval session and a three-hour long run are different cards there and different
# fuelling days here, but the two taxonomies answer different questions and are kept apart
# on purpose.
SessionLoad = Literal["riposo", "facile", "moderato", "duro", "molto_lungo"]

# Grams of carbohydrate per kg of body weight, per day, by the load of the session being
# fuelled for.
#
# These are the *athlete-sized* reading of the consensus table, and the previous version
# of this file took the top of it: "duro" asked 7-10 g/kg and "molto_lungo" 10-12 g/kg.
# Those two rows belong to athletes training 3-5 hours a day -- at 70 kg the second one
# is 700-840 g of carbohydrate, roughly 4,000 kcal before protein and fat are counted,
# for a person who ran for two hours. The numbers were arithmetically correct and
# physiologically absurd, which is the worst combination an app can produce, because
# nothing on screen said so.
#
# The bands below are the same published consensus read against the training volume a
# session of each load actually represents:
#
#   riposo / facile   -- "low intensity or skill-based", 3-5 g/kg
#   moderato          -- "moderate exercise programme, ~1 h/day", 5-7 g/kg
#   duro              -- "endurance programme, 1-3 h/day", the lower half of 6-10 g/kg
#   molto_lungo       -- 3 h+ in one session, the upper half of the same row
#
# The 8-12 g/kg row (four to five hours a day, every day) is not reachable from this
# table at all, and that is deliberate: no session a plan in this app can describe earns
# it. `EnergyCheck` then trims whatever is left over against the day's real cost.
CARB_G_PER_KG: dict[SessionLoad, tuple[float, float]] = {
    "riposo": (3.0, 4.0),
    "facile": (4.0, 5.0),
    "moderato": (5.0, 6.5),
    "duro": (6.0, 8.0),
    "molto_lungo": (8.0, 10.0),
}

# Flat across every day: protein supports repair, and repair happens on the rest day too.
PROTEIN_G_PER_KG = (1.6, 2.0)

# Flat across every day too, for the same reason: fat is not periodized around a
# session the way carbohydrate is. The range is the standard endurance-athlete floor
# (essential fatty acids, hormone production) up to a share that still leaves room for
# the carbohydrate a hard day needs.
FAT_G_PER_KG = (0.8, 1.2)

# What a second hard day in a row adds to the night before it, in g/kg. An addition, not
# a jump to the next band: the old rule promoted the whole load one step, which turned a
# pair of ordinary two-hour days into the 10-12 g/kg ultra-endurance row.
BACK_TO_BACK_CARB_BONUS = 1.0

# The weight the ranges are shown against when no real one is available. Never presented
# silently -- `DailyFuelling.weight_source` is "reference" and the UI must say so.
REFERENCE_WEIGHT_KG = 70.0

# A step counts as quality work when its pace is at least this much faster than the
# slowest pace the session itself names. Below this, a "faster" step is warmup drift
# rather than a workout: 20 s/km is roughly the gap between an easy pace and a steady
# one, and comfortably inside the tolerance a plan writes paces with.
QUALITY_PACE_DELTA_SEC_PER_KM = 20.0

# A quality session shorter than this is a strides day or a short tune-up -- real work,
# but not enough of it to move the day's carbohydrate need.
MIN_QUALITY_MINUTES = 30.0

# Minutes above which an otherwise-easy session is "long" -- the plan's "hard *or* long,
# 1-3 h" row -- and above which it is very long.
LONG_MINUTES = 90.0
VERY_LONG_MINUTES = 180.0

# Sports that do not deplete glycogen the way running does. Strength work is real
# training and gets protein, but a 70-minute gym session is not a 70-minute tempo run
# and must not be fuelled like one.
LOW_GLYCOGEN_SPORTS = ("strength_training", "other")


# ---- energy ---------------------------------------------------------------------------
#
# The cross-check that the old table had no way to fail. Macro targets are a *ratio*
# times a weight, so they can quietly describe a day nobody could eat: nothing in the
# arithmetic knows how many hours the person actually trained. These figures close that
# loop -- estimate what the day costs, and trim the carbohydrate band when the macros
# have run away from it.

# Kilocalories per gram. The Atwater factors, unchanged since 1900 and accurate enough
# for a range that is already ±20%.
KCAL_PER_G_CARB = 4.0
KCAL_PER_G_PROTEIN = 4.0
KCAL_PER_G_FAT = 9.0

# Everything that is not training and not lying still: walking, standing, commuting,
# fidgeting. 1.35 is the sedentary-to-lightly-active figure; the training itself is
# added separately below, so this must *not* be an athlete's activity multiplier or the
# session would be counted twice.
NON_TRAINING_ACTIVITY_FACTOR = 1.35

# Net kilocalories per kilogram per minute of training, by sport. Running is the classic
# ~1 kcal/kg/km, converted at a 5:30/km habit into roughly 0.18 kcal/kg/min; cycling and
# swimming are the corresponding MET-derived figures for a steady endurance effort.
KCAL_PER_KG_PER_MINUTE: dict[str, float] = {
    "running": 0.175,
    "cycling": 0.125,
    "swimming": 0.145,
    "strength_training": 0.075,
    "other": 0.110,
}

# How far above the day's estimated cost the macro targets may sit before they are
# trimmed. Some slack is right -- the ranges are ranges, and the estimate has its own
# error bars -- but not unlimited slack, which is what there was before.
ENERGY_TOLERANCE = 1.10

# The carbohydrate floor the trim will never go under, in g/kg. Below this the advice
# stops being "eat less than the table said" and becomes a low-carbohydrate diet, which
# is not a thing this app recommends by accident.
MIN_CARB_G_PER_KG = 3.0


@dataclass
class BodyProfile:
    """What is needed to estimate a resting metabolic rate, all optional.

    Mirrors what `garmin_sync.body_metrics()` returns. Every field can be missing, and
    a missing field only means the energy cross-check is skipped -- the macro targets
    still stand on their own.
    """

    height_cm: float | None = None
    age_years: int | None = None
    sex: str | None = None  # "male" | "female" | anything else -> the average of the two


def basal_metabolic_rate(weight_kg: float, profile: BodyProfile | None) -> float | None:
    """Mifflin-St Jeor, or `None` when the profile is too thin to run it.

    Picked over Harris-Benedict because it is the one that has held up in validation
    studies on non-obese adults, which is who this app is for. The sex term is a
    constant, and when the sex is unknown the midpoint of the two is used rather than
    guessing one -- an 83 kcal error on a 2,000 kcal estimate, well inside the noise of
    everything else here.
    """
    if profile is None or profile.height_cm is None or profile.age_years is None:
        return None
    base = 10 * weight_kg + 6.25 * profile.height_cm - 5 * profile.age_years
    sex = (profile.sex or "").strip().lower()
    if sex in ("male", "m", "uomo"):
        return base + 5
    if sex in ("female", "f", "donna"):
        return base - 161
    return base - 78


def training_kcal(weight_kg: float, minutes: float | None, sport: str | None) -> float:
    """Net cost of the day's session. Zero for a rest day, by construction."""
    if not minutes or minutes <= 0:
        return 0.0
    rate = KCAL_PER_KG_PER_MINUTE.get(sport or "running", KCAL_PER_KG_PER_MINUTE["other"])
    return rate * weight_kg * minutes


@dataclass
class EnergyCheck:
    """What the day costs, what the targets provide, and whether they were trimmed.

    Shown on screen, not hidden: this is the figure that makes a carbohydrate number
    checkable. A user who thinks 500 g of carbohydrate sounds like a lot can look at the
    energy line, see the two-hour session inside it, and decide for themselves.
    """

    # Estimated cost of the day: resting metabolism, ordinary living, and the session.
    need_kcal: int | None
    resting_kcal: int | None
    training_kcal: int
    # What the macro ranges add up to, low end and high end.
    target_kcal: tuple[int, int]
    # True when the carbohydrate band was pulled down to fit `need_kcal`.
    trimmed: bool


def _energy_from_macros(
    carb: tuple[int, int] | None, protein: tuple[int, int] | None, fat: tuple[int, int] | None
) -> tuple[int, int]:
    def side(index: int) -> int:
        total = 0.0
        if carb:
            total += carb[index] * KCAL_PER_G_CARB
        if protein:
            total += protein[index] * KCAL_PER_G_PROTEIN
        if fat:
            total += fat[index] * KCAL_PER_G_FAT
        return round(total)

    return side(0), side(1)


@dataclass
class DayTarget:
    """What one calendar day asks for, and why."""

    date: date_type
    session_title: str | None
    load: SessionLoad
    duration_minutes: float | None
    carb_g_per_kg: tuple[float, float]
    protein_g_per_kg: tuple[float, float]
    fat_g_per_kg: tuple[float, float]
    # Absolute grams, or None when there is no weight to multiply by -- the caller
    # decides whether to fall back to REFERENCE_WEIGHT_KG and say so.
    carb_g: tuple[int, int] | None
    protein_g: tuple[int, int] | None
    fat_g: tuple[int, int] | None
    # The sport the session is in, which the energy estimate needs and the meal plan
    # uses to decide whether there is anything to eat *during* it.
    sport: str | None = None
    # None whenever there is no weight, or no height/age to estimate a metabolism from.
    energy: EnergyCheck | None = None


@dataclass
class DailyFuelling:
    date: date_type
    weight_kg: float | None
    # Where `weight_kg` came from: a smart scale, the Garmin profile field, typed in by
    # the user, or REFERENCE_WEIGHT_KG standing in for all three.
    weight_source: Literal["scale", "profile", "manual", "reference"] | None
    today: DayTarget
    tomorrow: DayTarget
    # The deterministic sentence. Always present: the screen never depends on a model
    # being reachable, so this is what it renders and a narrative only replaces it.
    advice: str
    # How today's numbers turn into actual meals. Empty only when there is no weight to
    # size a plate by.
    meals: list["MealSlot"] = field(default_factory=list)
    # What to eat during and straight after today's session, when it is long enough for
    # either to matter.
    during: "DuringSession | None" = None
    recovery: "RecoveryWindow | None" = None


def has_quality_work(session: TrainingSession) -> bool:
    """True when the session contains work meaningfully faster than its own easy pace.

    Reads paces rather than step *types* on purpose. A plan writes "interval" for the
    working part of every session, including the 40-minute steady run that is one long
    `interval` step at easy pace -- classifying on the type alone would make every
    session a hard one.
    """
    steps = flatten_steps(session.steps)
    paced = [s for s in steps if s.target_pace]
    if not paced:
        return False
    slowest = session_fallback_pace(steps)
    fastest = min(avg_pace_sec_per_km(s.target_pace) for s in paced)
    return (slowest - fastest) >= QUALITY_PACE_DELTA_SEC_PER_KM


def classify_load(session: TrainingSession | None) -> SessionLoad:
    """The fuelling load of a single session, from its own steps.

    A heuristic, and it should be read as one: the file format carries no intensity
    field, so duration and the spread of the paces are all there is to go on. It is
    good enough to choose between two adjacent consensus ranges, which is all it is
    asked to do.
    """
    if session is None:
        return "riposo"

    minutes = session_duration_minutes(session)
    if minutes <= 0:
        # A session with no step detail at all -- a workout read straight off the Garmin
        # calendar, say. Something is planned, so it is not a rest day, but there is
        # nothing to size it by.
        return "facile"

    if session.sport in LOW_GLYCOGEN_SPORTS:
        return "moderato" if minutes >= LONG_MINUTES else "facile"

    if minutes > VERY_LONG_MINUTES:
        return "molto_lungo"
    if minutes >= LONG_MINUTES:
        return "duro"
    if has_quality_work(session) and minutes >= MIN_QUALITY_MINUTES:
        return "duro"
    if minutes >= 60:
        return "moderato"
    return "facile"


def _grams(per_kg: tuple[float, float], weight_kg: float | None) -> tuple[int, int] | None:
    if weight_kg is None:
        return None
    return (round(per_kg[0] * weight_kg), round(per_kg[1] * weight_kg))


def _trim_carbs_to_energy(
    carb_per_kg: tuple[float, float],
    weight_kg: float,
    need_kcal: float,
) -> tuple[float, float]:
    """The carbohydrate band, pulled down to what the day's energy cost supports.

    Protein and fat are left alone: they are structural, they are already small, and
    cutting either to make room for carbohydrate would be the wrong trade. Carbohydrate
    is the only macro this app periodizes, so it is the only one the cross-check moves.

    Never raises the band. A day that comes out *under* its estimated cost is not
    corrected upward, because the estimate is not precise enough to be pushing food at
    someone on its own authority -- and because the band was already chosen for the
    session.
    """
    other_kcal = (
        sum(PROTEIN_G_PER_KG) / 2 * weight_kg * KCAL_PER_G_PROTEIN
        + sum(FAT_G_PER_KG) / 2 * weight_kg * KCAL_PER_G_FAT
    )
    room_kcal = max(need_kcal * ENERGY_TOLERANCE - other_kcal, 0.0)
    ceiling = room_kcal / KCAL_PER_G_CARB / weight_kg
    if ceiling >= carb_per_kg[1]:
        return carb_per_kg

    high = max(round(ceiling, 1), MIN_CARB_G_PER_KG)
    width = carb_per_kg[1] - carb_per_kg[0]
    low = max(round(high - width, 1), MIN_CARB_G_PER_KG)
    if low > high:
        low = high
    return (low, high)


def day_target(
    day: date_type,
    session: TrainingSession | None,
    weight_kg: float | None,
    *,
    load_override: SessionLoad | None = None,
    carb_bonus_g_per_kg: float = 0.0,
    profile: BodyProfile | None = None,
) -> DayTarget:
    load = load_override or classify_load(session)
    table = CARB_G_PER_KG[load]
    carb = (table[0] + carb_bonus_g_per_kg, table[1] + carb_bonus_g_per_kg)
    minutes = round(session_duration_minutes(session), 1) if session else None
    sport = session.sport if session else None

    energy: EnergyCheck | None = None
    trimmed = False
    if weight_kg is not None:
        bmr = basal_metabolic_rate(weight_kg, profile)
        session_kcal = training_kcal(weight_kg, minutes, sport)
        need = bmr * NON_TRAINING_ACTIVITY_FACTOR + session_kcal if bmr is not None else None
        if need is not None:
            adjusted = _trim_carbs_to_energy(carb, weight_kg, need)
            trimmed = adjusted != carb
            carb = adjusted
        energy = EnergyCheck(
            need_kcal=round(need) if need is not None else None,
            resting_kcal=round(bmr) if bmr is not None else None,
            training_kcal=round(session_kcal),
            target_kcal=_energy_from_macros(
                _grams(carb, weight_kg), _grams(PROTEIN_G_PER_KG, weight_kg), _grams(FAT_G_PER_KG, weight_kg)
            ),
            trimmed=trimmed,
        )

    return DayTarget(
        date=day,
        session_title=session.title if session else None,
        load=load,
        duration_minutes=minutes,
        carb_g_per_kg=carb,
        protein_g_per_kg=PROTEIN_G_PER_KG,
        fat_g_per_kg=FAT_G_PER_KG,
        carb_g=_grams(carb, weight_kg),
        protein_g=_grams(PROTEIN_G_PER_KG, weight_kg),
        fat_g=_grams(FAT_G_PER_KG, weight_kg),
        sport=sport,
        energy=energy,
    )


def _session_on(sessions: list[TrainingSession], day: date_type) -> TrainingSession | None:
    """The day's session, or None for a rest day.

    A rest day is the *absence* of an entry -- the file format has no "rest" session
    type -- so a missing plan and a planned rest day are indistinguishable here. The
    caller knows which it has; see `DailyFuelling.weight_source`'s equivalent problem.
    """
    for session in sessions:
        if session.date == day:
            return session
    return None


def daily_fuelling(
    day: date_type,
    sessions: list[TrainingSession],
    weight_kg: float | None = None,
    weight_source: Literal["scale", "profile", "manual", "reference"] | None = None,
    profile: BodyProfile | None = None,
) -> DailyFuelling:
    """Today's and tomorrow's targets plus the sentence that explains them.

    Tomorrow is the one that matters for the *ranges*: glycogen is loaded the day
    before, not the morning of, which is why the screen leads with it. Today is the one
    that matters for the *meals*, which is what `meals`/`during`/`recovery` describe.
    """
    if weight_kg is None:
        weight_kg, weight_source = REFERENCE_WEIGHT_KG, "reference"

    tomorrow = day + timedelta(days=1)
    today_session = _session_on(sessions, day)
    tomorrow_session = _session_on(sessions, tomorrow)
    day_after_load = classify_load(_session_on(sessions, tomorrow + timedelta(days=1)))

    tomorrow_load = classify_load(tomorrow_session)
    # Back-to-back hard days are the case the flat table misses: the second one starts
    # from a tank the first emptied, so the day before them both carries more. A gram
    # per kilo more -- not a promotion to the next band, which is how a pair of ordinary
    # long days used to end up on the ultra-endurance row.
    bonus = (
        BACK_TO_BACK_CARB_BONUS
        if tomorrow_load in ("duro", "molto_lungo") and day_after_load in ("duro", "molto_lungo")
        else 0.0
    )

    today_target = day_target(day, today_session, weight_kg, profile=profile)
    tomorrow_target = day_target(
        tomorrow, tomorrow_session, weight_kg, load_override=tomorrow_load, carb_bonus_g_per_kg=bonus, profile=profile
    )

    return DailyFuelling(
        date=day,
        weight_kg=round(weight_kg, 1),
        weight_source=weight_source,
        today=today_target,
        tomorrow=tomorrow_target,
        advice=templated_advice(today_target, tomorrow_target),
        meals=meal_plan(today_target, tomorrow_target),
        during=during_session(today_target),
        recovery=recovery_window(today_target, weight_kg),
    )


def _session_phrase(target: DayTarget) -> str:
    """"domani il lungo" out of a session title, without repeating the word twice."""
    title = (target.session_title or "").strip().lower()
    return title or "un allenamento"


def templated_advice(today: DayTarget, tomorrow: DayTarget) -> str:
    """The deterministic Italian sentence, and the fallback whenever the model is not
    reachable.

    Written to stand on its own: this is what most users will read most days, not a
    degraded placeholder for something better. The LLM narrative replaces it with
    something warmer, never with something that says more.
    """
    if tomorrow.load == "molto_lungo":
        return (
            f"Domani {_session_phrase(tomorrow)}: stasera carica di carboidrati, "
            "e colazione almeno due ore prima."
        )
    if tomorrow.load == "duro":
        return f"Domani {_session_phrase(tomorrow)}: stasera un piatto pieno di carboidrati."
    if tomorrow.load == "moderato":
        return f"Domani {_session_phrase(tomorrow)}: mangia come sempre, senza pensarci troppo."

    # Tomorrow is easy or rest, so the useful thing to say is about today.
    if today.load in ("duro", "molto_lungo"):
        return "Oggi hai speso parecchio: reintegra stasera, adesso il recupero passa da lì."
    if tomorrow.load == "facile":
        return f"Domani {_session_phrase(tomorrow)}: giornata leggera, niente da preparare."
    return "Domani riposo: niente da caricare, tieni le proteine dove sono."


# ---- the day as meals -------------------------------------------------------------------
#
# The targets above are a number for a whole day, which is the correct unit for the
# science and a useless one at lunchtime. This section spends that number: it splits the
# day's carbohydrate and protein across the meals a person actually eats, and prints each
# one as food with grams on it.
#
# Same rule as everything else here -- the split is fixed arithmetic, the portions are a
# lookup table, and nothing is asked of a model. The point is not that these are the only
# right meals; it is that they are *one* worked example the user can check, copy, or
# ignore.


@dataclass
class Portion:
    """One item on a plate: a food, and how much of it."""

    food: str
    grams: int | None  # None for things counted in pieces ("1 banana")
    note: str | None = None

    def text(self) -> str:
        if self.grams is None:
            return self.food
        return f"{self.food} {self.grams} g"


@dataclass
class MealSlot:
    key: str
    name: str
    # When, in the terms a day is actually lived in ("al risveglio", "13:00 circa").
    timing: str
    carb_g: int
    protein_g: int
    portions: list[Portion] = field(default_factory=list)
    note: str | None = None


@dataclass
class DuringSession:
    """Carbohydrate to take *inside* a session, which is the one place the daily total
    cannot be spent later."""

    carb_g_per_hour: tuple[int, int]
    total_carb_g: tuple[int, int]
    note: str


@dataclass
class RecoveryWindow:
    carb_g: int
    protein_g: int
    note: str
    portions: list[Portion] = field(default_factory=list)


# How the day's carbohydrate is divided when there is a session to work around, and when
# there is not. Shares, so they sum to 1.0 and the arithmetic stays checkable.
#
# The training-day split is front-loaded on purpose: the meal before a session and the
# one after it are the two that have a job to do, and the evening plate is what is left
# rather than the day's main event.
MEAL_SHARES_TRAINING: list[tuple[str, str, str, float, float]] = [
    # key, name, timing, carb share, protein share
    ("colazione", "Colazione", "al risveglio", 0.25, 0.20),
    ("pre", "Prima dell'allenamento", "2-3 h prima", 0.15, 0.05),
    ("post", "Subito dopo", "entro un'ora", 0.15, 0.20),
    ("pranzo", "Pranzo", "13:00 circa", 0.20, 0.25),
    ("spuntino", "Spuntino", "metà pomeriggio", 0.05, 0.05),
    ("cena", "Cena", "20:00 circa", 0.20, 0.25),
]

MEAL_SHARES_REST: list[tuple[str, str, str, float, float]] = [
    ("colazione", "Colazione", "al risveglio", 0.25, 0.20),
    ("spuntino_mattina", "Spuntino", "metà mattina", 0.10, 0.10),
    ("pranzo", "Pranzo", "13:00 circa", 0.30, 0.30),
    ("spuntino", "Spuntino", "metà pomeriggio", 0.10, 0.10),
    ("cena", "Cena", "20:00 circa", 0.25, 0.30),
]

# Grams of carbohydrate and protein per 100 g of food, and the largest portion of it
# that belongs on one plate. Ordinary Italian supermarket figures, rounded -- they are
# here to turn "120 g di carboidrati" into something you can put in a pot, not to be a
# food database.
#
# The ceiling is the load-bearing half. A single anchor food scaled to a whole meal's
# carbohydrate produces numbers like "595 g di patate": arithmetically right, and not
# a dinner. Each meal fills from several foods in order, and stops at the ceiling of
# each one.
CARB_FOODS: dict[str, tuple[float, int]] = {
    # food: (g of carbohydrate per 100 g, max grams in one sitting)
    "pasta": (75.0, 150),
    "riso": (78.0, 150),
    "gnocchi": (32.0, 300),
    "pane": (50.0, 150),
    "fette biscottate": (76.0, 80),
    "avena": (62.0, 100),
    "patate": (17.0, 400),
    "miele o marmellata": (70.0, 40),
    "banana": (23.0, 250),
    "frutta fresca": (12.0, 300),
    "frutta secca": (20.0, 40),
    "latte": (5.0, 300),
}
PROTEIN_FOODS: dict[str, tuple[float, int]] = {
    "petto di pollo": (23.0, 200),
    "salmone": (20.0, 200),
    "tonno al naturale": (25.0, 160),
    "uova": (13.0, 150),
    "ricotta": (11.0, 200),
    "yogurt greco": (10.0, 200),
    "legumi cotti": (9.0, 250),
    "parmigiano": (33.0, 40),
    "bresaola": (32.0, 100),
}

# Foods weighed dry, where the number on the packet is not the number on the plate.
WEIGHED_RAW = ("pasta", "riso", "avena")

# What each meal is built out of, in fill order: carbohydrate foods first, protein foods
# second, then the fixed extras that make it a meal rather than a macro. Ordered so the
# day reads like food a person in Italy actually eats, and so no two meals in a row are
# the same thing.
MEAL_ANCHORS: dict[str, tuple[list[str], list[str], list[Portion]]] = {
    "colazione": (
        ["avena", "pane", "miele o marmellata", "banana"],
        ["yogurt greco", "uova"],
        [],
    ),
    "spuntino_mattina": (["fette biscottate", "frutta fresca"], ["yogurt greco"], []),
    "pre": (["pane", "miele o marmellata", "banana"], [], []),
    "post": (["riso", "banana", "frutta fresca"], ["yogurt greco", "uova"], []),
    "pranzo": (
        ["pasta", "pane"],
        ["petto di pollo", "parmigiano"],
        [Portion(food="verdura", grams=200), Portion(food="olio extravergine", grams=15)],
    ),
    "spuntino": (["pane", "frutta fresca", "frutta secca"], ["ricotta", "bresaola"], []),
    "cena": (
        ["patate", "pane", "gnocchi"],
        ["salmone", "legumi cotti"],
        [Portion(food="verdura", grams=200), Portion(food="olio extravergine", grams=10)],
    ),
}

MEAL_NOTES = {
    "pre": "carboidrati semplici e poca fibra: quello che digerisci in fretta",
    "post": "la finestra che conta davvero, carboidrati e proteine insieme",
    "cena": "qui vanno i carboidrati che servono a domani",
}


def _fill(target_g: float, foods: list[str], table: dict[str, tuple[float, int]]) -> tuple[list[Portion], float]:
    """Portions that together carry `target_g` of one macro, and whatever is left over.

    Greedy, in the order the meal lists its foods, and capped per food. The leftover is
    returned rather than forced onto the last item: a meal that cannot reach its share
    without a fourth plate of pasta should say so, not print the fourth plate.
    """
    portions: list[Portion] = []
    remaining = target_g
    for food in foods:
        if remaining <= 2:
            break
        per_100, max_grams = table[food]
        grams = min(remaining / per_100 * 100, max_grams)
        rounded = int(round(grams / 5.0) * 5)
        if rounded < 10:
            continue
        portions.append(Portion(food=food, grams=rounded, note="a crudo" if food in WEIGHED_RAW else None))
        remaining -= rounded * per_100 / 100
    return portions, max(remaining, 0.0)


def _mid(range_g: tuple[int, int]) -> float:
    return (range_g[0] + range_g[1]) / 2


def meal_plan(today: DayTarget, tomorrow: DayTarget) -> list[MealSlot]:
    """Today's targets, spent across today's meals.

    Sized on the *midpoint* of each range rather than either end: a plan built on the
    top of the band would systematically overshoot, and one built on the bottom would
    read as a restriction. The ranges stay on screen next to it, so the midpoint is
    presented as one way to land inside them, not as the answer.
    """
    if today.carb_g is None or today.protein_g is None:
        return []

    carb_total = _mid(today.carb_g)
    protein_total = _mid(today.protein_g)
    trains = today.load != "riposo"
    shares = MEAL_SHARES_TRAINING if trains else MEAL_SHARES_REST

    slots: list[MealSlot] = []
    for key, name, timing, carb_share, protein_share in shares:
        carb_g = round(carb_total * carb_share)
        protein_g = round(protein_total * protein_share)
        carb_foods, protein_foods, extras = MEAL_ANCHORS[key]

        carb_portions, carb_left = _fill(carb_g, carb_foods, CARB_FOODS)
        protein_portions, _ = _fill(protein_g, protein_foods, PROTEIN_FOODS)
        portions = [*carb_portions, *protein_portions, *extras]

        note = MEAL_NOTES.get(key)
        # A meal whose share does not fit on one plate says so instead of printing a
        # portion nobody would serve. It happens on the biggest days, which are exactly
        # the days when "spread it out" is the real advice.
        if carb_left >= 15:
            note = f"restano {round(carb_left)} g di carboidrati: spostali su un altro momento"
        # The evening plate is the one that answers to tomorrow, not today, and on the
        # night before a big session that is the only thing worth saying about it.
        if key == "cena" and tomorrow.load in ("duro", "molto_lungo"):
            note = "domani si lavora: qui i carboidrati non si tagliano"

        slots.append(
            MealSlot(
                key=key,
                name=name,
                timing=timing,
                carb_g=carb_g,
                protein_g=protein_g,
                portions=portions,
                note=note,
            )
        )
    return slots


# Carbohydrate per hour of work, by how long the session is. The consensus ladder:
# nothing is needed under an hour, 30-60 g/h from there, and only beyond about two and a
# half hours does the 60-90 g/h range (which needs a glucose-fructose mix to absorb at
# all) start to make sense.
DURING_THRESHOLD_MINUTES = 75.0
DURING_HIGH_THRESHOLD_MINUTES = 150.0


def during_session(today: DayTarget) -> DuringSession | None:
    """What to take during today's session, or `None` when it is short enough not to
    need anything.

    The one part of the day's carbohydrate that cannot be moved: a two-hour run does not
    care how good dinner was, and the deficit it opens is paid inside the session or not
    at all.
    """
    minutes = today.duration_minutes or 0.0
    if minutes < DURING_THRESHOLD_MINUTES or today.sport in LOW_GLYCOGEN_SPORTS:
        return None

    hours = minutes / 60.0
    if minutes >= DURING_HIGH_THRESHOLD_MINUTES:
        per_hour = (60, 90)
        note = "oltre le due ore serve un mix di zuccheri diversi: gel o bevanda, non solo glucosio"
    else:
        per_hour = (30, 60)
        note = "un gel o una borraccia zuccherata ogni mezz'ora, prima di avere fame"

    return DuringSession(
        carb_g_per_hour=per_hour,
        total_carb_g=(round(per_hour[0] * hours), round(per_hour[1] * hours)),
        note=note,
    )


# The post-session window: 1.0-1.2 g/kg of carbohydrate and 0.3 g/kg of protein inside
# the hour. Only worth naming after a session that actually emptied something.
RECOVERY_CARB_G_PER_KG = 1.0
RECOVERY_PROTEIN_G_PER_KG = 0.3


def recovery_window(today: DayTarget, weight_kg: float) -> RecoveryWindow | None:
    if today.load not in ("duro", "molto_lungo"):
        return None
    carb_g = round(RECOVERY_CARB_G_PER_KG * weight_kg)
    protein_g = round(RECOVERY_PROTEIN_G_PER_KG * weight_kg)
    carb_portions, _ = _fill(carb_g, ["banana", "pane", "miele o marmellata"], CARB_FOODS)
    protein_portions, _ = _fill(protein_g, ["yogurt greco", "uova"], PROTEIN_FOODS)
    return RecoveryWindow(
        carb_g=carb_g,
        protein_g=protein_g,
        note="entro un'ora dalla fine: è la finestra in cui il muscolo ricarica più in fretta",
        portions=[*carb_portions, *protein_portions],
    )


def fuelling_facts(fuelling: DailyFuelling, consumed: dict[str, float] | None = None) -> dict:
    """The small deterministic dict handed to the model to be written up.

    Only derived figures, no raw training data and nothing identifying: the model is
    asked to phrase an answer that has already been computed, so it never needs the
    plan, the weight, or a photo to do its job.
    """
    facts = {
        "domani_sessione": fuelling.tomorrow.session_title,
        "domani_carico": fuelling.tomorrow.load,
        "domani_minuti": fuelling.tomorrow.duration_minutes,
        "domani_carboidrati_g": list(fuelling.tomorrow.carb_g) if fuelling.tomorrow.carb_g else None,
        "oggi_carico": fuelling.today.load,
        "oggi_carboidrati_g": list(fuelling.today.carb_g) if fuelling.today.carb_g else None,
        "peso_stimato": fuelling.weight_source == "reference",
    }
    if consumed:
        facts["oggi_assunto"] = {
            "carboidrati_g": round(consumed.get("carb_g", 0.0)),
            "proteine_g": round(consumed.get("protein_g", 0.0)),
        }
    return facts
