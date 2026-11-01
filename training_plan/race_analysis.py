"""The technical read of a long run or a race: how the effort was spent, km by km.

`workout_analysis` answers "did something go wrong, and why". This answers the questions
a coach asks after a marathon whether or not anything went wrong:

- **halves** -- was the race paced (negative, even or positive split);
- **5 km blocks and km splits** -- where time was gained or lost;
- **consistency** -- how much the km paces scattered around the average;
- **fade** -- did the last stretch collapse (the "wall" from km 30 on a marathon);
- **aerobic decoupling** -- speed per heartbeat, first half against second: under 5% is
  an aerobic engine that held, over 10% one that did not;
- **mechanics** -- did the pace come from cadence or from stride, and which one gave way;
- **terrain** -- how much each percent of grade cost, and the grade-adjusted pace;
- **patterns** -- stops, surges, the km that broke the rhythm.

Everything is computed for everyone; the athlete's level only decides what is shown
first (`visible_sections`). A level-1 runner sees three lines and the halves; an athlete
sees the whole table. The heart-rate sections honour `hr_reliability`: a decoupling built
on a sensor that locked onto the cadence would be a confident wrong number, so it is
withheld and the reason given instead.
"""

from __future__ import annotations

import math
from bisect import bisect_left
from collections.abc import Sequence
from statistics import mean, pstdev
from typing import Any

from .hr_reliability import HrReliability

# Below this a run is not long enough for halves and fades to mean anything.
MIN_DISTANCE_KM = 8.0
MARATHON_KM = 42.195
# Where the marathon "wall" is measured from.
WALL_KM = 30.0
# Pace changes inside these are "even".
EVEN_SPLIT_PCT = 1.5
FADE_PCT = 5.0
WALL_PCT = 10.0
DECOUPLING_GOOD_PCT = 5.0
DECOUPLING_POOR_PCT = 10.0
# A km faster or slower than the average by this much breaks the rhythm.
SURGE_PCT = 5.0
STOP_SPEED_MS = 1.0
ALTITUDE_DEADBAND_M = 1.0
MIN_STOP_S = 10

SECTIONS_BY_LEVEL: dict[int, list[str]] = {
    1: ["insights", "halves", "fade", "splits_5k"],
    2: ["insights", "halves", "fade", "splits_5k", "consistency", "decoupling", "km_splits"],
    3: [
        "insights", "halves", "fade", "splits_5k", "consistency", "decoupling",
        "km_splits", "mechanics", "terrain", "patterns",
    ],
}
MAX_INSIGHTS_BY_LEVEL = {1: 3, 2: 5, 3: 8}


def _fmt_pace(sec_per_km: float | None) -> str:
    if sec_per_km is None or sec_per_km <= 0 or math.isnan(sec_per_km):
        return "—"
    total = round(sec_per_km)
    return f"{total // 60}:{total % 60:02d}/km"


def _fmt_time(seconds: float) -> str:
    total = round(seconds)
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def _spm(cadence: float | None) -> float | None:
    if cadence is None or cadence <= 0:
        return None
    return cadence * 2 if cadence < 110 else cadence


