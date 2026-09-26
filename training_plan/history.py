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
import re
import sys
import zlib
from array import array
from dataclasses import dataclass
from datetime import date as date_type
from datetime import timedelta
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
    start_time      TIMESTAMPTZ,
    external_id     TEXT,
    -- The Garmin activity this row records a second time; NULL means canonical.
    duplicate_of    BIGINT,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, source, activity_id)
);

CREATE INDEX IF NOT EXISTS activity_day_idx ON activity (user_id, day);

CREATE TABLE IF NOT EXISTS activity_stream (
    user_id      TEXT NOT NULL,
    source       TEXT NOT NULL,
    activity_id  BIGINT NOT NULL,
    samples      INTEGER NOT NULL,
    header       JSONB NOT NULL,
    blob         BYTEA NOT NULL,
    raw_bytes    INTEGER NOT NULL,
    packed_bytes INTEGER NOT NULL,
    fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, source, activity_id)
);

-- Per-user state derived from the history: the highest level reached (never lowered,
-- see levels.py) and the plan-adaptation preference (NULL: the level's default).
CREATE TABLE IF NOT EXISTS athlete_profile (
    user_id          TEXT PRIMARY KEY,
    reached_level    SMALLINT NOT NULL DEFAULT 1,
    reached_at       TIMESTAMPTZ,
    adaptation_mode  TEXT,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
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


# Brings a database created before Garmin became a source up to the shape above. Every
# statement is a no-op on a database that is already there, so this runs on every startup
# like SCHEMA does.
#
# The stream key is the one that matters: it used to be (user_id, activity_id), which was
# fine while Strava was the only writer, and becomes a silent overwrite the day a Garmin id
# and a Strava id happen to share a number. Rows written before this were all Strava's,
# which is what the column default says.
MIGRATIONS = """
ALTER TABLE activity ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ;
ALTER TABLE activity ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE activity ADD COLUMN IF NOT EXISTS duplicate_of BIGINT;
ALTER TABLE activity_stream ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'strava';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
        WHERE i.indrelid = 'activity_stream'::regclass AND i.indisprimary AND a.attname = 'source'
    ) THEN
        ALTER TABLE activity_stream DROP CONSTRAINT IF EXISTS activity_stream_pkey;
        ALTER TABLE activity_stream ADD PRIMARY KEY (user_id, source, activity_id);
    END IF;
END $$;
"""


def ensure_schema() -> None:
    with db.connect() as conn:
        conn.execute(SCHEMA)
        conn.execute(MIGRATIONS)


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
                                     elevation_gain, summary, start_time, external_id)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (user_id, source, activity_id) DO UPDATE SET
                   day = EXCLUDED.day, sport = EXCLUDED.sport, title = EXCLUDED.title,
                   distance_km = EXCLUDED.distance_km, duration_min = EXCLUDED.duration_min,
                   avg_hr = EXCLUDED.avg_hr, max_hr = EXCLUDED.max_hr,
                   avg_cadence = EXCLUDED.avg_cadence, avg_power = EXCLUDED.avg_power,
                   elevation_gain = EXCLUDED.elevation_gain, summary = EXCLUDED.summary,
                   start_time = EXCLUDED.start_time, external_id = EXCLUDED.external_id,
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
                values.get("start_time"),
                values.get("external_id"),
            ],
        )


def save_stream(user_id: str, source: str, activity_id: int, packed: PackedStream) -> None:
    with db.connect() as conn:
        conn.execute(
            """INSERT INTO activity_stream (user_id, source, activity_id, samples, header, blob,
                                            raw_bytes, packed_bytes)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (user_id, source, activity_id) DO UPDATE SET
                   samples = EXCLUDED.samples, header = EXCLUDED.header, blob = EXCLUDED.blob,
                   raw_bytes = EXCLUDED.raw_bytes, packed_bytes = EXCLUDED.packed_bytes,
                   fetched_at = now()""",
            [user_id, source, activity_id, packed.samples, json.dumps(packed.header), packed.blob,
             packed.raw_bytes, packed.packed_bytes],
        )


# ---- reads ------------------------------------------------------------------------------


def load_streams(user_id: str, source: str, activity_id: int) -> dict[str, list[float | None]] | None:
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT header, blob FROM activity_stream "
            "WHERE user_id = %s AND source = %s AND activity_id = %s",
            [user_id, source, activity_id],
        )
        row = cur.fetchone()
    if not row:
        return None
    header, blob = row
    return unpack_streams(header, bytes(blob))


