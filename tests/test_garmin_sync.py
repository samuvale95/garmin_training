import json
import time
from datetime import date

import pytest

from training_plan.garmin_sync import (
    GarminRateLimitError,
    GarminSync,
    GarminSyncError,
    ScheduledWorkout,
    workout_fingerprint,
)
from training_plan.models import (
    SPORT_TYPE_PAYLOAD,
    PaceTarget,
    RepeatBlock,
    SessionStep,
    Step,
    TrainingSession,
)


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
        self.activities_by_range = {}
        self.workouts_by_id = {}

    def get_activities_by_date(self, startdate, enddate):
        return self.activities_by_range.get((startdate, enddate), [])

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

    def get_workout_by_id(self, workout_id):
        return self.workouts_by_id[workout_id]


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


# ---- repeat blocks ------------------------------------------------------------------------


def _session_with_repeat_block(reps: int = 6) -> TrainingSession:
    return TrainingSession(
        date=date(2026, 8, 5),
        sport="running",
        title="Ripetute",
        steps=[
            Step(type="warmup", duration_type="time", duration_value=10),
            RepeatBlock(
                reps=reps,
                steps=[
                    Step(
                        type="interval",
                        duration_type="distance",
                        duration_value=1,
                        target_pace=PaceTarget(slower_sec_per_km=285, faster_sec_per_km=275),
                    ),
                    Step(type="recovery", duration_type="time", duration_value=2),
                ],
            ),
            Step(type="cooldown", duration_type="time", duration_value=10),
        ],
    )


def test_repeat_block_becomes_a_repeat_group():
    sync, _ = make_sync_with_fake_client()
    steps = sync.build_workout_payload(_session_with_repeat_block())["workoutSegments"][0]["workoutSteps"]

    assert [s["type"] for s in steps] == ["ExecutableStepDTO", "RepeatGroupDTO", "ExecutableStepDTO"]
    group = steps[1]
    assert group["stepType"] == {"stepTypeId": 6, "stepTypeKey": "repeat", "displayOrder": 6}
    assert group["numberOfIterations"] == 6
    assert group["endCondition"]["conditionTypeKey"] == "iterations"
    assert group["endConditionValue"] == 6.0
    assert [s["stepType"]["stepTypeKey"] for s in group["workoutSteps"]] == ["interval", "recovery"]
    # The block's steps keep their own targets: the recovery has none, the interval does.
    assert group["workoutSteps"][0]["targetType"]["workoutTargetTypeKey"] == "pace.zone"


def test_repeat_group_children_are_marked_as_children():
    sync, _ = make_sync_with_fake_client()
    steps = sync.build_workout_payload(_session_with_repeat_block())["workoutSegments"][0]["workoutSteps"]

    assert all(child["childStepId"] == 1 for child in steps[1]["workoutSteps"])
    assert "childStepId" not in steps[0]


def test_step_order_runs_continuously_through_a_repeat_group():
    sync, _ = make_sync_with_fake_client()
    steps = sync.build_workout_payload(_session_with_repeat_block())["workoutSegments"][0]["workoutSteps"]

    # warmup 1, group 2, its two steps 3 and 4, cooldown 5 -- Garmin numbers the whole
    # tree, not each level separately.
    assert [steps[0]["stepOrder"], steps[1]["stepOrder"], steps[2]["stepOrder"]] == [1, 2, 5]
    assert [child["stepOrder"] for child in steps[1]["workoutSteps"]] == [3, 4]


def test_estimated_duration_counts_every_repetition():
    sync, _ = make_sync_with_fake_client()
    payload = sync.build_workout_payload(_session_with_repeat_block())

    # 10' warmup + 6 x 2' recovery + 10' cooldown; the distance-based interval adds none.
    assert payload["estimatedDurationInSecs"] == (10 + 6 * 2 + 10) * 60


def test_repeat_block_survives_a_round_trip_through_garmin():
    sync, fake = make_sync_with_fake_client()
    session = _session_with_repeat_block()
    fake.workouts_by_id[42] = sync.build_workout_payload(session)

    result = sync.get_workout_session(42, date(2026, 8, 5), "running", "Ripetute")

    assert result == session


def test_fingerprint_ignores_whether_repeats_are_grouped():
    """A block and the same steps written out one by one are the same workout.

    This is what keeps every workout uploaded before repeat blocks existed from
    showing up as "changed" the moment the same session is expressed as a block.
    """
    sync, _ = make_sync_with_fake_client()
    grouped = _session_with_repeat_block(reps=3)
    flat = TrainingSession(
        date=grouped.date,
        sport=grouped.sport,
        title=grouped.title,
        steps=[grouped.steps[0], *grouped.steps[1].steps * 3, grouped.steps[2]],
    )

    assert workout_fingerprint(sync.build_workout_payload(grouped)) == workout_fingerprint(
        sync.build_workout_payload(flat)
    )


