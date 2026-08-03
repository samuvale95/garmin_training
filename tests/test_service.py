from datetime import date

import pytest

from training_plan import service
from training_plan.garmin_sync import (
    ChangedSession,
    DeleteResult,
    GarminSyncError,
    PlanDiff,
    ScheduledWorkout,
    SyncResult,
)
from training_plan.models import TrainingSession


class FakeGarminSync:
    """Records calls so tests can assert on them without touching real Garmin."""

    instances: list["FakeGarminSync"] = []

    def __init__(self, prompt_mfa=None):
        self.prompt_mfa = prompt_mfa
        self.logged_in = False
        self.login_should_fail = False
        self.calls = []
        FakeGarminSync.instances.append(self)

    def login(self):
        self.calls.append("login")
        if self.login_should_fail:
            raise GarminSyncError("bad credentials")
        self.logged_in = True

    def diff_plan(self, sessions, check_content=False):
        self.calls.append(("diff_plan", sessions, check_content))
        return PlanDiff(to_create=list(sessions), already_present=[], extra_on_garmin=[])

    def sync_all(self, sessions):
        self.calls.append(("sync_all", sessions))
        return [SyncResult(session=s, success=True) for s in sessions]

    def replace_all(self, changes):
        self.calls.append(("replace_all", changes))
        return [SyncResult(session=c.session, success=True) for c in changes]

    def list_scheduled_workouts(self, start, end):
        self.calls.append(("list_scheduled_workouts", start, end))
        return [ScheduledWorkout(1, 10, date(2026, 8, 1), "running", "Easy Run")]

    def select_workouts(self, workouts, sport=None, title_match=None):
        self.calls.append(("select_workouts", sport, title_match))
        return workouts

    def delete_all(self, workouts):
        self.calls.append(("delete_all", workouts))
        return [DeleteResult(workout=w, success=True) for w in workouts]


@pytest.fixture(autouse=True)
def fake_garmin_sync(monkeypatch):
    FakeGarminSync.instances = []
    monkeypatch.setattr(service, "GarminSync", FakeGarminSync)
    return FakeGarminSync


def _session(day=1, title="Easy run"):
    return TrainingSession(date=date(2026, 8, day), sport="running", title=title)


# ---- verify_login -----------------------------------------------------------------------


def test_verify_login_success_raises_nothing():
    service.verify_login()  # must not raise
    assert FakeGarminSync.instances[0].logged_in


def test_verify_login_failure_propagates(monkeypatch):
    def fail_init(prompt_mfa=None):
        instance = FakeGarminSync(prompt_mfa=prompt_mfa)
        instance.login_should_fail = True
        return instance

    monkeypatch.setattr(service, "GarminSync", fail_init)

    with pytest.raises(GarminSyncError):
        service.verify_login()


def test_verify_login_passes_prompt_mfa_through():
    callback = lambda: "123456"  # noqa: E731
    service.verify_login(prompt_mfa=callback)
    assert FakeGarminSync.instances[0].prompt_mfa is callback


def test_verify_login_prints_nothing(capsys):
    service.verify_login()
    out, err = capsys.readouterr()
    assert out == "" and err == ""


# ---- preview_plan_sync / apply_plan_sync -------------------------------------------------


def test_preview_plan_sync_no_diff_skips_diff_call():
    sessions = [_session(1), _session(2)]

    preview = service.preview_plan_sync(sessions, no_diff=True)

    assert preview.diff is None
    assert preview.to_create == sessions
    assert "diff_plan" not in [c[0] for c in preview.sync.calls if isinstance(c, tuple)]


def test_preview_plan_sync_with_diff_calls_diff_plan_with_check_content():
    sessions = [_session(1)]

    preview = service.preview_plan_sync(sessions, no_diff=False, check_content=True)

    diff_call = next(c for c in preview.sync.calls if isinstance(c, tuple) and c[0] == "diff_plan")
    assert diff_call[1] == sessions
    assert diff_call[2] is True
    assert preview.to_create == preview.diff.to_create


