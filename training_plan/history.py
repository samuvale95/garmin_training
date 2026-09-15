"""Where the past is kept, and how it is kept small.

Until now this app stored nothing it read: every wellness figure came off Garmin on
demand, lived ten minutes in an in-process cache, and was gone. That is the right design
for a screen that answers "how am I today" and the wrong one for every question worth
asking -- *am I getting fitter*, *do my easy days stay easy*, *what did I eat before the
sessions that went well* -- because all of those are questions about a series, and there
was no series.

Three tables, and a codec.

**`wellness_day`** -- one row per day, flat columns, small integers. Two years is 730
rows and a few hundred kilobytes. Nothing clever is needed or wanted here.

**`activity`** -- one row per completed session, carrying the summary figures plus the
running-dynamics fields `technique.py` reads.

**`activity_stream`** -- the reason this module has a codec at all. A single hour of
running is ~3,600 samples across six channels; as JSON that is 250-400 KB per activity,
and as one row per sample it is 3,600 rows per activity and tens of millions across a
history. Both are the wrong shape. One row per activity, all channels packed into a
single compressed blob, is the right one. Measured against this account's real data: a
2h45 run, 9,910 samples across seven channels, is **396 KB of Strava JSON and 22 KB
packed -- a factor of 17**, with the heart-rate channel surviving the roundtrip exactly.

How the packing works
---------------------
Each channel is quantized into the narrowest integer that holds it, with an explicit
scale factor recorded in the header so the decode is exact and inspectable:

    heartrate        uint8    bpm, as-is
    cadence          uint8    as-is
    watts            uint16   as-is
    velocity_smooth  uint16   centimetres per second (scale 100)
    altitude         int16    decimetres (scale 10)
    time             uint16   **delta-encoded** -- see below
    distance         uint16   decimetres, **delta-encoded** for the same reason

`time` and `distance` are the two channels with structure worth exploiting. Both are
monotonically increasing, and the step between samples is small -- a few seconds, a few
metres -- so storing the *differences* turns a series of large growing numbers into a
series of tiny ones that the compressor then flattens almost entirely.

Everything is packed little-endian regardless of the host, so a blob written on one
machine decodes on another.

Zero means "no reading" on the unsigned channels. For heart rate, cadence and power that
matches the physiology -- nobody records a true zero -- so no separate null mask is
needed. Velocity's zero is genuinely ambiguous between "stopped" and "not recorded", and
nothing downstream distinguishes them.
"""

from __future__ import annotations

import json
import logging
import sys
import zlib
from array import array
from dataclasses import dataclass
from datetime import date as date_type
from typing import Any, Iterable, Sequence

from . import db

logger = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS wellness_day (
    user_id           TEXT NOT NULL,
    day               DATE NOT NULL,
    readiness_score   SMALLINT,
    readiness_level   TEXT,
    sleep_total_min   SMALLINT,
    sleep_deep_min    SMALLINT,
    sleep_light_min   SMALLINT,
    sleep_rem_min     SMALLINT,
    sleep_awake_min   SMALLINT,
    sleep_score       SMALLINT,
    hrv_ms            SMALLINT,
    resting_hr        SMALLINT,
    stress_avg        SMALLINT,
    body_battery      SMALLINT,
    steps             INTEGER,
    weight_kg         REAL,
    vo2max            REAL,
    acute_load        REAL,
    acwr              REAL,
    fetched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS activity (
    user_id         TEXT NOT NULL,
    source          TEXT NOT NULL,
    activity_id     BIGINT NOT NULL,
    day             DATE NOT NULL,
    sport           TEXT,
    title           TEXT,
    distance_km     REAL,
    duration_min    REAL,
    avg_hr          SMALLINT,
    max_hr          SMALLINT,
    avg_cadence     REAL,
    avg_power       REAL,
    elevation_gain  REAL,
    summary         JSONB,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, source, activity_id)
);

CREATE INDEX IF NOT EXISTS activity_day_idx ON activity (user_id, day);