def streams_between(
    user_id: str, start: date_type, end: date_type, sports: Sequence[str]
) -> Iterable[tuple[dict, dict[str, list[float | None]]]]:
    """Every workout of these sports in the range, once, with its decoded streams.

    One query instead of `activities_between` plus a `load_streams` round-trip per row:
    a year of history is hundreds of activities, and the per-row version paid a pool
    checkout and a query for each -- including the ski tours and hikes the caller was
    about to throw away. Filtering on sport in SQL means those blobs never leave the
    database, and decoding lazily keeps one activity's streams in memory at a time.

    Canonical rows only, so a run recorded by the watch and uploaded to Strava counts
    once. When the canonical row has no stream of its own (its detail fetch failed) the
    stream of a row that duplicates it stands in: it is the same workout.
    """
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT a.activity_id, a.source, a.day, a.sport, a.title, "
            "       coalesce(s.header, d.header), coalesce(s.blob, d.blob) "
            "FROM activity a "
            "LEFT JOIN activity_stream s "
            "  ON s.user_id = a.user_id AND s.source = a.source AND s.activity_id = a.activity_id "
            f"LEFT JOIN LATERAL ({_DUPLICATE_STREAM}) d ON s.blob IS NULL "
            "WHERE a.user_id = %s AND a.day BETWEEN %s AND %s AND a.sport = ANY(%s) "
            "  AND a.duplicate_of IS NULL AND coalesce(s.blob, d.blob) IS NOT NULL "
            "ORDER BY a.day, a.start_time",
            [user_id, start, end, list(sports)],
        )
        rows = cur.fetchall()
    for activity_id, source, day, sport, title, header, blob in rows:
        row = {"activity_id": activity_id, "source": source, "day": day, "sport": sport, "title": title}
        yield row, unpack_streams(header, bytes(blob))


# The stream of a Strava row that records the same workout as the Garmin row `a`.
_DUPLICATE_STREAM = (
    "SELECT ds.header, ds.blob FROM activity dup "
    "JOIN activity_stream ds "
    "  ON ds.user_id = dup.user_id AND ds.source = dup.source AND ds.activity_id = dup.activity_id "
    "WHERE dup.user_id = a.user_id AND a.source = 'garmin' AND dup.duplicate_of = a.activity_id "
    "LIMIT 1"
)


def streams_version(user_id: str) -> tuple[int, str | None]:
    """A cheap fingerprint of this user's stored streams. It changes whenever a new
    activity syncs, so a cache keyed on it drops a stale diagnosis as soon as there is
    something new to diagnose instead of hours later."""
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT count(*), max(fetched_at) FROM activity_stream WHERE user_id = %s", [user_id]
        )
        count, latest = cur.fetchone()
    return int(count), latest.isoformat() if latest else None


def wellness_between(user_id: str, start: date_type, end: date_type) -> list[dict]:
    columns = ("day", *_WELLNESS_COLUMNS)
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"SELECT {', '.join(columns)} FROM wellness_day "
            "WHERE user_id = %s AND day BETWEEN %s AND %s ORDER BY day",
            [user_id, start, end],
        )
        return [dict(zip(columns, row)) for row in cur.fetchall()]


def activities_between(
    user_id: str, start: date_type, end: date_type, *, canonical_only: bool = True
) -> list[dict]:
    """Stored activities in the range. By default one row per real workout: a Strava row
    that duplicates a Garmin one is left out (see `resolve_duplicates`)."""
    columns = ("source", "activity_id", "day", "sport", "title", "distance_km", "duration_min",
               "avg_hr", "max_hr", "avg_cadence", "avg_power", "elevation_gain", "start_time")
    canonical = "AND duplicate_of IS NULL " if canonical_only else ""
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"SELECT {', '.join(columns)} FROM activity "
            f"WHERE user_id = %s AND day BETWEEN %s AND %s {canonical}ORDER BY day, start_time",
            [user_id, start, end],
        )
        return [dict(zip(columns, row)) for row in cur.fetchall()]


def load_workout_streams(user_id: str, source: str, activity_id: int) -> dict[str, list[float | None]] | None:
    """`load_streams`, falling back on a duplicate's stream when this row has none."""
    streams = load_streams(user_id, source, activity_id)
    if streams is not None or source != "garmin":
        return streams
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT ds.header, ds.blob FROM activity dup JOIN activity_stream ds "
            "  ON ds.user_id = dup.user_id AND ds.source = dup.source AND ds.activity_id = dup.activity_id "
            "WHERE dup.user_id = %s AND dup.duplicate_of = %s LIMIT 1",
            [user_id, activity_id],
        )
        row = cur.fetchone()
    return unpack_streams(row[0], bytes(row[1])) if row else None


