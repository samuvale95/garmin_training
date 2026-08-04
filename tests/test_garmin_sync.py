import json
import time
from datetime import date

import pytest

from training_plan.garmin_sync import (
    GarminRateLimitError,
    GarminSync,
    GarminSyncError,
    ScheduledWorkout,
)
from training_plan.models import PaceTarget, Step, TrainingSession


class FakeClient:
    def __init__(self):
        self.uploaded = []
        self.scheduled = []
        self.unscheduled = []
        self.deleted = []
        self.next_workout_id = 100
        self.upload_should_fail = False
        self.schedule_should_fail = False
        self.calendar_by_month = {}

    def upload_workout(self, payload):
        if self.upload_should_fail:
            raise RuntimeError("upload failed")
        self.next_workout_id += 1
        self.uploaded.append(payload)
        return {"workoutId": self.next_workout_id}

    def schedule_workout(self, workout_id, date_str):
        if self.schedule_should_fail:
            raise RuntimeError("schedule failed")
        self.scheduled.append((workout_id, date_str))
        return {}

    def get_scheduled_workouts(self, year, month):
        return self.calendar_by_month.get((year, month), {"calendarItems": []})

    def unschedule_workout(self, scheduled_workout_id):
        self.unscheduled.append(scheduled_workout_id)

    def delete_workout(self, workout_id):
        self.deleted.append(workout_id)


def make_sync_with_fake_client():
    sync = GarminSync(email="a@b.com", password="pw", tokenstore="/tmp/does-not-matter")
    fake = FakeClient()
    sync._client = fake
    return sync, fake


# ---- login ----------------------------------------------------------------------------


def test_login_success(monkeypatch, tmp_path):
    class FakeGarmin:
        def __init__(self, email, password, prompt_mfa=None):
            self.email = email
            self.password = password

        def login(self, tokenstore=None):
            self.tokenstore_used = tokenstore

    monkeypatch.setattr("training_plan.garmin_sync.Garmin", FakeGarmin)
    sync = GarminSync(
        email="a@b.com",
        password="pw",
        tokenstore="/tmp/tokens",
        state_path=str(tmp_path / "state.json"),
    )
    sync.login()
    assert isinstance(sync.client, FakeGarmin)
    assert sync.client.tokenstore_used == "/tmp/tokens"


def test_login_reuses_cached_tokenstore_path(monkeypatch, tmp_path):
    seen = {}

    class FakeGarmin:
        def __init__(self, email, password, prompt_mfa=None):
            pass

        def login(self, tokenstore=None):
            seen["tokenstore"] = tokenstore

    monkeypatch.setattr("training_plan.garmin_sync.Garmin", FakeGarmin)
    sync = GarminSync(
        email="a@b.com",
        password="pw",
        tokenstore="/tmp/cached-tokens",
        state_path=str(tmp_path / "state.json"),
    )
    sync.login()
    assert seen["tokenstore"] == "/tmp/cached-tokens"


def test_login_failure_raises_garmin_sync_error(monkeypatch, tmp_path):
    from garminconnect import GarminConnectAuthenticationError

    class FakeGarmin:
        def __init__(self, email, password, prompt_mfa=None):
            pass

        def login(self, tokenstore=None):
            raise GarminConnectAuthenticationError("bad credentials")

    monkeypatch.setattr("training_plan.garmin_sync.Garmin", FakeGarmin)
    sync = GarminSync(
        email="a@b.com",
        password="wrong",
        tokenstore=str(tmp_path / "tokens"),
        state_path=str(tmp_path / "state.json"),
    )
    with pytest.raises(GarminSyncError):
        sync.login()


# ---- login throttling guards -----------------------------------------------------------


def _sync_with_temp_state(tmp_path, **kwargs):
    return GarminSync(
        email=kwargs.pop("email", "a@b.com"),
        password=kwargs.pop("password", "pw"),
        tokenstore=str(tmp_path / "tokens"),
        state_path=str(tmp_path / "state.json"),
        **kwargs,
    )


def test_missing_credentials_never_reaches_garmin(monkeypatch, tmp_path):
    def fail_if_constructed(*args, **kwargs):
        raise AssertionError("Garmin must not be constructed without credentials")

    monkeypatch.setattr("training_plan.garmin_sync.Garmin", fail_if_constructed)
    monkeypatch.delenv("GARMIN_EMAIL", raising=False)
    monkeypatch.delenv("GARMIN_PASSWORD", raising=False)

    # No cached tokens either (isolated tokenstore path), so credentials are required.
    sync = GarminSync(
        email=None,
        password=None,
        tokenstore=str(tmp_path / "tokens"),
        state_path=str(tmp_path / "state.json"),
    )
    with pytest.raises(GarminSyncError, match="Missing Garmin credentials"):
        sync.login()