def test_fingerprint_changes_with_the_number_of_repetitions():
    sync, _ = make_sync_with_fake_client()

    assert workout_fingerprint(
        sync.build_workout_payload(_session_with_repeat_block(reps=6))
    ) != workout_fingerprint(sync.build_workout_payload(_session_with_repeat_block(reps=5)))


def test_single_iteration_repeat_group_is_read_back_inline():
    """Nothing this app writes produces one (the editor and the file format both
    require at least two reps), but a workout authored in Garmin Connect can -- and a
    "1 ×" block would be noise in the UI."""
    sync, fake = make_sync_with_fake_client()
    fake.workouts_by_id[42] = {
        "description": None,
        "workoutSegments": [
            {
                "workoutSteps": [
                    {
                        "type": "RepeatGroupDTO",
                        "numberOfIterations": 1,
                        "workoutSteps": [
                            {
                                "type": "ExecutableStepDTO",
                                "stepType": {"stepTypeId": 3},
                                "endCondition": {"conditionTypeId": 3},
                                "endConditionValue": 400.0,
                                "targetType": {"workoutTargetTypeId": 1},
                            }
                        ],
                    }
                ]
            }
        ],
    }

    result = sync.get_workout_session(42, date(2026, 8, 5), "running", "400m")

    assert result.steps == [Step(type="interval", duration_type="distance", duration_value=0.4)]


def test_nested_repeat_groups_are_flattened_one_level():
    """`RepeatBlock` is one level deep, so an inner group read off Garmin is expanded
    into the outer block's steps rather than dropped."""
    sync, fake = make_sync_with_fake_client()
    inner_step = {
        "type": "ExecutableStepDTO",
        "stepType": {"stepTypeId": 3},
        "endCondition": {"conditionTypeId": 3},
        "endConditionValue": 200.0,
        "targetType": {"workoutTargetTypeId": 1},
    }
    fake.workouts_by_id[42] = {
        "description": None,
        "workoutSegments": [
            {
                "workoutSteps": [
                    {
                        "type": "RepeatGroupDTO",
                        "numberOfIterations": 2,
                        "workoutSteps": [
                            {
                                "type": "RepeatGroupDTO",
                                "numberOfIterations": 3,
                                "workoutSteps": [inner_step],
                            }
                        ],
                    }
                ]
            }
        ],
    }

    result = sync.get_workout_session(42, date(2026, 8, 5), "running", "2x(3x200m)")

    assert result.steps == [
        RepeatBlock(
            reps=2,
            steps=[Step(type="interval", duration_type="distance", duration_value=0.2)] * 3,
        )
    ]


def test_rest_step_type_round_trips():
    sync, fake = make_sync_with_fake_client()
    session = TrainingSession(
        date=date(2026, 8, 5),
        sport="running",
        title="Riposo fermo",
        steps=[Step(type="rest", duration_type="time", duration_value=2)],
    )
    payload = sync.build_workout_payload(session)
    fake.workouts_by_id[42] = payload

    assert payload["workoutSegments"][0]["workoutSteps"][0]["stepType"]["stepTypeKey"] == "rest"
    assert sync.get_workout_session(42, date(2026, 8, 5), "running", "Riposo fermo") == session


# ---- get_workout_session (reverse of build_workout_payload) ------------------------------


def test_get_workout_session_round_trips_a_flat_workout():
    sync, fake = make_sync_with_fake_client()
    session = TrainingSession(
        date=date(2026, 8, 5),
        sport="running",
        title="Vo2 Max",
        description="2x1000m",
        steps=[
            Step(type="warmup", duration_type="time", duration_value=10),
            Step(
                type="interval",
                duration_type="distance",
                duration_value=1,
                target_pace=PaceTarget(slower_sec_per_km=285, faster_sec_per_km=275),
            ),
            Step(type="recovery", duration_type="time", duration_value=2),
            Step(type="cooldown", duration_type="time", duration_value=10),
        ],
    )
    payload = sync.build_workout_payload(session)
    fake.workouts_by_id[42] = payload

    result = sync.get_workout_session(42, date(2026, 8, 5), "running", "Vo2 Max")

    assert result == session