# ---- one workout, two sources ----------------------------------------------------------------

# How close two recordings have to be to be the same workout. Two minutes absorbs the
# watch and the phone disagreeing on when "start" was pressed; ten percent absorbs Strava
# counting moving time where Garmin counts timer time. Neither is loose enough to merge
# the morning run with the evening one.
DUPLICATE_START_TOLERANCE_S = 120
DUPLICATE_DURATION_TOLERANCE = 0.10

# Strava's `external_id` for an activity Garmin pushed to it. The number is *not* the
# Garmin activity id (checked against a real two-year history: none of 368 matched), so
# it cannot be joined on -- but the prefix alone proves the watch recorded the workout.
_GARMIN_EXTERNAL_ID = re.compile(r"^garmin_(?:ping|push)_\d+")

# For a Strava row Garmin itself uploaded, how far apart the two starts may be. Wider than
# the blind rule because the question is no longer "is this the same workout" (it is)
# but "which of that day's Garmin activities" -- and Strava re-cuts some of them: a ski
# day or a paused ride can start minutes later there than on the watch.
GARMIN_UPLOAD_START_TOLERANCE_S = 15 * 60

# Families across both vocabularies, so a Garmin `trail_running` and a Strava `TrailRun`
# can be the same workout and a run and a ride never can. Anything unlisted is its own
# family, compared by its lowercased name.
_SPORT_FAMILIES = {
    "run": ("Run", "TrailRun", "VirtualRun", "running", "trail_running", "treadmill_running",
            "track_running", "indoor_running", "street_running", "virtual_run"),
    "ride": ("Ride", "VirtualRide", "EBikeRide", "MountainBikeRide", "GravelRide", "EMountainBikeRide",
             "cycling", "road_biking", "mountain_biking", "gravel_cycling", "indoor_cycling",
             "virtual_ride", "e_bike_fitness", "e_bike_mountain"),
    "swim": ("Swim", "swimming", "lap_swimming", "open_water_swimming"),
    "hike": ("Hike", "hiking"),
    "walk": ("Walk", "walking"),
    "strength": ("WeightTraining", "strength_training"),
    "ski": ("AlpineSki", "BackcountrySki", "NordicSki", "resort_skiing", "resort_skiing_snowboarding_ws",
            "backcountry_skiing", "skate_skiing_ws", "cross_country_skiing_ws"),
    "tennis": ("Tennis", "tennis", "tennis_v2"),
    "climb": ("RockClimbing", "rock_climbing", "indoor_climbing", "bouldering"),
    "paddle": ("StandUpPaddling", "stand_up_paddleboarding", "stand_up_paddleboarding_v2"),
    "sail": ("Sail", "sailing", "sailing_v2"),
}
_FAMILY_OF = {sport: family for family, sports in _SPORT_FAMILIES.items() for sport in sports}


def sport_family(sport: str | None) -> str:
    return _FAMILY_OF.get(sport or "", (sport or "").lower())


def match_duplicates(garmin: Sequence[dict], strava: Sequence[dict]) -> dict[int, int | None]:
    """For each Strava row, the Garmin activity id it records a second time, or `None`.

    Pure, so the rules are tested without a database. Rows carry `activity_id`, `sport`,
    `start_time`, `duration_min` and, for Strava, `external_id`.

    1. Uploaded by Garmin (`external_id` `garmin_ping_…` / `garmin_push_…`): it *is* one
       of the watch's activities. It goes to the Garmin activity with the closest start
       within fifteen minutes, preferring the same sport family, and with no duration
       check -- Strava counts moving time where Garmin counts the timer, and on a ride
       with stops the two differ by a quarter.
    2. Otherwise the same sport family, starts within two minutes, durations within ten
       percent. With several candidates, the closest start wins. This is the case of two
       devices recording the same workout.
    3. Otherwise it is its own workout -- for instance one recorded on another watch.
    """
    out: dict[int, int | None] = {}
    for row in strava:
        match: int | None = None
        if row.get("start_time") is not None:
            if _GARMIN_EXTERNAL_ID.match(str(row.get("external_id") or "")):
                match = _closest_garmin_upload(garmin, row)
            else:
                match = _closest(
                    garmin,
                    row,
                    tolerance_s=DUPLICATE_START_TOLERANCE_S,
                    accept=lambda candidate: sport_family(candidate.get("sport")) == sport_family(row.get("sport"))
                    and _durations_agree(candidate.get("duration_min"), row.get("duration_min")),
                )
        out[row["activity_id"]] = match
    return out


