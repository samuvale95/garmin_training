"""The backfill's resilience rules. No network, no database -- just the ladders."""

from datetime import date

import pytest

from training_plan import backfill
from training_plan.garmin_sync import GarminRateLimitError


# ---- one day off Garmin ----------------------------------------------------------------


class FakeClient:
    """A Garmin client shaped like the real one, with per-endpoint failure switches."""

    def __init__(self, fail: set[str] | None = None, rate_limit: set[str] | None = None):
        self.fail = fail or set()
        self.rate_limit = rate_limit or set()
        self.calls: list[str] = []

    def _guard(self, name: str):
        self.calls.append(name)
        if name in self.rate_limit:
            raise GarminRateLimitError("slow down")
        if name in self.fail:
            raise RuntimeError(f"{name} exploded")

    def get_training_readiness(self, day):
        self._guard("readiness")
        return {"score": 72, "level": "MODERATE"}

    def get_sleep_data(self, day):
        self._guard("sleep")
        return {
            "dailySleepDTO": {
                "sleepTimeSeconds": 27000,
                "deepSleepSeconds": 5400,
                "lightSleepSeconds": 16200,
                "remSleepSeconds": 5400,
                "awakeSleepSeconds": 600,
                "sleepScores": {"overall": {"value": 81}},
            }
        }

    def get_hrv_data(self, day):
        self._guard("hrv")
        return {"hrvSummary": {"lastNightAvg": 48}}

    def get_stats(self, day):
        self._guard("stats")
        return {"restingHeartRate": 51, "bodyBatteryMostRecentValue": 64, "totalSteps": 9120}

    def get_stress_data(self, day):
        self._guard("stress")
        return {"avgStressLevel": 27}


def test_a_full_day_flattens_into_one_row():
    values = backfill.fetch_day(FakeClient(), date(2026, 9, 1))
    assert values["readiness_score"] == 72
    assert values["sleep_total_min"] == 450
    assert values["sleep_deep_min"] == 90
    assert values["sleep_score"] == 81
    assert values["hrv_ms"] == 48
    assert values["resting_hr"] == 51
    assert values["steps"] == 9120
    assert values["stress_avg"] == 27


def test_one_missing_endpoint_costs_one_column_not_the_row():
    """Two years of history against undocumented endpoints: something is always missing
    on some day, and losing the whole row for it would be the wrong trade."""
    values = backfill.fetch_day(FakeClient(fail={"hrv", "readiness"}), date(2026, 9, 1))
    assert values.get("hrv_ms") is None
    assert "readiness_score" not in values
    assert values["sleep_total_min"] == 450
    assert values["resting_hr"] == 51


def test_a_rate_limit_is_never_swallowed():
    """Every other failure degrades. This one has to travel, so the caller can back off
    -- treating it as a missing column would mean hammering straight through it."""
    with pytest.raises(GarminRateLimitError):
        backfill.fetch_day(FakeClient(rate_limit={"stats"}), date(2026, 9, 1))


def test_the_calls_go_out_one_at_a_time():
    """Five concurrent requests per day multiplied across a year is exactly the shape
    that trips a rate limiter."""
    client = FakeClient()
    backfill.fetch_day(client, date(2026, 9, 1))
    assert client.calls == ["readiness", "sleep", "hrv", "stats", "stress"]


# ---- surviving the database ---------------------------------------------------------------


def test_a_write_that_works_is_not_retried():
    calls = []
    assert backfill._write_with_retry(lambda: calls.append(1)) is True
    assert len(calls) == 1


def test_a_flaky_write_is_retried_and_lands(monkeypatch):
    """The case that actually happens: a pooled connection has gone stale, the first
    attempt fails, the pool replaces it and the second succeeds."""
    monkeypatch.setattr(backfill.time, "sleep", lambda _: None)
    attempts = []

    def flaky():
        attempts.append(1)
        if len(attempts) == 1:
            raise RuntimeError("server closed the connection unexpectedly")

    assert backfill._write_with_retry(flaky) is True
    assert len(attempts) == 2


def test_a_write_that_never_lands_gives_up_rather_than_looping(monkeypatch):
    monkeypatch.setattr(backfill.time, "sleep", lambda _: None)
    attempts = []

    def broken():
        attempts.append(1)
        raise RuntimeError("down")

    assert backfill._write_with_retry(broken) is False
    assert len(attempts) == backfill.DB_WRITE_ATTEMPTS


# ---- which failures deserve a second try --------------------------------------------------


class FlakyClient(FakeClient):
    """Resets the connection on `hrv` for the first `resets` attempts, then works."""

    def __init__(self, resets: int):
        super().__init__()
        self.resets = resets

    def get_hrv_data(self, day):
        self.calls.append("hrv")
        if self.resets > 0:
            self.resets -= 1
            raise ConnectionResetError(54, "Connection reset by peer")
        return {"hrvSummary": {"lastNightAvg": 48}}


def test_a_dropped_connection_is_retried_and_the_value_survives(monkeypatch):
    """The hole this prevents is permanent: the day gets stored regardless, and a later
    run skips it as already fetched, so a swallowed reset is a null forever."""
    monkeypatch.setattr(backfill.time, "sleep", lambda _: None)
    client = FlakyClient(resets=2)
    values = backfill.fetch_day(client, date(2026, 9, 1))
    assert values["hrv_ms"] == 48
    assert client.calls.count("hrv") == 3


def test_a_connection_that_never_comes_back_still_yields_the_rest_of_the_day(monkeypatch):
    monkeypatch.setattr(backfill.time, "sleep", lambda _: None)
    client = FlakyClient(resets=99)
    values = backfill.fetch_day(client, date(2026, 9, 1))
    assert values["hrv_ms"] is None
    assert values["resting_hr"] == 51
    assert client.calls.count("hrv") == backfill.TRANSIENT_ATTEMPTS


def test_an_endpoint_with_no_data_is_not_retried(monkeypatch):
    """It fails the same way every time -- retrying only triples the request count for a
    null that was always going to be null."""
    monkeypatch.setattr(backfill.time, "sleep", lambda _: None)
    client = FakeClient(fail={"hrv"})
    backfill.fetch_day(client, date(2026, 9, 1))
    assert client.calls.count("hrv") == 1


def test_a_rate_limit_is_still_never_retried_here(monkeypatch):
    """Backing off is the caller's job, and it waits minutes rather than seconds."""
    monkeypatch.setattr(backfill.time, "sleep", lambda _: None)
    with pytest.raises(GarminRateLimitError):
        backfill.fetch_day(FakeClient(rate_limit={"hrv"}), date(2026, 9, 1))