def test_get_workout_session_reads_repeat_groups_as_blocks():
    sync, fake = make_sync_with_fake_client()
    fake.workouts_by_id[42] = {
        "description": None,
        "workoutSegments": [
            {
                "workoutSteps": [
                    {
                        "type": "RepeatGroupDTO",
                        "numberOfIterations": 3,
                        "workoutSteps": [
                            {
                                "type": "ExecutableStepDTO",
                                "stepType": {"stepTypeId": 3},
                                "endCondition": {"conditionTypeId": 3},
                                "endConditionValue": 400.0,
                                "targetType": {"workoutTargetTypeId": 1},
                            },
                            {
                                "type": "ExecutableStepDTO",
                                "stepType": {"stepTypeId": 4},
                                "endCondition": {"conditionTypeId": 2},
                                "endConditionValue": 60.0,
                                "targetType": {"workoutTargetTypeId": 1},
                            },
                        ],
                    }
                ]
            }
        ],
    }

    result = sync.get_workout_session(42, date(2026, 8, 5), "running", "3x400m")

    assert result.steps == [
        RepeatBlock(
            reps=3,
            steps=[
                Step(type="interval", duration_type="distance", duration_value=0.4),
                Step(type="recovery", duration_type="time", duration_value=1.0),
            ],
        )
    ]


def _flat_workout(steps: list[SessionStep]) -> dict:
    """A Garmin workout payload with `steps` written out one by one -- no repeat group
    anywhere -- which is what Connect stores for a loop typed in step by step."""
    sync, _ = make_sync_with_fake_client()
    session = TrainingSession(date=date(2026, 8, 5), sport="running", title="Ripetute", steps=steps)
    return sync.build_workout_payload(session)


def test_get_workout_session_reads_a_flat_repetition_as_a_block():
    """A loop written out flat in Garmin Connect describes the same thing as a repeat
    group, so it comes back as one instead of as six look-alike steps."""
    sync, fake = make_sync_with_fake_client()
    interval = Step(
        type="interval",
        duration_type="distance",
        duration_value=1,
        target_pace=PaceTarget(slower_sec_per_km=285, faster_sec_per_km=275),
    )
    recovery = Step(type="recovery", duration_type="time", duration_value=2)
    warmup = Step(type="warmup", duration_type="time", duration_value=10)
    cooldown = Step(type="cooldown", duration_type="time", duration_value=10)
    fake.workouts_by_id[42] = _flat_workout([warmup, *([interval, recovery] * 3), cooldown])

    result = sync.get_workout_session(42, date(2026, 8, 5), "running", "3x1000m")

    assert result.steps == [warmup, RepeatBlock(reps=3, steps=[interval, recovery]), cooldown]


def test_flat_repetition_folds_on_the_shortest_repeating_pattern():
    """Six identical intervals are "6 ×", not "3 × two of them" or "2 × three"."""
    sync, fake = make_sync_with_fake_client()
    interval = Step(type="interval", duration_type="distance", duration_value=0.4)
    fake.workouts_by_id[42] = _flat_workout([interval] * 6)

    result = sync.get_workout_session(42, date(2026, 8, 5), "running", "6x400m")

    assert result.steps == [RepeatBlock(reps=6, steps=[interval])]


def test_a_trailing_odd_step_stays_outside_the_folded_block():
    """The last recovery is often left off in Connect. Only the complete repetitions
    fold; the leftover interval stays a step of its own rather than being invented a
    recovery it never had."""
    sync, fake = make_sync_with_fake_client()
    interval = Step(type="interval", duration_type="distance", duration_value=0.4)
    recovery = Step(type="recovery", duration_type="time", duration_value=1)
    fake.workouts_by_id[42] = _flat_workout([interval, recovery, interval, recovery, interval])

    result = sync.get_workout_session(42, date(2026, 8, 5), "running", "3x400m")

    assert result.steps == [RepeatBlock(reps=2, steps=[interval, recovery]), interval]


def test_steps_that_only_look_alike_are_not_folded():
    """Different distances, different paces: consecutive is not the same as identical."""
    sync, fake = make_sync_with_fake_client()
    fast = Step(
        type="interval",
        duration_type="distance",
        duration_value=1,
        target_pace=PaceTarget(slower_sec_per_km=285, faster_sec_per_km=275),
    )
    slow = Step(
        type="interval",
        duration_type="distance",
        duration_value=1,
        target_pace=PaceTarget(slower_sec_per_km=305, faster_sec_per_km=295),
    )
    fake.workouts_by_id[42] = _flat_workout([fast, slow])

    result = sync.get_workout_session(42, date(2026, 8, 5), "running", "1000m + 1000m")

    assert result.steps == [fast, slow]