def _closest_garmin_upload(garmin: Sequence[dict], row: dict) -> int | None:
    same_family = _closest(
        garmin,
        row,
        tolerance_s=GARMIN_UPLOAD_START_TOLERANCE_S,
        accept=lambda candidate: sport_family(candidate.get("sport")) == sport_family(row.get("sport")),
    )
    if same_family is not None:
        return same_family
    # The two apps sometimes name the sport differently in ways no table anticipates;
    # Garmin sent this one, so a Garmin activity starting at the same moment is it.
    return _closest(garmin, row, tolerance_s=DUPLICATE_START_TOLERANCE_S, accept=lambda candidate: True)


def _closest(garmin: Sequence[dict], row: dict, *, tolerance_s: float, accept) -> int | None:
    best: tuple[float, int] | None = None
    for candidate in garmin:
        if candidate.get("start_time") is None or not accept(candidate):
            continue
        gap = abs((candidate["start_time"] - row["start_time"]).total_seconds())
        if gap <= tolerance_s and (best is None or gap < best[0]):
            best = (gap, candidate["activity_id"])
    return best[1] if best else None


def _durations_agree(a: float | None, b: float | None) -> bool:
    if not a or not b:
        return False
    return abs(a - b) <= DUPLICATE_DURATION_TOLERANCE * max(a, b)


def resolve_duplicates(user_id: str, start: date_type, end: date_type) -> int:
    """Recompute which Strava rows in the range duplicate a Garmin row. Returns how many do.

    Stored rather than worked out on every read, so readers stay one plain filter
    (`duplicate_of IS NULL`) and the decision can be inspected in the table. Deterministic
    and cheap, so it simply runs again after every sync. The window is widened by a day on
    each side: a workout just after midnight can land on different days in two time zones.
    """
    columns = ("source", "activity_id", "sport", "start_time", "duration_min", "external_id")
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"SELECT {', '.join(columns)} FROM activity "
            "WHERE user_id = %s AND day BETWEEN %s AND %s",
            [user_id, start - timedelta(days=1), end + timedelta(days=1)],
        )
        rows = [dict(zip(columns, row)) for row in cur.fetchall()]

    garmin = [row for row in rows if row["source"] == "garmin"]
    strava = [row for row in rows if row["source"] == "strava"]
    matches = match_duplicates(garmin, strava)
    if matches:
        with db.connect() as conn, conn.cursor() as cur:
            cur.executemany(
                "UPDATE activity SET duplicate_of = %s "
                "WHERE user_id = %s AND source = 'strava' AND activity_id = %s",
                [(garmin_id, user_id, strava_id) for strava_id, garmin_id in matches.items()],
            )
    return sum(1 for garmin_id in matches.values() if garmin_id is not None)


def stored_days(user_id: str) -> set[date_type]:
    """Which days are already in, so the backfill can skip them on a re-run."""
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT day FROM wellness_day WHERE user_id = %s", [user_id])
        return {row[0] for row in cur.fetchall()}


def stored_stream_ids(user_id: str, source: str) -> set[int]:
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT activity_id FROM activity_stream WHERE user_id = %s AND source = %s", [user_id, source]
        )
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


# ---- keeping the history current -----------------------------------------------------------

# The one row that says when this user's history last started syncing, and whether a sync
# is running now. Claimed with a single conditional upsert, so two tabs, two workers or
# two quick reloads can never start two syncs for the same user.
SYNC_TASK = "sync"