def test_cached_tokens_allow_login_without_credentials(monkeypatch, tmp_path):
    """A cached session (e.g. from an earlier web /garmin/connect call, whose
    email/password this process never sees again) must resume via tokenstore alone --
    GET /garmin/workouts and friends construct GarminSync() with no credentials and
    rely on exactly this."""
    tokenstore = tmp_path / "tokens"
    tokenstore.mkdir()
    (tokenstore / "oauth1_token.json").write_text("{}")

    class FakeGarmin:
        def __init__(self, email, password, prompt_mfa=None):
            assert email is None
            assert password is None

        def login(self, tokenstore=None):
            self.tokenstore_used = tokenstore

    monkeypatch.setattr("training_plan.garmin_sync.Garmin", FakeGarmin)
    monkeypatch.delenv("GARMIN_EMAIL", raising=False)
    monkeypatch.delenv("GARMIN_PASSWORD", raising=False)

    sync = GarminSync(
        email=None,
        password=None,
        tokenstore=str(tokenstore),
        state_path=str(tmp_path / "state.json"),
    )
    sync.login()
    assert isinstance(sync.client, FakeGarmin)


def test_rate_limit_raises_dedicated_error_and_sets_cooldown(monkeypatch, tmp_path):
    from garminconnect import GarminConnectTooManyRequestsError

    class FakeGarmin:
        def __init__(self, email, password, prompt_mfa=None):
            pass

        def login(self, tokenstore=None):
            raise GarminConnectTooManyRequestsError("429")

    monkeypatch.setattr("training_plan.garmin_sync.Garmin", FakeGarmin)
    sync = _sync_with_temp_state(tmp_path)

    with pytest.raises(GarminRateLimitError):
        sync.login()

    # A cooldown is now recorded, so the next attempt is blocked locally.
    assert sync._cooldown_remaining() > 0


def test_active_cooldown_blocks_login_without_touching_garmin(monkeypatch, tmp_path):
    state = tmp_path / "state.json"
    state.write_text(json.dumps({"failures": 1, "retry_after": time.time() + 600, "reason": "rate_limited"}))

    def fail_if_constructed(*args, **kwargs):
        raise AssertionError("cooldown must short-circuit before any Garmin call")

    monkeypatch.setattr("training_plan.garmin_sync.Garmin", fail_if_constructed)
    sync = _sync_with_temp_state(tmp_path)

    with pytest.raises(GarminRateLimitError, match="temporarily blocked locally"):
        sync.login()


def test_expired_cooldown_allows_login(monkeypatch, tmp_path):
    state = tmp_path / "state.json"
    state.write_text(json.dumps({"failures": 1, "retry_after": time.time() - 1, "reason": "auth_failed"}))

    class FakeGarmin:
        def __init__(self, email, password, prompt_mfa=None):
            pass

        def login(self, tokenstore=None):
            pass

    monkeypatch.setattr("training_plan.garmin_sync.Garmin", FakeGarmin)
    sync = _sync_with_temp_state(tmp_path)
    sync.login()

    # A successful login clears the failure record entirely.
    assert sync._cooldown_remaining() == 0
    assert not state.exists()


def test_repeated_auth_failures_escalate_the_cooldown(monkeypatch, tmp_path):
    from garminconnect import GarminConnectAuthenticationError

    class FakeGarmin:
        def __init__(self, email, password, prompt_mfa=None):
            pass

        def login(self, tokenstore=None):
            raise GarminConnectAuthenticationError("bad credentials")

    monkeypatch.setattr("training_plan.garmin_sync.Garmin", FakeGarmin)
    sync = _sync_with_temp_state(tmp_path)

    # First failure is free (a plain typo shouldn't lock the user out)...
    with pytest.raises(GarminSyncError):
        sync.login()
    assert sync._cooldown_remaining() == 0

    # ...the second one starts backing off.
    with pytest.raises(GarminSyncError):
        sync.login()
    assert sync._cooldown_remaining() > 0


def test_cached_tokens_bypass_the_cooldown(monkeypatch, tmp_path):
    state = tmp_path / "state.json"
    state.write_text(json.dumps({"failures": 3, "retry_after": time.time() + 600, "reason": "rate_limited"}))
    tokenstore = tmp_path / "tokens"
    tokenstore.mkdir()
    (tokenstore / "oauth1_token.json").write_text("{}")

    class FakeGarmin:
        def __init__(self, email, password, prompt_mfa=None):
            pass

        def login(self, tokenstore=None):
            pass  # A cached session needs no SSO request, so the cooldown must not block it.

    monkeypatch.setattr("training_plan.garmin_sync.Garmin", FakeGarmin)
    sync = _sync_with_temp_state(tmp_path)
    sync.login()  # must not raise


