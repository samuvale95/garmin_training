"""The stream codec: exact enough to trust, small enough to keep.

Pure-codec tests only -- nothing here touches Postgres, so they run in the suite like
every other unit test.
"""

import math
import random
import zlib

import pytest

from training_plan import history


def _realistic_run(minutes=60):
    """An hour of running, sampled once a second, shaped like the real thing.

    Physiological series are smooth and autocorrelated, which is exactly why they
    compress well -- a test built on random noise would understate the codec by an order
    of magnitude and prove nothing about the data it actually stores.
    """
    n = minutes * 60
    random.seed(7)
    heart_rates, velocities, cadences, altitudes = [], [], [], []
    hr, velocity, altitude = 120.0, 3.1, 100.0
    for i in range(n):
        hr = min(185.0, max(95.0, hr + random.gauss(0, 0.4) + (0.01 if i > n / 2 else 0)))
        velocity = min(5.5, max(2.2, velocity + random.gauss(0, 0.02)))
        altitude += random.gauss(0, 0.25)
        heart_rates.append(round(hr))
        velocities.append(round(velocity, 2))
        cadences.append(round(min(100.0, max(70.0, 86 + random.gauss(0, 1.5)))))
        altitudes.append(round(altitude, 1))
    return {
        "time": list(range(n)),
        "heartrate": heart_rates,
        "velocity_smooth": velocities,
        "cadence": cadences,
        "altitude": altitudes,
    }


# ---- roundtrip -------------------------------------------------------------------------


def test_a_stream_survives_the_roundtrip():
    streams = _realistic_run(10)
    packed = history.pack_streams(streams)
    back = history.unpack_streams(packed.header, packed.blob)

    assert back["heartrate"] == [float(v) for v in streams["heartrate"]]
    assert back["cadence"] == [float(v) for v in streams["cadence"]]
    assert back["time"] == [float(v) for v in streams["time"]]


def test_scaled_channels_come_back_within_their_quantization():
    streams = _realistic_run(5)
    packed = history.pack_streams(streams)
    back = history.unpack_streams(packed.header, packed.blob)

    # velocity is stored in cm/s, so it is exact to 0.01 m/s and no better.
    for original, decoded in zip(streams["velocity_smooth"], back["velocity_smooth"]):
        assert abs(original - decoded) <= 0.01
    # altitude in decimetres.
    for original, decoded in zip(streams["altitude"], back["altitude"]):
        assert abs(original - decoded) <= 0.05


def test_the_time_axis_is_delta_encoded_and_still_exact():
    """Strava records at uneven 'smart' intervals. Deltas are what makes the axis
    compress; the reconstruction has to be exact anyway."""
    times = [0, 3, 7, 12, 20, 33, 51, 76, 110]
    packed = history.pack_streams({"time": times, "heartrate": [130] * len(times)})
    back = history.unpack_streams(packed.header, packed.blob)
    assert back["time"] == [float(t) for t in times]


def test_a_dropout_comes_back_as_a_dropout():
    """Zero is the 'no reading' marker on the unsigned channels, and it has to survive
    as None -- `intensity.time_in_zone` counts a null as no time at all, and a 0 read as
    a real bpm would land in the easy zone and quietly inflate it."""
    packed = history.pack_streams({"time": [0, 1, 2, 3], "heartrate": [140, None, None, 142]})
    back = history.unpack_streams(packed.header, packed.blob)
    assert back["heartrate"] == [140.0, None, None, 142.0]


def test_an_out_of_range_sample_is_clamped_not_wrapped():
    """A spurious 70,000 W would become 4,464 under two's-complement wraparound, and a
    corrupted number that looks plausible is worse than one obviously pinned to the
    top of the scale."""
    packed = history.pack_streams({"time": [0, 1], "watts": [250, 70000]})
    back = history.unpack_streams(packed.header, packed.blob)
    assert back["watts"] == [250.0, 65535.0]


def test_channels_the_codec_does_not_know_are_dropped():
    """An unknown channel would have to be stored untyped and uncompressed, which is how
    a compact format quietly stops being one."""
    packed = history.pack_streams({"time": [0, 1], "heartrate": [130, 131], "temp": [20, 21]})
    assert {c["name"] for c in packed.header["channels"]} == {"time", "heartrate"}


def test_mismatched_channel_lengths_truncate_instead_of_overrunning():
    """Strava has been seen to disagree with itself by a sample or two."""
    packed = history.pack_streams({"time": [0, 1, 2, 3], "heartrate": [130, 131]})
    assert packed.samples == 2
    back = history.unpack_streams(packed.header, packed.blob)
    assert len(back["time"]) == 2


def test_nothing_usable_is_nothing_stored():
    assert history.pack_streams({}) is None
    assert history.pack_streams({"temp": [20, 21]}) is None
    assert history.pack_streams({"heartrate": []}) is None


# ---- the part the whole module exists for ------------------------------------------------


def test_an_hour_of_running_fits_in_a_handful_of_kilobytes():
    """The reason streams are stored packed rather than as JSON or as one row per
    sample. An hour is 3,600 samples across five channels."""
    packed = history.pack_streams(_realistic_run(60))
    assert packed.samples == 3600
    assert packed.packed_bytes < 12_000


def test_packing_beats_the_json_it_replaces_by_an_order_of_magnitude():
    import json as json_module

    streams = _realistic_run(60)
    as_json = len(json_module.dumps(streams).encode())
    packed = history.pack_streams(streams)
    assert as_json / packed.packed_bytes > 10


def test_the_report_carries_its_own_compression_ratio():
    packed = history.pack_streams(_realistic_run(30))
    assert packed.ratio > 1
    assert packed.raw_bytes > packed.packed_bytes
    assert zlib.decompress(packed.blob)


@pytest.mark.parametrize("minutes", [5, 30, 120])
def test_the_blob_stays_proportional_to_the_session(minutes):
    packed = history.pack_streams(_realistic_run(minutes))
    per_minute = packed.packed_bytes / minutes
    assert per_minute < 220  # bytes per minute of running, packed
    assert math.isclose(packed.samples, minutes * 60)


def test_distance_is_delta_encoded_like_time():
    """Both are monotonic with small steps, which is exactly what delta encoding is
    for -- and `distance` is what lets a pace be read per segment without integrating
    velocity."""
    distances = [0.0, 3.2, 6.5, 9.9, 14.1, 19.0]
    packed = history.pack_streams({"time": list(range(len(distances))), "distance": distances})
    spec = next(c for c in packed.header["channels"] if c["name"] == "distance")
    assert spec["delta"] is True
    back = history.unpack_streams(packed.header, packed.blob)
    for original, decoded in zip(distances, back["distance"]):
        assert abs(original - decoded) <= 0.05