class _Track:
    """The streams as monotonic distance/time pairs, with lookups by distance."""

    def __init__(self, streams: dict[str, Sequence[float | None]], hr: Sequence[float | None]):
        times = streams.get("time") or []
        dists = streams.get("distance") or []
        n = len(times)

        def channel(name: str) -> Sequence[float | None]:
            values = streams.get(name)
            return values if values is not None and len(values) == n else [None] * n

        speeds, cads, alts = channel("velocity_smooth"), channel("cadence"), channel("altitude")
        self.t: list[float] = []
        self.d: list[float] = []
        self.speed: list[float | None] = []
        self.hr: list[float | None] = []
        self.cad: list[float | None] = []
        self.alt: list[float | None] = []
        last_d = -1.0
        for i in range(min(n, len(dists))):
            t, d = times[i], dists[i]
            if t is None or d is None or d < last_d:
                continue
            last_d = d
            self.t.append(float(t))
            self.d.append(float(d))
            self.speed.append(speeds[i])
            self.hr.append(hr[i] if i < len(hr) else None)
            self.cad.append(_spm(cads[i]))
            self.alt.append(alts[i])

    @property
    def total_m(self) -> float:
        return self.d[-1] - self.d[0] if self.d else 0.0

    def time_at(self, metres: float) -> float:
        """Elapsed time at a distance from the start, interpolated."""
        target = self.d[0] + metres
        j = bisect_left(self.d, target)
        if j <= 0:
            return 0.0
        if j >= len(self.d):
            return self.t[-1] - self.t[0]
        d0, d1, t0, t1 = self.d[j - 1], self.d[j], self.t[j - 1], self.t[j]
        share = (target - d0) / (d1 - d0) if d1 > d0 else 0.0
        return t0 + share * (t1 - t0) - self.t[0]

    def indices(self, start_m: float, end_m: float) -> range:
        lo = bisect_left(self.d, self.d[0] + start_m)
        hi = bisect_left(self.d, self.d[0] + end_m)
        return range(lo, max(lo, hi))

    def stretch(self, start_m: float, end_m: float) -> dict[str, Any]:
        """Pace, heart rate, cadence, stride and climb over one stretch of the course."""
        seconds = self.time_at(end_m) - self.time_at(start_m)
        km = (end_m - start_m) / 1000.0
        idx = self.indices(start_m, end_m)
        hrs = [self.hr[i] for i in idx if self.hr[i] is not None and self.hr[i] > 30]
        cads = [self.cad[i] for i in idx if self.cad[i] is not None and self.cad[i] > 120]
        # Climb counted with a dead band: GPS/barometric altitude wobbles by a metre or
        # two sample to sample, and summing every wobble doubled the climb of a flat
        # marathon (190 m against the ~90 m Strava reports).
        gain = loss = 0.0
        ref = None
        for i in idx:
            a = self.alt[i]
            if a is None:
                continue
            if ref is None:
                ref = a
            elif a - ref >= ALTITUDE_DEADBAND_M:
                gain += a - ref
                ref = a
            elif ref - a >= ALTITUDE_DEADBAND_M:
                loss += ref - a
                ref = a
        pace = seconds / km if km > 0 else None
        cadence = mean(cads) if cads else None
        stride = (1000.0 / pace) * 60.0 / cadence if pace and cadence else None
        net = None
        if len(idx) >= 2:
            first = next((self.alt[i] for i in idx if self.alt[i] is not None), None)
            last = next((self.alt[i] for i in reversed(idx) if self.alt[i] is not None), None)
            if first is not None and last is not None and end_m > start_m:
                net = (last - first) / (end_m - start_m) * 100.0
        # Hrs on fewer than half the samples are a gap, not an average.
        hr_avg = mean(hrs) if hrs and len(hrs) >= len(idx) / 2 else None
        return {
            "seconds": seconds,
            "pace_sec": pace,
            "hr": hr_avg,
            "cadence": cadence,
            "stride_m": stride,
            "gain_m": gain,
            "loss_m": loss,
            "grade_pct": net,
        }


def _gap_pace(pace_sec: float | None, grade_pct: float | None) -> float | None:
    """Grade-adjusted pace: what the km would have cost on the flat.

    A linear approximation of the metabolic cost of running on a slope (Minetti 2002)
    around the gentle grades a road race has: about 3.3% of pace per percent uphill, and
    half of that back downhill. Not for trails.
    """
    if pace_sec is None or grade_pct is None:
        return pace_sec
    factor = 0.033 * grade_pct if grade_pct >= 0 else 0.018 * grade_pct
    return pace_sec / (1 + factor)


def _split_kind(pct: float) -> str:
    if pct <= -EVEN_SPLIT_PCT:
        return "negativo"
    if pct < EVEN_SPLIT_PCT:
        return "pari"
    if pct < WALL_PCT:
        return "positivo"
    return "crollo"


def _pearson(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) < 4:
        return None
    mx, my = mean(xs), mean(ys)
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if sx == 0 or sy == 0:
        return None
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy)


def _slope(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) < 4:
        return None
    mx, my = mean(xs), mean(ys)
    den = sum((x - mx) ** 2 for x in xs)
    if den == 0:
        return None
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den


