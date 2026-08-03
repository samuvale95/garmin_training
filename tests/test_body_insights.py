from datetime import date

import pytest

from training_plan import body_insights
from training_plan.models import Step, TrainingSession


class FakeGarminClient:
    def __init__(self):
        self.readiness = {"score": 78, "feedbackLong": "Pronto a lavorare"}
        self.sleep = {
            "dailySleepDTO": {
                "sleepTimeSeconds": 27000,
                "deepSleepSeconds": 5400,
                "lightSleepSeconds": 14400,
                "remSleepSeconds": 5400,
                "awakeSleepSeconds": 1800,
            }
        }
        self.rhr = {"restingHeartRate": 48}
        self.stress = {"avgStressLevel": 22}
        self.battery = [{"charged": 64}]
        self.training_status = {"weeklyTrainingLoad": 320, "acuteChronicRatio": 1.28}
        self.max_metrics = [{"generic": {"vo2MaxPreciseValue": 52.3}}]

    def get_training_readiness(self, day):
        return self.readiness

    def get_sleep_data(self, day):
        return self.sleep

    def get_hrv_data(self, day):
        return {"hrvSummary": {"lastNightAvg": 55}}

    def get_rhr_day(self, day):
        return self.rhr

    def get_stress_data(self, day):
        return self.stress

    def get_body_battery(self, day):
        return self.battery

    def get_training_status(self, day):
        return self.training_status

    def get_max_metrics(self, day):
        return self.max_metrics


class EmptyGarminClient(FakeGarminClient):
    def __init__(self):
        super().__init__()
        self.sleep = {}

    def get_hrv_data(self, day):
        return None


class FakeGarminSync:
    client_cls = FakeGarminClient

    def __init__(self, *args, **kwargs):
        pass

    def login(self):
        pass

    @property
    def client(self):
        return self.client_cls()


@pytest.fixture(autouse=True)
def fake_garmin_sync(monkeypatch):
    FakeGarminSync.client_cls = FakeGarminClient
    monkeypatch.setattr(body_insights, "GarminSync", FakeGarminSync)
    return FakeGarminSync


# ---- fetch_body_snapshot ------------------------------------------------------------------


def test_fetch_body_snapshot_returns_expected_fields():
    snapshot = body_insights.fetch_body_snapshot(target_date=date(2026, 8, 3))

    assert snapshot.has_overnight_data is True
    assert snapshot.readiness_score == 78
    assert snapshot.readiness_message == "Pronto a lavorare"
    assert snapshot.sleep.total_minutes == 450
    assert snapshot.sleep.deep_minutes == 90
    assert snapshot.resting_heart_rate == 48
    assert snapshot.battery_percent == 64
    assert snapshot.stress_level == 22
    assert len(snapshot.hrv_seven_day) == 7
    assert snapshot.hrv_last_night_ms == 55


def test_fetch_body_snapshot_missing_overnight_data_reported_not_errored(fake_garmin_sync):
    fake_garmin_sync.client_cls = EmptyGarminClient

    snapshot = body_insights.fetch_body_snapshot(target_date=date(2026, 8, 3))

    assert snapshot.has_overnight_data is False
    assert snapshot.sleep is None
    assert snapshot.hrv_last_night_ms is None


# ---- fetch_load_snapshot ------------------------------------------------------------------


def test_fetch_load_snapshot_marks_exactly_one_week_in_progress():
    snapshot = body_insights.fetch_load_snapshot(weeks=4)

    assert len(snapshot.weeks) == 4
    in_progress_flags = [w.in_progress for w in snapshot.weeks]
    assert in_progress_flags == [False, False, False, True]
    assert snapshot.acute_chronic_ratio == 1.28
    assert snapshot.vo2max == 52.3


# ---- assess_conflict ------------------------------------------------------------------------


def _session_with_intervals(count=6):
    return TrainingSession(
        date=date(2026, 8, 4),
        sport="running",
        title="Ripetute",
        steps=[Step(type="interval", duration_type="distance", duration_value=1.0) for _ in range(count)],
    )


def test_assess_conflict_flags_low_readiness_before_demanding_session():
    snapshot = body_insights.BodySnapshot(
        date=date(2026, 8, 3),
        has_overnight_data=True,
        readiness_score=40,
        hrv_seven_day=[(date(2026, 8, d), 60) for d in range(1, 7)] + [(date(2026, 8, 7), 30)],
    )

    assessment = body_insights.assess_conflict(snapshot, _session_with_intervals())

    assert assessment.has_conflict is True
    assert len(assessment.options) == 2
    assert {o.kind for o in assessment.options} == {"reschedule", "soften"}


def test_assess_conflict_no_conflict_without_next_session():
    snapshot = body_insights.BodySnapshot(date=date(2026, 8, 3), has_overnight_data=True, readiness_score=40)

    assessment = body_insights.assess_conflict(snapshot, None)

    assert assessment.has_conflict is False
    assert assessment.options == []


def test_assess_conflict_no_conflict_when_no_negative_signal():
    snapshot = body_insights.BodySnapshot(date=date(2026, 8, 3), has_overnight_data=True, readiness_score=85)

    assessment = body_insights.assess_conflict(snapshot, _session_with_intervals())

    assert assessment.has_conflict is False


def test_assess_conflict_no_conflict_without_overnight_data():
    snapshot = body_insights.BodySnapshot(date=date(2026, 8, 3), has_overnight_data=False, readiness_score=None)

    assessment = body_insights.assess_conflict(snapshot, _session_with_intervals())

    assert assessment.has_conflict is False