def test_prompt_mfa_is_passed_through(monkeypatch, tmp_path):
    seen = {}

    class FakeGarmin:
        def __init__(self, email, password, prompt_mfa=None):
            seen["prompt_mfa"] = prompt_mfa

        def login(self, tokenstore=None):
            pass

    monkeypatch.setattr("training_plan.garmin_sync.Garmin", FakeGarmin)
    callback = lambda: "123456"  # noqa: E731
    sync = _sync_with_temp_state(tmp_path, prompt_mfa=callback)
    sync.login()

    assert seen["prompt_mfa"] is callback


def test_client_property_before_login_raises():
    sync = GarminSync(email="a@b.com", password="pw")
    with pytest.raises(GarminSyncError):
        _ = sync.client


# ---- workout payload building ----------------------------------------------------------


def test_build_workout_payload_simple_entry():
    sync, _ = make_sync_with_fake_client()
    session = TrainingSession(date=date(2026, 8, 1), sport="running", title="Easy run")
    payload = sync.build_workout_payload(session)

    steps = payload["workoutSegments"][0]["workoutSteps"]
    assert len(steps) == 1
    assert steps[0]["stepType"]["stepTypeKey"] == "interval"
    assert steps[0]["endCondition"]["conditionTypeKey"] == "lap.button"
    assert payload["sportType"]["sportTypeKey"] == "running"
    assert payload["workoutName"] == "Easy run"


def test_end_condition_ids_match_garmins_real_taxonomy():
    """Guards against the bundled library's wrong ConditionType values.

    Verified against the live API: 1=lap.button, 2=time, 3=distance. Using the
    library's DISTANCE=1 silently turns a distance step into a lap-button step.
    """
    from training_plan.models import CONDITION_TYPE_PAYLOAD, LAP_BUTTON_CONDITION_PAYLOAD

    assert CONDITION_TYPE_PAYLOAD["time"]["conditionTypeId"] == 2
    assert CONDITION_TYPE_PAYLOAD["distance"]["conditionTypeId"] == 3
    assert LAP_BUTTON_CONDITION_PAYLOAD["conditionTypeId"] == 1


def test_distance_step_uses_distance_condition_not_lap_button():
    sync, _ = make_sync_with_fake_client()
    session = TrainingSession(
        date=date(2026, 8, 5),
        sport="running",
        title="1km repeat",
        steps=[Step(type="interval", duration_type="distance", duration_value=1)],
    )
    step = sync.build_workout_payload(session)["workoutSegments"][0]["workoutSteps"][0]

    assert step["endCondition"]["conditionTypeKey"] == "distance"
    assert step["endCondition"]["conditionTypeId"] == 3
    assert step["endConditionValue"] == 1000


def test_build_workout_payload_structured_entry_preserves_order():
    sync, _ = make_sync_with_fake_client()
    session = TrainingSession(
        date=date(2026, 8, 2),
        sport="cycling",
        title="Intervals",
        steps=[
            Step(type="warmup", duration_type="time", duration_value=10),
            Step(type="interval", duration_type="distance", duration_value=2),
            Step(type="cooldown", duration_type="time", duration_value=5),
        ],
    )
    payload = sync.build_workout_payload(session)
    steps = payload["workoutSegments"][0]["workoutSteps"]

    assert [s["stepType"]["stepTypeKey"] for s in steps] == ["warmup", "interval", "cooldown"]
    assert steps[0]["endConditionValue"] == 600  # 10 min -> seconds
    assert steps[1]["endConditionValue"] == 2000  # 2 km -> meters
    assert payload["estimatedDurationInSecs"] == 900  # warmup + cooldown time steps only


def test_step_without_target_pace_uses_no_target():
    sync, _ = make_sync_with_fake_client()
    session = TrainingSession(
        date=date(2026, 8, 5),
        sport="running",
        title="Steady",
        steps=[Step(type="interval", duration_type="time", duration_value=20)],
    )
    step = sync.build_workout_payload(session)["workoutSegments"][0]["workoutSteps"][0]

    assert step["targetType"]["workoutTargetTypeKey"] == "no.target"
    assert "targetValueOne" not in step
    assert "targetValueTwo" not in step


