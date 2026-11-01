"""Garmin's exercise catalogue, for strength and bodyweight steps.

A strength step on Garmin names its exercise with a `category` and an `exerciseName`
(e.g. PULL_UP / PULL_UP): the watch then shows "Trazioni · 6 ripetizioni" and counts the
sets. Both values must come from Garmin's own catalogue, published at
`https://connect.garmin.com/web-data/exercises/Exercises.json`; a bundled copy keeps
only what this app needs (category, bodyweight flag, primary muscles) in
`data/garmin_exercises.json`.

A plan file may name an exercise by its Garmin name in any case or spacing ("pull up",
"PULL_UP"), as "CATEGORY/NAME" when the same name sits in more than one category, or by
one of the common Italian names below.
"""

from __future__ import annotations

import difflib
import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

_CATALOGUE = Path(__file__).parent / "data" / "garmin_exercises.json"

# Common Italian (and gym-slang) names, onto Garmin's. Kept short on purpose: anything
# not here can still be written with the Garmin name.
ALIASES = {
    "trazioni": "PULL_UP",
    "trazioni presa prona": "PULL_UP",
    "trazioni presa supina": "CHIN_UP",
    "chin up": "CHIN_UP",
    "trazioni presa stretta": "CLOSE_GRIP_CHIN_UP",
    "trazioni con elastico": "BAND_ASSISTED_PULL_UP",
    "muscle up": "MUSCLE_UP",
    "piegamenti": "PUSH_UP",
    "flessioni": "PUSH_UP",
    "piegamenti diamante": "DIAMOND_PUSH_UP",
    "piegamenti pike": "PIKE_PUSH_UP",
    "piegamenti in verticale": "HANDSTAND_PUSH_UP",
    "dip": "BODY_WEIGHT_DIP",
    "dip alle parallele": "BODY_WEIGHT_DIP",
    "dip agli anelli": "RING_DIP",
    "dip alla panca": "BENCH_DIP",
    "australian row": "INVERTED_ROW",
    "rematore inverso": "INVERTED_ROW",
    "squat": "AIR_SQUAT",
    "squat a corpo libero": "AIR_SQUAT",
    "squat saltato": "JUMP_SQUAT",
    "affondi": "LUNGE",
    "plank": "PLANK",
    "plank laterale": "SIDE_PLANK",
    "burpee": "BURPEE",
    "mountain climber": "MOUNTAIN_CLIMBER",
    "l-sit": "L_SIT",
    "l sit": "L_SIT",
    "sollevamento gambe alla sbarra": "HANGING_LEG_RAISE",
    "sollevamento ginocchia alla sbarra": "HANGING_KNEE_RAISE",
    "ponte glutei": "GLUTE_BRIDGE",
    "polpacci": "CALF_RAISE",
    "jumping jack": "JUMPING_JACKS",
    "hollow rock": "HOLLOW_ROCK",
}


@dataclass(frozen=True)
class Exercise:
    category: str
    name: str
    bodyweight: bool
    muscles: tuple[str, ...]

    @property
    def key(self) -> str:
        """How the plan file stores it after resolution."""
        return self.name if _entries().get(self.name, {}).get("c") == self.category else f"{self.category}/{self.name}"


@lru_cache(maxsize=1)
def _entries() -> dict[str, dict]:
    return json.loads(_CATALOGUE.read_text())["exercises"]


def _normalise(raw: str) -> str:
    return "_".join(raw.strip().replace("-", " ").upper().split())


def resolve(raw: str | None) -> Exercise | None:
    """The catalogue exercise a plan file names, or None if there is no such exercise."""
    if not raw or not str(raw).strip():
        return None
    text = str(raw).strip()
    alias = ALIASES.get(text.lower())
    key = alias or (text.upper() if "/" in text else _normalise(text))
    if "/" in key:
        category, name = (part.strip() for part in key.split("/", 1))
        key = f"{_normalise(category)}/{_normalise(name)}"
    entry = _entries().get(key)
    if entry is None:
        return None
    name = key.split("/", 1)[1] if "/" in key else key
    return Exercise(category=entry["c"], name=name, bodyweight=entry["bw"], muscles=tuple(entry["m"]))


def from_garmin(category: str | None, name: str | None) -> Exercise | None:
    """The exercise on a step read back from Garmin."""
    if not name:
        return None
    entries = _entries()
    entry = entries.get(name)
    if entry is None or (category and entry["c"] != category):
        entry = entries.get(f"{category}/{name}") or entry
    if entry is None:
        return Exercise(category=category or "", name=name, bodyweight=False, muscles=())
    return Exercise(category=category or entry["c"], name=name, bodyweight=entry["bw"], muscles=tuple(entry["m"]))


def suggestions(raw: str, limit: int = 3) -> list[str]:
    """Close catalogue names, for an error message that helps fix a typo."""
    names = [k for k in _entries() if "/" not in k] + list(ALIASES)
    return difflib.get_close_matches(_normalise(raw), names, n=limit, cutoff=0.6) or difflib.get_close_matches(
        raw.strip().lower(), list(ALIASES), n=limit, cutoff=0.6
    )