def test_a_flat_run_longer_than_garmin_allows_folds_in_chunks():
    """Garmin rejects a group of more than 99 iterations, so a longer run becomes a
    full block plus the remainder rather than one unsendable block."""
    sync, fake = make_sync_with_fake_client()
    step = Step(type="rest", duration_type="time", duration_value=1)
    fake.workouts_by_id[42] = _flat_workout([step] * 101)

    result = sync.get_workout_session(42, date(2026, 8, 5), "running", "Tanti riposi")

    assert result.steps == [RepeatBlock(reps=99, steps=[step]), RepeatBlock(reps=2, steps=[step])]


def test_get_workout_session_skips_steps_it_cannot_represent():
    sync, fake = make_sync_with_fake_client()
    fake.workouts_by_id[42] = {
        "description": None,
        "workoutSegments": [
            {
                "workoutSteps": [
                    # lap-button end condition: no defined duration, can't represent.
                    {
                        "type": "ExecutableStepDTO",
                        "stepType": {"stepTypeId": 3},
                        "endCondition": {"conditionTypeId": 1},
                        "endConditionValue": None,
                        "targetType": {"workoutTargetTypeId": 1},
                    },
                    {
                        "type": "ExecutableStepDTO",
                        "stepType": {"stepTypeId": 1},
                        "endCondition": {"conditionTypeId": 2},
                        "endConditionValue": 300.0,
                        "targetType": {"workoutTargetTypeId": 1},
                    },
                ]
            }
        ],
    }

    result = sync.get_workout_session(42, date(2026, 8, 5), "running", "Easy run")

    assert len(result.steps) == 1
    assert result.steps[0].type == "warmup"


@pytest.mark.parametrize(
    ("calendar_sport", "expected"),
    [
        ("running", "running"),
        ("trail_running", "running"),
        ("fitness_equipment", "strength_training"),
        ("indoor_cycling", "cycling"),
        ("lap_swimming", "swimming"),
        ("yoga", "other"),
        (None, "other"),
    ],
)
def test_get_workout_session_returns_a_writable_sport(calendar_sport, expected):
    """The calendar's sport is Garmin's own key; the session it produces is editable, so
    it has to come back in the file format `build_workout_payload` is keyed by."""
    sync, fake = make_sync_with_fake_client()
    fake.workouts_by_id[42] = {"description": None, "workoutSegments": []}

    result = sync.get_workout_session(42, date(2026, 8, 5), calendar_sport, "Sessione")

    assert result.sport == expected
    # And it survives the round trip back to Garmin, rather than raising on lookup.
    assert sync.build_workout_payload(result)["sportType"] == SPORT_TYPE_PAYLOAD[expected]


def test_build_workout_payload_falls_back_on_an_unknown_sport():
    """`replace_session` deletes before it creates: an unknown sport must not be the
    reason the replacement never happens."""
    sync, _ = make_sync_with_fake_client()
    session = TrainingSession(date=date(2026, 8, 1), sport="parkour", title="Salti")

    payload = sync.build_workout_payload(session)

    assert payload["sportType"] == SPORT_TYPE_PAYLOAD["other"]


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


def _activity_item(activity_id, start_local, name, sport="running", distance_m=5000.0, duration_s=1500.0):
    return {
        "activityId": activity_id,
        "startTimeLocal": start_local,
        "activityName": name,
        "activityType": {"typeKey": sport},
        "distance": distance_m,
        "duration": duration_s,
    }


def test_list_activities_parses_distance_and_duration():
    sync, fake = make_sync_with_fake_client()
    fake.activities_by_range[("2026-08-01", "2026-08-02")] = [
        _activity_item(1, "2026-08-01 08:14:20", "Morning run", distance_m=10000.0, duration_s=3000.0),
    ]

    activities = sync.list_activities(date(2026, 8, 1), date(2026, 8, 2))

    assert len(activities) == 1
    activity = activities[0]
    assert activity.date == date(2026, 8, 1)
    assert activity.sport == "running"
    assert activity.title == "Morning run"
    assert activity.distance_km == 10.0
    assert activity.duration_min == 50.0


def test_list_activities_sorted_and_missing_fields_default_to_none():
    sync, fake = make_sync_with_fake_client()
    later = _activity_item(2, "2026-08-02 07:00:00", "Second", distance_m=None, duration_s=None)
    del later["distance"]
    del later["duration"]
    earlier = _activity_item(1, "2026-08-01 07:00:00", "First")
    fake.activities_by_range[("2026-08-01", "2026-08-03")] = [later, earlier]

    activities = sync.list_activities(date(2026, 8, 1), date(2026, 8, 3))

    assert [a.title for a in activities] == ["First", "Second"]
    assert activities[1].distance_km is None
    assert activities[1].duration_min is None


def test_list_activities_empty_range():
    sync, _ = make_sync_with_fake_client()
    assert sync.list_activities(date(2026, 8, 1), date(2026, 8, 2)) == []


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