def test_preview_plan_sync_on_authenticated_runs_after_login_before_diff():
    order = []

    preview = service.preview_plan_sync(
        [_session(1)], no_diff=False, on_authenticated=lambda: order.append("authenticated")
    )

    # "authenticated" must land between login and diff_plan, matching the CLI's
    # original print-after-login-before-diff ordering for the --deep/--update message.
    call_names = ["login" if c == "login" else c[0] for c in preview.sync.calls]
    assert call_names == ["login", "diff_plan"]
    assert order == ["authenticated"]


def test_preview_plan_sync_on_authenticated_not_called_on_login_failure(monkeypatch):
    def fail_init(prompt_mfa=None):
        instance = FakeGarminSync(prompt_mfa=prompt_mfa)
        instance.login_should_fail = True
        return instance

    monkeypatch.setattr(service, "GarminSync", fail_init)
    called = []

    with pytest.raises(GarminSyncError):
        service.preview_plan_sync([_session(1)], on_authenticated=lambda: called.append(True))

    assert called == []


def test_preview_plan_sync_login_failure_propagates_before_diff(monkeypatch):
    def fail_init(prompt_mfa=None):
        instance = FakeGarminSync(prompt_mfa=prompt_mfa)
        instance.login_should_fail = True
        return instance

    monkeypatch.setattr(service, "GarminSync", fail_init)

    with pytest.raises(GarminSyncError):
        service.preview_plan_sync([_session(1)])


def test_apply_plan_sync_creates_and_replaces():
    sessions = [_session(1), _session(2)]
    preview = service.preview_plan_sync(sessions, no_diff=True)
    changed_session = _session(3)
    change = ChangedSession(
        session=changed_session,
        workout=ScheduledWorkout(9, 99, date(2026, 8, 3), "running", "Old"),
        local_hash="a",
        remote_hash="b",
    )

    results = service.apply_plan_sync(preview, changed=[change])

    assert len(results) == 3  # 1 replaced + 2 created
    replace_call = next(c for c in preview.sync.calls if isinstance(c, tuple) and c[0] == "replace_all")
    sync_call = next(c for c in preview.sync.calls if isinstance(c, tuple) and c[0] == "sync_all")
    assert replace_call[1] == [change]
    assert sync_call[1] == sessions


def test_apply_plan_sync_default_changed_is_empty():
    preview = service.preview_plan_sync([_session(1)], no_diff=True)
    service.apply_plan_sync(preview)
    replace_call = next(c for c in preview.sync.calls if isinstance(c, tuple) and c[0] == "replace_all")
    assert replace_call[1] == []


def test_plan_sync_functions_print_nothing(capsys):
    preview = service.preview_plan_sync([_session(1)], no_diff=True)
    service.apply_plan_sync(preview)
    out, err = capsys.readouterr()
    assert out == "" and err == ""


# ---- list_workouts ------------------------------------------------------------------------


def test_list_workouts_logs_in_then_lists():
    result = service.list_workouts(date(2026, 8, 1), date(2026, 8, 31))

    assert len(result) == 1
    sync = FakeGarminSync.instances[0]
    assert sync.calls[0] == "login"
    assert sync.calls[1][0] == "list_scheduled_workouts"


# ---- preview_deletion / apply_deletion -----------------------------------------------------


def test_preview_deletion_lists_and_filters():
    preview = service.preview_deletion(date(2026, 8, 1), date(2026, 8, 31), sport="running", title_match="easy")

    assert len(preview.selected) == 1
    select_call = next(c for c in preview.sync.calls if isinstance(c, tuple) and c[0] == "select_workouts")
    assert select_call[1] == "running"
    assert select_call[2] == "easy"


def test_apply_deletion_deletes_exactly_the_preview_selection():
    preview = service.preview_deletion(date(2026, 8, 1), date(2026, 8, 31))

    results = service.apply_deletion(preview)

    assert len(results) == len(preview.selected)
    delete_call = next(c for c in preview.sync.calls if isinstance(c, tuple) and c[0] == "delete_all")
    assert delete_call[1] == preview.selected


def test_deletion_functions_print_nothing(capsys):
    preview = service.preview_deletion(date(2026, 8, 1), date(2026, 8, 31))
    service.apply_deletion(preview)
    out, err = capsys.readouterr()
    assert out == "" and err == ""