def test_step_with_target_pace_emits_pace_zone_and_speeds():
    sync, _ = make_sync_with_fake_client()
    session = TrainingSession(
        date=date(2026, 8, 5),
        sport="running",
        title="Threshold",
        steps=[
            Step(
                type="interval",
                duration_type="distance",
                duration_value=5,
                # 8:30/km slower bound, 8:00/km faster bound
                target_pace=PaceTarget(slower_sec_per_km=510, faster_sec_per_km=480),
            )
        ],
    )
    step = sync.build_workout_payload(session)["workoutSegments"][0]["workoutSteps"][0]

    assert step["targetType"]["workoutTargetTypeId"] == 6
    assert step["targetType"]["workoutTargetTypeKey"] == "pace.zone"
    # Bounds live on the step itself (not nested in targetType), in m/s, slower first.
    assert step["targetValueOne"] == 1.9607843
    assert step["targetValueTwo"] == 2.0833333
    assert "targetValueOne" not in step["targetType"]


def test_mixed_steps_only_targeted_ones_get_pace():
    sync, _ = make_sync_with_fake_client()
    session = TrainingSession(
        date=date(2026, 8, 5),
        sport="running",
        title="Intervals",
        steps=[
            Step(type="warmup", duration_type="time", duration_value=10),
            Step(
                type="interval",
                duration_type="distance",
                duration_value=1,
                target_pace=PaceTarget(slower_sec_per_km=260, faster_sec_per_km=250),
            ),
        ],
    )
    steps = sync.build_workout_payload(session)["workoutSegments"][0]["workoutSteps"]

    assert steps[0]["targetType"]["workoutTargetTypeKey"] == "no.target"
    assert steps[1]["targetType"]["workoutTargetTypeKey"] == "pace.zone"


# ---- create & schedule ------------------------------------------------------------------


def test_create_and_schedule_success():
    sync, fake = make_sync_with_fake_client()
    session = TrainingSession(date=date(2026, 8, 1), sport="running", title="Easy run")

    result = sync.create_and_schedule(session)

    assert result.success
    assert len(fake.uploaded) == 1
    assert fake.scheduled == [(fake.next_workout_id, "2026-08-01")]


def test_sync_all_continues_after_one_failure():
    sync, fake = make_sync_with_fake_client()
    sessions = [
        TrainingSession(date=date(2026, 8, 1), sport="running", title="Good one"),
        TrainingSession(date=date(2026, 8, 2), sport="running", title="Bad one"),
        TrainingSession(date=date(2026, 8, 3), sport="running", title="Good two"),
    ]

    original_upload = fake.upload_workout
    call_count = {"n": 0}

    def flaky_upload(payload):
        call_count["n"] += 1
        if call_count["n"] == 2:
            raise RuntimeError("boom")
        return original_upload(payload)

    fake.upload_workout = flaky_upload

    results = sync.sync_all(sessions)

    assert [r.success for r in results] == [True, False, True]
    assert results[1].error == "boom"


# ---- listing existing workouts -----------------------------------------------------------


def _calendar_item(scheduled_id, workout_id, date_str, title, sport="running"):
    return {
        "itemType": "workout",
        "id": scheduled_id,
        "workoutId": workout_id,
        "date": date_str,
        "title": title,
        "sportType": sport,
    }


def test_list_scheduled_workouts_filters_to_date_range_across_months():
    sync, fake = make_sync_with_fake_client()
    fake.calendar_by_month[(2026, 7)] = {
        "calendarItems": [_calendar_item(1, 10, "2026-07-30", "End of July run")]
    }
    fake.calendar_by_month[(2026, 8)] = {
        "calendarItems": [
            _calendar_item(2, 11, "2026-08-01", "In range"),
            _calendar_item(3, 12, "2026-08-15", "Also in range"),
        ]
    }

    workouts = sync.list_scheduled_workouts(date(2026, 7, 30), date(2026, 8, 2))

    assert [w.title for w in workouts] == ["End of July run", "In range"]


def test_list_scheduled_workouts_empty_range():
    sync, fake = make_sync_with_fake_client()
    workouts = sync.list_scheduled_workouts(date(2026, 8, 1), date(2026, 8, 31))
    assert workouts == []


def test_select_workouts_combined_filters():
    sync, _ = make_sync_with_fake_client()
    workouts = [
        ScheduledWorkout(1, 10, date(2026, 8, 1), "running", "Easy Run"),
        ScheduledWorkout(2, 11, date(2026, 8, 2), "cycling", "Long Ride"),
        ScheduledWorkout(3, 12, date(2026, 8, 3), "running", "Intervals"),
    ]

    selected = sync.select_workouts(workouts, sport="running", title_match="easy")
    assert [w.title for w in selected] == ["Easy Run"]