def claim_sync(user_id: str, *, throttle_s: int, stale_s: int) -> bool:
    """True when this caller now owns the user's next sync.

    Refused while a sync is running (unless it has been "running" for longer than
    `stale_s` -- a process that died mid-run must not block the history forever) and
    within `throttle_s` of the last one starting.
    """
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO backfill_progress (user_id, task, cursor, done, note)
               VALUES (%s, %s, 'running', FALSE, NULL)
               ON CONFLICT (user_id, task) DO UPDATE SET
                   cursor = 'running', done = FALSE, note = NULL, updated_at = now()
               WHERE (backfill_progress.cursor IS DISTINCT FROM 'running'
                      AND backfill_progress.updated_at < now() - make_interval(secs => %s))
                  OR backfill_progress.updated_at < now() - make_interval(secs => %s)
               RETURNING 1""",
            [user_id, SYNC_TASK, throttle_s, stale_s],
        )
        return cur.fetchone() is not None


def release_sync(user_id: str, note: str | None = None) -> None:
    """Mark the sync finished. The throttle counts from here."""
    set_progress(user_id, SYNC_TASK, cursor="idle", done=True, note=note)


def has_activities(user_id: str, source: str) -> bool:
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM activity WHERE user_id = %s AND source = %s LIMIT 1", [user_id, source])
        return cur.fetchone() is not None


def activities_needing_stream(user_id: str, source: str, start: date_type, end: date_type) -> list[int]:
    """Ids of this source's activities whose stream is worth fetching, newest first.

    - only activities with a recorded heart rate: a stream without one feeds none of the
      analysis, and skipping them keeps a strength session from costing a request on
      every run just to come back empty again;
    - only those without a stream of their own yet;
    - for Strava, only workouts the watch did not already cover: a Strava row that
      duplicates a Garmin row with a stream would be the same workout fetched twice.
      Strava allows about a hundred requests a quarter of an hour, so on a history
      synced from both this is the difference between ten requests and three hundred.
    """
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT a.activity_id FROM activity a "
            "WHERE a.user_id = %s AND a.source = %s AND a.day BETWEEN %s AND %s "
            "  AND a.avg_hr IS NOT NULL "
            "  AND NOT EXISTS (SELECT 1 FROM activity_stream s WHERE s.user_id = a.user_id "
            "                  AND s.source = a.source AND s.activity_id = a.activity_id) "
            "  AND (a.duplicate_of IS NULL OR NOT EXISTS ("
            "       SELECT 1 FROM activity_stream g WHERE g.user_id = a.user_id "
            "       AND g.source = 'garmin' AND g.activity_id = a.duplicate_of)) "
            "ORDER BY a.day DESC, a.start_time DESC NULLS LAST",
            [user_id, source, start, end],
        )
        return [int(row[0]) for row in cur.fetchall()]


# ---- the athlete's level ----------------------------------------------------------------------


def daily_training(
    user_id: str, start: date_type, end: date_type, *, running_sports: Sequence[str], min_minutes: float
) -> list[dict]:
    """Per-day totals for `levels.py`: sessions, runs with a heart rate, running minutes.

    Canonical rows only (a run on both Garmin and Strava is one session) and at least
    `min_minutes` long. One grouped query; the level logic itself stays in Python where
    it can be tested without a database.
    """
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT day, count(*), "
            "       count(*) FILTER (WHERE sport = ANY(%s) AND avg_hr IS NOT NULL), "
            "       coalesce(sum(duration_min) FILTER (WHERE sport = ANY(%s)), 0) "
            "FROM activity "
            "WHERE user_id = %s AND day BETWEEN %s AND %s AND duplicate_of IS NULL "
            "  AND duration_min >= %s "
            "GROUP BY day ORDER BY day",
            [list(running_sports), list(running_sports), user_id, start, end, min_minutes],
        )
        return [
            {"day": day, "sessions": int(sessions), "runs_with_hr": int(runs), "run_minutes": float(minutes)}
            for day, sessions, runs, minutes in cur.fetchall()
        ]


def activities_version(user_id: str) -> tuple[int, str | None]:
    """Like `streams_version`, over activities: a tennis session has no stream but still
    counts towards the level."""
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT count(*), max(fetched_at) FROM activity WHERE user_id = %s", [user_id])
        count, latest = cur.fetchone()
    return int(count), latest.isoformat() if latest else None


def load_profile(user_id: str) -> dict:
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT reached_level, adaptation_mode FROM athlete_profile WHERE user_id = %s", [user_id]
        )
        row = cur.fetchone()
    return {"reached_level": row[0], "adaptation_mode": row[1]} if row else {"reached_level": 1, "adaptation_mode": None}


def raise_reached_level(user_id: str, level: int) -> None:
    """Store `level` if it is higher than what is stored. `GREATEST`, so two reads racing
    each other can never lower it."""
    with db.connect() as conn:
        conn.execute(
            """INSERT INTO athlete_profile (user_id, reached_level, reached_at)
               VALUES (%s, %s, now())
               ON CONFLICT (user_id) DO UPDATE SET
                   reached_at = CASE WHEN EXCLUDED.reached_level > athlete_profile.reached_level
                                     THEN now() ELSE athlete_profile.reached_at END,
                   reached_level = GREATEST(athlete_profile.reached_level, EXCLUDED.reached_level),
                   updated_at = now()""",
            [user_id, level],
        )


def set_adaptation_mode(user_id: str, mode: str | None) -> None:
    """`None` goes back to the level's default."""
    with db.connect() as conn:
        conn.execute(
            """INSERT INTO athlete_profile (user_id, adaptation_mode) VALUES (%s, %s)
               ON CONFLICT (user_id) DO UPDATE SET
                   adaptation_mode = EXCLUDED.adaptation_mode, updated_at = now()""",
            [user_id, mode],
        )