def analyze(
    streams: dict[str, Sequence[float | None]],
    *,
    hr: Sequence[float | None],
    reliability: HrReliability | None,
    level: int = 1,
) -> dict[str, Any] | None:
    """The technical read of one run, or None when it is too short to have one.

    `hr` is the cleaned heart rate, already masked where `reliability` says the sensor
    stopped measuring the heart.
    """
    track = _Track(streams, hr)
    if len(track.d) < 20:
        return None
    total_m = track.total_m
    total_km = total_m / 1000.0
    if total_km < MIN_DISTANCE_KM:
        return None
    level = level if level in SECTIONS_BY_LEVEL else 1
    total_s = track.time_at(total_m)
    avg_pace = total_s / total_km

    # ---- halves ----
    half_m = total_m / 2
    t1 = track.time_at(half_m)
    t2 = total_s - t1
    split_pct = (t2 - t1) / t1 * 100.0 if t1 > 0 else 0.0
    halves = {
        "first_time": _fmt_time(t1),
        "second_time": _fmt_time(t2),
        "first_pace": _fmt_pace(t1 / (half_m / 1000)),
        "second_pace": _fmt_pace(t2 / (half_m / 1000)),
        "difference_s": round(t2 - t1),
        "split_pct": round(split_pct, 1),
        "kind": _split_kind(split_pct),
    }

    # ---- km splits ----
    km_splits: list[dict[str, Any]] = []
    whole_kms = int(total_km)
    for k in range(whole_kms):
        s = track.stretch(k * 1000.0, (k + 1) * 1000.0)
        gap = _gap_pace(s["pace_sec"], s["grade_pct"])
        km_splits.append({
            "km": k + 1,
            "pace_sec": round(s["pace_sec"]) if s["pace_sec"] else None,
            "pace": _fmt_pace(s["pace_sec"]),
            "gap_pace": _fmt_pace(gap),
            "hr": round(s["hr"]) if s["hr"] else None,
            "cadence": round(s["cadence"]) if s["cadence"] else None,
            "stride_m": round(s["stride_m"], 2) if s["stride_m"] else None,
            "gain_m": round(s["gain_m"]),
            "vs_avg_pct": round((s["pace_sec"] - avg_pace) / avg_pace * 100, 1) if s["pace_sec"] else None,
        })

    # ---- 5 km blocks ----
    splits_5k: list[dict[str, Any]] = []
    start = 0.0
    while start < total_m - 200:
        end = min(total_m, start + 5000.0)
        s = track.stretch(start, end)
        splits_5k.append({
            "label": f"{start / 1000:.0f}–{end / 1000:.1f}".replace(".0", "") + " km",
            "start_km": round(start / 1000, 1),
            "end_km": round(end / 1000, 1),
            "time": _fmt_time(s["seconds"]),
            "pace_sec": round(s["pace_sec"]) if s["pace_sec"] else None,
            "pace": _fmt_pace(s["pace_sec"]),
            "hr": round(s["hr"]) if s["hr"] else None,
            "cadence": round(s["cadence"]) if s["cadence"] else None,
            "stride_m": round(s["stride_m"], 2) if s["stride_m"] else None,
            "gain_m": round(s["gain_m"]),
            "vs_avg_pct": round((s["pace_sec"] - avg_pace) / avg_pace * 100, 1) if s["pace_sec"] else None,
        })
        start = end

    # ---- consistency ----
    # The first km carries the start (crowd, watch locking on), so it is left out.
    steady = [k["pace_sec"] for k in km_splits[1:] if k["pace_sec"]]
    consistency = None
    if len(steady) >= 4:
        cv = pstdev(steady) / mean(steady) * 100.0
        fastest = min(km_splits, key=lambda k: k["pace_sec"] or 1e9)
        slowest = max(km_splits, key=lambda k: k["pace_sec"] or 0)
        consistency = {
            "cv_pct": round(cv, 1),
            "rating": "ottima" if cv < 3 else "buona" if cv < 5 else "irregolare",
            "fastest_km": fastest["km"],
            "fastest_pace": fastest["pace"],
            "slowest_km": slowest["km"],
            "slowest_pace": slowest["pace"],
        }

    # ---- fade ----
    wall_from_m = WALL_KM * 1000 if total_km >= 35 else total_m * 0.75
    early = track.stretch(1000.0, wall_from_m)
    late = track.stretch(wall_from_m, total_m)
    fade = None
    if early["pace_sec"] and late["pace_sec"]:
        fade_pct = (late["pace_sec"] - early["pace_sec"]) / early["pace_sec"] * 100.0
        fade = {
            "from_km": round(wall_from_m / 1000, 1),
            "before_pace": _fmt_pace(early["pace_sec"]),
            "after_pace": _fmt_pace(late["pace_sec"]),
            "change_pct": round(fade_pct, 1),
            "kind": "muro" if fade_pct >= WALL_PCT else "calo" if fade_pct >= FADE_PCT else "tenuta",
        }

    # ---- aerobic decoupling ----
    decoupling: dict[str, Any]
    unreliable = reliability is not None and reliability.verdict == "inaffidabile"
    first, second = track.stretch(1000.0, half_m), track.stretch(half_m, total_m)
    if unreliable:
        decoupling = {
            "available": False,
            "reason": "Il battito non è affidabile per tutta la corsa: il confronto tra ritmo e battiti sarebbe un numero sbagliato.",
        }
    elif first["hr"] and second["hr"] and first["pace_sec"] and second["pace_sec"]:
        ef1 = (1000 / first["pace_sec"]) / first["hr"]
        ef2 = (1000 / second["pace_sec"]) / second["hr"]
        pct = (ef1 - ef2) / ef1 * 100.0
        decoupling = {
            "available": True,
            "pct": round(pct, 1),
            "rating": "ottimo" if pct < DECOUPLING_GOOD_PCT else "da migliorare" if pct < DECOUPLING_POOR_PCT else "alto",
            "hr_first": round(first["hr"]),
            "hr_second": round(second["hr"]),
        }
    else:
        decoupling = {"available": False, "reason": "Manca il battito su una delle due metà."}

    # ---- mechanics ----
    mechanics = None
    edge = max(2000.0, total_m * 0.15)
    open_s, close_s = track.stretch(1000.0, 1000.0 + edge), track.stretch(total_m - edge, total_m)
    if open_s["cadence"] and close_s["cadence"] and open_s["stride_m"] and close_s["stride_m"]:
        cad_pct = (close_s["cadence"] - open_s["cadence"]) / open_s["cadence"] * 100
        stride_pct = (close_s["stride_m"] - open_s["stride_m"]) / open_s["stride_m"] * 100
        # Over the km splits: when the pace changed, did cadence or stride move with it?
        rows = [k for k in km_splits if k["pace_sec"] and k["cadence"] and k["stride_m"]]
        speeds = [1000 / k["pace_sec"] for k in rows]
        mechanics = {
            "cadence_start": round(open_s["cadence"]),
            "cadence_end": round(close_s["cadence"]),
            "cadence_change_pct": round(cad_pct, 1),
            "stride_start_m": round(open_s["stride_m"], 2),
            "stride_end_m": round(close_s["stride_m"], 2),
            "stride_change_pct": round(stride_pct, 1),
            "speed_follows_cadence": _round(_pearson(speeds, [k["cadence"] for k in rows])),
            "speed_follows_stride": _round(_pearson(speeds, [k["stride_m"] for k in rows])),
        }

    # ---- terrain ----
    terrain = None
    grades: list[float] = []
    paces: list[float] = []
    for k in (k for k in km_splits if k["pace_sec"]):
        s = track.stretch((k["km"] - 1) * 1000.0, k["km"] * 1000.0)
        if s["grade_pct"] is not None:
            grades.append(s["grade_pct"])
            paces.append(k["pace_sec"])
    gain_total = sum(k["gain_m"] for k in km_splits)
    if grades:
        slope = _slope(grades, paces) if (max(grades) - min(grades)) > 1.0 else None
        terrain = {
            "gain_m": round(gain_total),
            "seconds_per_grade_pct": round(slope) if slope is not None else None,
            "flat": max(abs(g) for g in grades) < 1.0,
        }

    # ---- patterns ----
    stops: list[dict[str, Any]] = []
    run_start = None
    for i, sp in enumerate(track.speed):
        slow = sp is not None and sp < STOP_SPEED_MS
        if slow and run_start is None:
            run_start = i
        elif not slow and run_start is not None:
            dur = track.t[i] - track.t[run_start]
            if dur >= MIN_STOP_S:
                stops.append({"km": round((track.d[run_start] - track.d[0]) / 1000, 1), "seconds": round(dur)})
            run_start = None
    surges = [k["km"] for k in km_splits[1:] if k["vs_avg_pct"] is not None and k["vs_avg_pct"] <= -SURGE_PCT]
    drops = [k["km"] for k in km_splits[1:] if k["vs_avg_pct"] is not None and k["vs_avg_pct"] >= SURGE_PCT]
    hr_pace = None
    if not unreliable:
        rows = [k for k in km_splits if k["hr"] and k["pace_sec"]]
        hr_pace = _round(_pearson([k["hr"] for k in rows], [1000 / k["pace_sec"] for k in rows]))
    patterns = {
        "stops": stops,
        "stopped_s": sum(s["seconds"] for s in stops),
        "fast_kms": surges,
        "slow_kms": drops,
        "hr_follows_pace": hr_pace,
    }

    insights = _insights(
        total_km=total_km, halves=halves, fade=fade, consistency=consistency, decoupling=decoupling,
        mechanics=mechanics, terrain=terrain, patterns=patterns, reliability=reliability, level=level,
    )

    return {
        "level": level,
        "visible_sections": SECTIONS_BY_LEVEL[level],
        "is_marathon": abs(total_km - MARATHON_KM) < 1.0,
        "distance_km": round(total_km, 2),
        "time": _fmt_time(total_s),
        "avg_pace": _fmt_pace(avg_pace),
        "insights": insights[: MAX_INSIGHTS_BY_LEVEL[level]],
        "halves": halves,
        "splits_5k": splits_5k,
        "km_splits": km_splits,
        "consistency": consistency,
        "fade": fade,
        "decoupling": decoupling,
        "mechanics": mechanics,
        "terrain": terrain,
        "patterns": patterns,
    }