CREATE TABLE IF NOT EXISTS activity_stream (
    user_id      TEXT NOT NULL,
    activity_id  BIGINT NOT NULL,
    samples      INTEGER NOT NULL,
    header       JSONB NOT NULL,
    blob         BYTEA NOT NULL,
    raw_bytes    INTEGER NOT NULL,
    packed_bytes INTEGER NOT NULL,
    fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, activity_id)
);

CREATE TABLE IF NOT EXISTS backfill_progress (
    user_id     TEXT NOT NULL,
    task        TEXT NOT NULL,
    cursor      TEXT,
    done        BOOLEAN NOT NULL DEFAULT FALSE,
    note        TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, task)
);
"""


def ensure_schema() -> None:
    with db.connect() as conn:
        conn.execute(SCHEMA)


# ---- the stream codec --------------------------------------------------------------------

# name -> (array typecode, scale, delta-encoded)
#
# The typecodes are Python's `array` codes: B = uint8, H = uint16, h = int16, I = uint32.
# `scale` is what the float is multiplied by before rounding, so decoding divides by it.
CHANNEL_SPECS: dict[str, tuple[str, float, bool]] = {
    "time": ("H", 1.0, True),
    "distance": ("H", 10.0, True),
    "heartrate": ("B", 1.0, False),
    "cadence": ("B", 1.0, False),
    "watts": ("H", 1.0, False),
    "velocity_smooth": ("H", 100.0, False),
    "altitude": ("h", 10.0, False),
}

_LIMITS: dict[str, tuple[int, int]] = {
    "B": (0, 255),
    "H": (0, 65535),
    "h": (-32768, 32767),
    "I": (0, 4294967295),
}


def _pack_channel(values: Sequence[Any], typecode: str, scale: float, delta: bool) -> bytes:
    """One channel as little-endian packed integers.

    Out-of-range values are **clamped, never wrapped**: a spurious 70,000-watt sample
    would silently become 4,464 under two's-complement wraparound, and a corrupted
    number that looks plausible is worse than one that is obviously pinned to the top of
    the scale.
    """
    low, high = _LIMITS[typecode]
    out = array(typecode)
    previous = 0
    for value in values:
        if value is None:
            number = 0
        else:
            number = round(float(value) * scale)
            if delta:
                number, previous = number - previous, number
        out.append(max(low, min(high, number)))
    if sys.byteorder == "big":
        out.byteswap()
    return out.tobytes()


def _unpack_channel(raw: bytes, typecode: str, scale: float, delta: bool, count: int) -> list[float | None]:
    out = array(typecode)
    out.frombytes(raw[: count * out.itemsize])
    if sys.byteorder == "big":
        out.byteswap()

    values: list[float | None] = []
    running = 0
    for number in out:
        if delta:
            running += number
            values.append(running / scale)
        elif number == 0 and typecode in ("B", "H"):
            # Zero is the "no reading" marker on the unsigned channels; see the module
            # docstring for why that needs no separate null mask.
            values.append(None)
        else:
            values.append(number / scale)
    return values


@dataclass
class PackedStream:
    samples: int
    header: dict
    blob: bytes
    raw_bytes: int

    @property
    def packed_bytes(self) -> int:
        return len(self.blob)

    @property
    def ratio(self) -> float:
        return self.raw_bytes / self.packed_bytes if self.packed_bytes else 0.0


def pack_streams(streams: dict[str, list]) -> PackedStream | None:
    """Strava's `{channel: [samples]}` as one compressed blob.

    Channels this codec has no spec for are dropped rather than stored as-is: an unknown
    channel would have to go in uncompressed and un-typed, which is how a "compact"
    format quietly stops being one.
    """
    known = {name: values for name, values in streams.items() if name in CHANNEL_SPECS and values}
    if not known:
        return None

    # All channels of one activity are sampled together, so they should be the same
    # length -- but Strava has been seen to disagree with itself by a sample or two, and
    # a decode that walks off the end of a short channel is worse than a truncated one.
    count = min(len(values) for values in known.values())
    if count == 0:
        return None

    order: list[dict] = []
    chunks: list[bytes] = []
    raw_bytes = 0
    for name in sorted(known):
        typecode, scale, delta = CHANNEL_SPECS[name]
        packed = _pack_channel(known[name][:count], typecode, scale, delta)
        raw_bytes += len(packed)
        chunks.append(packed)
        order.append({"name": name, "dtype": typecode, "scale": scale, "delta": delta, "bytes": len(packed)})

    blob = zlib.compress(b"".join(chunks), 9)
    return PackedStream(
        samples=count,
        header={"channels": order, "samples": count},
        blob=blob,
        raw_bytes=raw_bytes,
    )


def unpack_streams(header: dict, blob: bytes) -> dict[str, list[float | None]]:
    """The inverse of `pack_streams`, exactly -- within the quantization the header
    declares."""
    raw = zlib.decompress(blob)
    count = int(header["samples"])
    streams: dict[str, list[float | None]] = {}
    offset = 0
    for channel in header["channels"]:
        size = int(channel["bytes"])
        streams[channel["name"]] = _unpack_channel(
            raw[offset : offset + size], channel["dtype"], float(channel["scale"]), bool(channel["delta"]), count
        )
        offset += size
    return streams


# ---- writes ---------------------------------------------------------------------------

_WELLNESS_COLUMNS = (
    "readiness_score",
    "readiness_level",
    "sleep_total_min",
    "sleep_deep_min",
    "sleep_light_min",
    "sleep_rem_min",
    "sleep_awake_min",
    "sleep_score",
    "hrv_ms",
    "resting_hr",
    "stress_avg",
    "body_battery",
    "steps",
    "weight_kg",
    "vo2max",
    "acute_load",
    "acwr",
)


def save_wellness_day(user_id: str, day: date_type, values: dict) -> None:
    """Upsert one day. Re-running the backfill over a day already stored overwrites it,
    which is what makes the job safe to re-run after an interruption."""
    columns = ", ".join(_WELLNESS_COLUMNS)
    placeholders = ", ".join(["%s"] * len(_WELLNESS_COLUMNS))
    updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in _WELLNESS_COLUMNS)
    row = [values.get(c) for c in _WELLNESS_COLUMNS]
    with db.connect() as conn:
        conn.execute(
            f"""INSERT INTO wellness_day (user_id, day, {columns})
                VALUES (%s, %s, {placeholders})
                ON CONFLICT (user_id, day) DO UPDATE SET {updates}, fetched_at = now()""",
            [user_id, day, *row],
        )


def save_activity(user_id: str, source: str, activity_id: int, day: date_type, values: dict) -> None:
    with db.connect() as conn:
        conn.execute(
            """INSERT INTO activity (user_id, source, activity_id, day, sport, title, distance_km,
                                     duration_min, avg_hr, max_hr, avg_cadence, avg_power,
                                     elevation_gain, summary)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (user_id, source, activity_id) DO UPDATE SET
                   day = EXCLUDED.day, sport = EXCLUDED.sport, title = EXCLUDED.title,
                   distance_km = EXCLUDED.distance_km, duration_min = EXCLUDED.duration_min,
                   avg_hr = EXCLUDED.avg_hr, max_hr = EXCLUDED.max_hr,
                   avg_cadence = EXCLUDED.avg_cadence, avg_power = EXCLUDED.avg_power,
                   elevation_gain = EXCLUDED.elevation_gain, summary = EXCLUDED.summary,
                   fetched_at = now()""",
            [
                user_id,
                source,
                activity_id,
                day,
                values.get("sport"),
                values.get("title"),
                values.get("distance_km"),
                values.get("duration_min"),
                values.get("avg_hr"),
                values.get("max_hr"),
                values.get("avg_cadence"),
                values.get("avg_power"),
                values.get("elevation_gain"),
                json.dumps(values.get("summary") or {}),
            ],
        )


def save_stream(user_id: str, activity_id: int, packed: PackedStream) -> None:
    with db.connect() as conn:
        conn.execute(
            """INSERT INTO activity_stream (user_id, activity_id, samples, header, blob,
                                            raw_bytes, packed_bytes)
               VALUES (%s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (user_id, activity_id) DO UPDATE SET
                   samples = EXCLUDED.samples, header = EXCLUDED.header, blob = EXCLUDED.blob,
                   raw_bytes = EXCLUDED.raw_bytes, packed_bytes = EXCLUDED.packed_bytes,
                   fetched_at = now()""",
            [user_id, activity_id, packed.samples, json.dumps(packed.header), packed.blob,
             packed.raw_bytes, packed.packed_bytes],
        )


# ---- reads ------------------------------------------------------------------------------


def load_streams(user_id: str, activity_id: int) -> dict[str, list[float | None]] | None:
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT header, blob FROM activity_stream WHERE user_id = %s AND activity_id = %s",
            [user_id, activity_id],
        )
        row = cur.fetchone()
    if not row:
        return None
    header, blob = row
    return unpack_streams(header, bytes(blob))


def wellness_between(user_id: str, start: date_type, end: date_type) -> list[dict]:
    columns = ("day", *_WELLNESS_COLUMNS)
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"SELECT {', '.join(columns)} FROM wellness_day "
            "WHERE user_id = %s AND day BETWEEN %s AND %s ORDER BY day",
            [user_id, start, end],
        )
        return [dict(zip(columns, row)) for row in cur.fetchall()]


def activities_between(user_id: str, start: date_type, end: date_type) -> list[dict]:
    columns = ("source", "activity_id", "day", "sport", "title", "distance_km", "duration_min",
               "avg_hr", "max_hr", "avg_cadence", "avg_power", "elevation_gain")
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"SELECT {', '.join(columns)} FROM activity "
            "WHERE user_id = %s AND day BETWEEN %s AND %s ORDER BY day",
            [user_id, start, end],
        )
        return [dict(zip(columns, row)) for row in cur.fetchall()]


def stored_days(user_id: str) -> set[date_type]:
    """Which days are already in, so the backfill can skip them on a re-run."""
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT day FROM wellness_day WHERE user_id = %s", [user_id])
        return {row[0] for row in cur.fetchall()}


def stored_stream_ids(user_id: str) -> set[int]:
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT activity_id FROM activity_stream WHERE user_id = %s", [user_id])
        return {row[0] for row in cur.fetchall()}


def storage_report(user_id: str) -> dict:
    """What is stored and what it costs -- the answer to "how big is this going to get"."""
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT count(*), min(day), max(day) FROM wellness_day WHERE user_id = %s", [user_id]
        )
        days, first_day, last_day = cur.fetchone()
        cur.execute("SELECT count(*) FROM activity WHERE user_id = %s", [user_id])
        (activities,) = cur.fetchone()
        cur.execute(
            "SELECT count(*), coalesce(sum(raw_bytes), 0), coalesce(sum(packed_bytes), 0), "
            "coalesce(sum(samples), 0) FROM activity_stream WHERE user_id = %s",
            [user_id],
        )
        streams, raw, packed, samples = cur.fetchone()

    return {
        "wellness_days": days,
        "first_day": first_day,
        "last_day": last_day,
        "activities": activities,
        "streams": streams,
        "stream_samples": samples,
        "stream_raw_bytes": raw,
        "stream_packed_bytes": packed,
        "stream_ratio": (raw / packed) if packed else 0.0,
    }


# ---- resumable progress ------------------------------------------------------------------


def get_progress(user_id: str, task: str) -> dict | None:
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT cursor, done, note FROM backfill_progress WHERE user_id = %s AND task = %s",
            [user_id, task],
        )
        row = cur.fetchone()
    return {"cursor": row[0], "done": row[1], "note": row[2]} if row else None


def set_progress(user_id: str, task: str, *, cursor: str | None = None, done: bool = False, note: str | None = None) -> None:
    with db.connect() as conn:
        conn.execute(
            """INSERT INTO backfill_progress (user_id, task, cursor, done, note)
               VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (user_id, task) DO UPDATE SET
                   cursor = EXCLUDED.cursor, done = EXCLUDED.done, note = EXCLUDED.note,
                   updated_at = now()""",
            [user_id, task, cursor, done, note],
        )
