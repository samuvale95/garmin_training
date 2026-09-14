"""Garmin's own enum strings, turned into Italian.

Garmin Connect's wellness endpoints return two kinds of text. One is prose, written for
a human. The other is a screaming-snake-case key -- `MOD_RT_LOW_SS_GOOD`,
`HIGH_ACWR_HIGH` -- that Garmin's own apps look up in a translation table before showing
anything. This app was printing the second kind straight onto the readiness card, which
is how a training screen ended up with `MOD_RT_LOW_SS_GOOD` under the day's score.

The keys are undocumented and the list is open-ended, so the rule here is the same one
`body_insights.py` applies to the field names themselves: decode what is recognised,
and return `None` -- never the raw key -- for anything that is not. A card with one
sentence missing is fine. A card showing an internal identifier is not.

The grammar, inferred from the values a live account returns:

    <LEVEL>_<FACTOR>_<VERDICT>[_<FACTOR>_<VERDICT>...]

`LEVEL` is the readiness band, and each `FACTOR`/`VERDICT` pair is one input Garmin
weighed, with the verdict it reached about it. So `MOD_RT_LOW_SS_GOOD` reads: moderate
readiness, recovery time low, sleep score good -- which, phrased, is the sentence the
user should have been reading all along.
"""

from __future__ import annotations

# The overall readiness band, which is also the first token of every feedback key.
READINESS_LEVELS: dict[str, str] = {
    "NONE": "nessun dato",
    "VERY_LOW": "molto bassa",
    "LOW": "bassa",
    "MOD": "media",
    "MODERATE": "media",
    "HIGH": "alta",
    "VERY_HIGH": "molto alta",
    "PRIME": "ottima",
    "MAXIMUM": "al massimo",
}

# The inputs Garmin weighs, in the order its own card lists them.
FACTORS: dict[str, str] = {
    "SS": "il punteggio del sonno",
    "SH": "la storia del sonno",
    "RT": "il tempo di recupero",
    "HRV": "la variabilità cardiaca",
    "ACWR": "il carico delle ultime settimane",
    "STRESS": "lo stress",
    "SLEEP": "il sonno",
    "NAP": "il sonnellino",
}

# What it says about each of them.
VERDICTS: dict[str, str] = {
    "GOOD": "è buono",
    "HIGH": "è alto",
    "LOW": "è basso",
    "POOR": "è scarso",
    "OK": "è nella norma",
    "BAD": "non aiuta",
    "VERY_HIGH": "è molto alto",
    "VERY_LOW": "è molto basso",
    "OPTIMAL": "è ottimale",
    "BALANCED": "è in equilibrio",
    "UNBALANCED": "è sbilanciato",
    "RECENT": "è recente",
    "NONE": "manca",
}

# Some verdicts read backwards once the factor is in front of them: a *low* recovery
# time is good news, and "il tempo di recupero è basso" is the right sentence but the
# wrong emphasis. These are the pairs worth phrasing by hand.
FACTOR_VERDICT_OVERRIDES: dict[tuple[str, str], str] = {
    ("RT", "LOW"): "il recupero è quasi completo",
    ("RT", "HIGH"): "hai ancora recupero da smaltire",
    ("RT", "VERY_HIGH"): "il recupero arretrato è parecchio",
    ("ACWR", "HIGH"): "il carico delle ultime settimane è salito in fretta",
    ("ACWR", "LOW"): "il carico delle ultime settimane è leggero",
    ("HRV", "LOW"): "la variabilità cardiaca è sotto la tua media",
    ("HRV", "HIGH"): "la variabilità cardiaca è sopra la tua media",
    ("HRV", "BALANCED"): "la variabilità cardiaca è dove di solito",
    ("STRESS", "HIGH"): "lo stress di ieri è stato alto",
}

# Longest factor token first, so `VERY_HIGH` is never read as `VERY` followed by junk
# and `ACWR` is never split. Order matters, which is why this is a tuple and not a set.
_FACTOR_TOKENS = tuple(sorted(FACTORS, key=len, reverse=True))
_VERDICT_TOKENS = tuple(sorted(VERDICTS, key=len, reverse=True))
_LEVEL_TOKENS = tuple(sorted(READINESS_LEVELS, key=len, reverse=True))


def _take(rest: str, tokens: tuple[str, ...]) -> tuple[str | None, str]:
    """The longest token at the head of `rest`, and what is left after it."""
    for token in tokens:
        if rest == token:
            return token, ""
        if rest.startswith(f"{token}_"):
            return token, rest[len(token) + 1 :]
    return None, rest


def readiness_level_label(level: str | None) -> str | None:
    """Garmin's readiness band ("MODERATE") in Italian ("media"), or `None`."""
    if not level:
        return None
    return READINESS_LEVELS.get(level.strip().upper())


def readiness_feedback(key: str | None) -> str | None:
    """`MOD_RT_LOW_SS_GOOD` as a sentence, or `None` when it cannot be read.

    Returning `None` rather than a best guess is the whole point: the caller has a
    deterministic fallback sentence built from the factor percentages, and a half-decoded
    key would be worse than either.

    A value that is already prose -- Garmin does sometimes return one -- is handed back
    untouched, detected by the one thing every key has and no sentence does: it is
    upper-case with underscores and no spaces.
    """
    if not key:
        return None
    raw = key.strip()
    if not raw:
        return None
    if " " in raw or not raw.replace("_", "").isupper():
        return raw

    rest = raw.upper()
    level_token, rest = _take(rest, _LEVEL_TOKENS)
    if level_token is None:
        return None

    clauses: list[str] = []
    while rest:
        factor, rest = _take(rest, _FACTOR_TOKENS)
        if factor is None:
            return None
        verdict, rest = _take(rest, _VERDICT_TOKENS)
        if verdict is None:
            return None
        override = FACTOR_VERDICT_OVERRIDES.get((factor, verdict))
        clauses.append(override or f"{FACTORS[factor]} {VERDICTS[verdict]}")

    level = READINESS_LEVELS[level_token]
    if not clauses:
        return f"Prontezza {level}."
    if len(clauses) == 1:
        return f"Prontezza {level}: {clauses[0]}."
    return f"Prontezza {level}: {', '.join(clauses[:-1])} e {clauses[-1]}."
