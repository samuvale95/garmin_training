"""Garmin's activity detail, read into the stored-history shape.

The fixture is a real running activity trimmed to 300 samples, position zeroed and ids
replaced. The payload is undocumented, which is exactly why its shape is pinned here.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

from training_plan import history
from training_plan.garmin_sync import _parse_activity_item, parse_activity_streams

FIXTURES = Path(__file__).parent / "fixtures"


def _details():
    return json.loads((FIXTURES / "garmin_activity_details.json").read_text())


def test_a_real_detail_becomes_heart_rate_speed_and_time():
    streams = parse_activity_streams(_details())

    assert set(streams) == {"heartrate", "velocity_smooth", "time"}
    assert len(streams["heartrate"]) == len(streams["time"]) == len(streams["velocity_smooth"]) == 300
    # About one sample a second, from an elapsed-duration channel starting at zero.
    assert streams["time"][0] == 0.0
    assert streams["time"][-1] > 250
    assert all(40 < hr < 220 for hr in streams["heartrate"] if hr is not None)


def test_the_parsed_streams_survive_the_history_codec():
    """Same channel names as Strava, so the codec and every reader take it unchanged."""
    streams = parse_activity_streams(_details())
    packed = history.pack_streams(streams)
    decoded = history.unpack_streams(packed.header, packed.blob)
    assert decoded["heartrate"][:10] == [float(v) for v in streams["heartrate"][:10]]


def test_positions_are_looked_up_not_assumed():
    """The metric order differs between activities: reversing it must not change the result."""
    details = _details()
    width = len(details["metricDescriptors"])
    for descriptor in details["metricDescriptors"]:
        descriptor["metricsIndex"] = width - 1 - descriptor["metricsIndex"]
    for sample in details["activityDetailMetrics"]:
        sample["metrics"] = list(reversed(sample["metrics"]))

    assert parse_activity_streams(details) == parse_activity_streams(_details())


def test_no_heart_rate_channel_is_no_stream():
    details = _details()
    details["metricDescriptors"] = [d for d in details["metricDescriptors"] if d["key"] != "directHeartRate"]
    assert parse_activity_streams(details) is None


def test_wall_clock_is_the_fallback_for_time():
    details = _details()
    details["metricDescriptors"] = [d for d in details["metricDescriptors"] if d["key"] != "sumDuration"]
    streams = parse_activity_streams(details)
    assert streams["time"][0] == 0.0
    assert streams["time"][1] == 1.0


def test_an_unknown_shape_is_no_stream_not_a_wrong_one():
    assert parse_activity_streams({}) is None
    assert parse_activity_streams({"metricDescriptors": "?", "activityDetailMetrics": []}) is None
    assert parse_activity_streams(None) is None


def test_the_list_item_carries_what_the_history_stores():
    item = json.loads((FIXTURES / "garmin_activity_item.json").read_text())
    activity = _parse_activity_item(item)

    assert activity.sport == "running"
    assert activity.start_time == datetime(2026, 9, 24, 17, 26, 47, tzinfo=timezone.utc)
    assert activity.avg_hr == 156
    assert activity.duration_min == 41.1