def test_select_workouts_no_match_returns_empty():
    sync, _ = make_sync_with_fake_client()
    workouts = [ScheduledWorkout(1, 10, date(2026, 8, 1), "running", "Easy Run")]
    assert sync.select_workouts(workouts, title_match="marathon") == []


# ---- plan diff -----------------------------------------------------------------------------


def _session(day, title, sport="running"):
    return TrainingSession(date=date(2026, 8, day), sport=sport, title=title)


def _seed_calendar(fake, items):
    fake.calendar_by_month[(2026, 8)] = {"calendarItems": list(items)}


def test_diff_marks_missing_sessions_for_creation():
    sync, fake = make_sync_with_fake_client()
    _seed_calendar(fake, [_calendar_item(1, 10, "2026-08-01", "Lungo")])

    diff = sync.diff_plan([_session(1, "Lungo"), _session(3, "Corsa 40'")])

    assert [s.title for s in diff.to_create] == ["Corsa 40'"]
    assert [s.title for s in diff.already_present] == ["Lungo"]
    assert diff.extra_on_garmin == []


def test_diff_reports_calendar_entries_absent_from_the_file():
    sync, fake = make_sync_with_fake_client()
    _seed_calendar(
        fake,
        [
            _calendar_item(1, 10, "2026-08-01", "Lungo"),
            _calendar_item(2, 11, "2026-08-02", "Vecchia sessione"),
        ],
    )

    diff = sync.diff_plan([_session(1, "Lungo"), _session(2, "Vecchia sessione")])
    assert diff.extra_on_garmin == []

    # Narrow the plan: the 08-02 entry is now unaccounted for, but only inside the
    # plan's own date range, so it must still be reported.
    diff = sync.diff_plan([_session(1, "Lungo"), _session(2, "Altro")])
    assert [w.title for w in diff.extra_on_garmin] == ["Vecchia sessione"]


def test_diff_matching_ignores_case_and_surrounding_whitespace():
    sync, fake = make_sync_with_fake_client()
    _seed_calendar(fake, [_calendar_item(1, 10, "2026-08-01", "Lungo  con   3x4' veloce")])

    diff = sync.diff_plan([_session(1, "  LUNGO con 3x4' VELOCE ")])

    assert diff.to_create == []
    assert len(diff.already_present) == 1


def test_diff_distinguishes_same_title_on_different_dates():
    sync, fake = make_sync_with_fake_client()
    _seed_calendar(fake, [_calendar_item(1, 10, "2026-08-03", "Corsa 40'")])

    diff = sync.diff_plan([_session(3, "Corsa 40'"), _session(10, "Corsa 40'")])

    assert [s.date.day for s in diff.to_create] == [10]
    assert [s.date.day for s in diff.already_present] == [3]


def test_diff_on_empty_plan_makes_no_calls():
    sync, fake = make_sync_with_fake_client()

    def fail_if_called(*args, **kwargs):
        raise AssertionError("an empty plan needs no calendar read")

    fake.get_scheduled_workouts = fail_if_called
    diff = sync.diff_plan([])

    assert (diff.to_create, diff.already_present, diff.extra_on_garmin) == ([], [], [])


def test_diff_queries_only_the_plans_date_range():
    sync, fake = make_sync_with_fake_client()
    queried = []
    original = fake.get_scheduled_workouts

    def spy(year, month):
        queried.append((year, month))
        return original(year, month)

    fake.get_scheduled_workouts = spy
    sync.diff_plan([_session(1, "A"), _session(15, "B")])

    assert queried == [(2026, 8)]


# ---- deleting existing workouts -----------------------------------------------------------


def test_delete_workout_success():
    sync, fake = make_sync_with_fake_client()
    workout = ScheduledWorkout(1, 10, date(2026, 8, 1), "running", "Easy Run")

    result = sync.delete_workout(workout)

    assert result.success
    assert fake.unscheduled == [1]
    assert fake.deleted == [10]


def test_delete_all_continues_after_one_failure():
    sync, fake = make_sync_with_fake_client()
    workouts = [
        ScheduledWorkout(1, 10, date(2026, 8, 1), "running", "Good"),
        ScheduledWorkout(2, 11, date(2026, 8, 2), "running", "Bad"),
    ]

    original_delete = fake.delete_workout

    def flaky_delete(workout_id):
        if workout_id == 11:
            raise RuntimeError("cannot delete")
        return original_delete(workout_id)

    fake.delete_workout = flaky_delete

    results = sync.delete_all(workouts)

    assert [r.success for r in results] == [True, False]
    assert results[1].error == "cannot delete"