def _round(value: float | None) -> float | None:
    return round(value, 2) if value is not None else None


def _insights(
    *,
    total_km: float,
    halves: dict[str, Any],
    fade: dict[str, Any] | None,
    consistency: dict[str, Any] | None,
    decoupling: dict[str, Any],
    mechanics: dict[str, Any] | None,
    terrain: dict[str, Any] | None,
    patterns: dict[str, Any],
    reliability: HrReliability | None,
    level: int,
) -> list[dict[str, str]]:
    """The read in sentences, most important first. `tone` drives the colour on screen."""
    out: list[dict[str, str]] = []
    simple = level == 1

    kind = halves["kind"]
    diff = abs(halves["difference_s"])
    diff_txt = f"{diff // 60}'{diff % 60:02d}\"" if diff >= 60 else f"{diff}\""
    if kind == "negativo":
        out.append({"tone": "good", "title": "Seconda metà più veloce",
                    "text": f"Hai chiuso la seconda metà {diff_txt} più veloce della prima. "
                            + ("È il modo migliore di correre una gara lunga." if simple
                               else "Split negativo: energia dosata bene, nessun debito accumulato all'inizio.")})
    elif kind == "pari":
        out.append({"tone": "good", "title": "Ritmo regolare dall'inizio alla fine",
                    "text": f"Le due metà differiscono di appena {diff_txt}. "
                            + ("Hai gestito bene le energie." if simple
                               else f"Split pari ({halves['split_pct']:+.1f}%): gestione da manuale.")})
    elif kind == "positivo":
        out.append({"tone": "warn", "title": "Seconda metà più lenta",
                    "text": f"Hai perso {diff_txt} nella seconda metà. "
                            + ("La prossima volta parti un po' più piano." if simple
                               else f"Split positivo del {halves['split_pct']:.1f}%: la partenza era probabilmente sopra il tuo ritmo sostenibile.")})
    else:
        out.append({"tone": "bad", "title": "Forte calo nella seconda metà",
                    "text": f"La seconda metà è costata {diff_txt} in più. "
                            + ("Partire più piano ti farà finire meglio." if simple
                               else f"Split del {halves['split_pct']:.1f}%: partenza troppo veloce o rifornimento insufficiente.")})

    if reliability is not None and reliability.verdict == "inaffidabile":
        step = reliability.key_step
        where = f" dal km {step.distance_km:.0f}" if step and step.distance_km is not None else ""
        out.append({"tone": "warn", "title": f"Battito non affidabile{where}",
                    "text": ("Il sensore dell'orologio ha smesso di misurare il cuore: i battiti di questo tratto non vanno presi sul serio."
                             if simple else
                             "Il sensore ottico si è agganciato al ritmo dei passi: zone, carico e confronto ritmo/battiti di quel tratto sono esclusi. "
                             "Per le gare usa la fascia cardio.")})

    if fade is not None:
        if fade["kind"] == "muro":
            out.append({"tone": "bad", "title": f"Il muro dopo il km {fade['from_km']:.0f}",
                        "text": f"Dal km {fade['from_km']:.0f} il passo è sceso da {fade['before_pace']} a {fade['after_pace']} ({fade['change_pct']:+.1f}%)."
                                + ("" if simple else " Tipico di scorte di glicogeno finite: rivedi i rifornimenti (60-90 g di carboidrati l'ora).")})
        elif fade["kind"] == "tenuta" and total_km >= 30:
            out.append({"tone": "good", "title": "Nessun muro",
                        "text": f"Dopo il km {fade['from_km']:.0f} hai tenuto {fade['after_pace']}: "
                                + ("le gambe hanno retto fino alla fine." if simple else "resistenza e rifornimenti hanno funzionato.")})

    if consistency is not None and not simple:
        out.append({"tone": "good" if consistency["rating"] != "irregolare" else "warn",
                    "title": f"Regolarità {consistency['rating']}",
                    "text": f"I km oscillano del {consistency['cv_pct']:.1f}% attorno al passo medio "
                            f"(il più veloce il {consistency['fastest_km']}° a {consistency['fastest_pace']}, "
                            f"il più lento il {consistency['slowest_km']}° a {consistency['slowest_pace']})."})

    if decoupling.get("available") and not simple:
        pct = decoupling["pct"]
        out.append({"tone": "good" if pct < DECOUPLING_GOOD_PCT else "warn" if pct < DECOUPLING_POOR_PCT else "bad",
                    "title": f"Tenuta aerobica: {decoupling['rating']}",
                    "text": f"A parità di passo, il cuore nella seconda metà ha lavorato il {pct:.1f}% in più "
                            f"({decoupling['hr_first']} → {decoupling['hr_second']} bpm). Sotto il 5% è ottimo."})

    if mechanics is not None and level == 3:
        if mechanics["stride_change_pct"] <= -4 and abs(mechanics["cadence_change_pct"]) < 2:
            out.append({"tone": "warn", "title": "La falcata si è accorciata nel finale",
                        "text": f"Cadenza invariata ({mechanics['cadence_start']} → {mechanics['cadence_end']} passi/min) ma falcata "
                                f"da {mechanics['stride_start_m']:.2f} a {mechanics['stride_end_m']:.2f} m: è la spinta muscolare che cala. "
                                "Lavora su forza e salite brevi."})
        else:
            follows = "cadenza" if (mechanics["speed_follows_cadence"] or 0) > (mechanics["speed_follows_stride"] or 0) else "falcata"
            out.append({"tone": "neutral", "title": "Meccanica stabile",
                        "text": f"Cadenza {mechanics['cadence_start']} → {mechanics['cadence_end']} passi/min, falcata "
                                f"{mechanics['stride_start_m']:.2f} → {mechanics['stride_end_m']:.2f} m. "
                                f"Quando hai cambiato ritmo l'hai fatto soprattutto con la {follows}."})

    if terrain is not None and level == 3 and terrain["seconds_per_grade_pct"] is not None and not terrain["flat"]:
        out.append({"tone": "neutral", "title": "Quanto ti costa la pendenza",
                    "text": f"Ogni 1% di pendenza ti è costato circa {terrain['seconds_per_grade_pct']}\"/km."})

    if patterns["stopped_s"] >= 30 and not simple:
        out.append({"tone": "neutral", "title": f"{len(patterns['stops'])} soste",
                    "text": f"In totale {patterns['stopped_s']}\" fermo, ai km "
                            + ", ".join(f"{s['km']:.0f}" for s in patterns["stops"][:5]) + "."})
    return out
