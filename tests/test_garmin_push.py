"""The plan -> Garmin reconcile, against an in-memory Garmin and an in-memory link table."""

from datetime import date

import pytest

from training_plan import garmin_push
from training_plan.garmin_sync import GarminRateLimitError, GarminSync, ScheduledWorkout
from training_plan.models import ShortVariant, TrainingSession

TODAY = date(2026, 11, 2)


class FakeClient:
    def __init__(self):
        self.workouts = {}  # workout_id -> payload
        self.schedule = {}  # scheduled_id -> (workout_id, date)
        self.next_id = 100
        self.fail_schedule = False
        self.rate_limit = False

    def upload_workout(self, payload):
        if self.rate_limit:
            raise GarminRateLimitError("429", retry_after_seconds=60)
        self.next_id += 1
        self.workouts[self.next_id] = payload
        return {"workoutId": self.next_id}

    def schedule_workout(self, workout_id, day):
        if self.fail_schedule:
            raise RuntimeError("schedule failed")
        self.next_id += 1
        self.schedule[self.next_id] = (workout_id, day)
        return {"workoutScheduleId": self.next_id}

    def unschedule_workout(self, scheduled_id):
        if scheduled_id not in self.schedule:
            raise RuntimeError("404 Not Found")
        del self.schedule[scheduled_id]

    def delete_workout(self, workout_id):
        if workout_id not in self.workouts:
            raise RuntimeError("404 Not Found")
        del self.workouts[workout_id]
        self.schedule = {k: v for k, v in self.schedule.items() if v[0] != workout_id}

    def calendar(self):
        return sorted((day, self.workouts[w]["workoutName"]) for w, day in self.schedule.values())


class FakeSync(GarminSync):
    def __init__(self):
        self._client = FakeClient()

    def list_scheduled_workouts(self, start, end):
        return [
            ScheduledWorkout(scheduled_workout_id=sid, workout_id=w, date=date.fromisoformat(d), sport="running",
                             title=self.client.workouts[w]["workoutName"])
            for sid, (w, d) in self.client.schedule.items()
        ]


@pytest.fixture
def world(monkeypatch):
    plan: dict[str, TrainingSession] = {}
    links: dict[str, dict] = {}
    monkeypatch.setattr(garmin_push, "WRITE_PAUSE_S", 0)
    monkeypatch.setattr(garmin_push, "wanted_sessions", lambda user_id, today: {k: garmin_push.effective(v) for k, v in plan.items()})
    monkeypatch.setattr(garmin_push, "_links", lambda user_id: {k: dict(v) for k, v in links.items()})

    def save(user_id, sid, **fields):
        links.setdefault(sid, {"attempts": 0}).update(fields)

    monkeypatch.setattr(garmin_push, "_save_link", save)
    monkeypatch.setattr(garmin_push, "_drop_link", lambda user_id, sid: links.pop(sid, None))
    monkeypatch.setattr(garmin_push, "_session_exists", lambda user_id, sid: sid in plan)
    return plan, links, FakeSync()


def _session(day, title="Corsa facile", **kw):
    return TrainingSession(date=date(2026, 11, day), sport="running", title=title, **kw)


def run(sync):
    return garmin_push.reconcile("u", sync, today=TODAY)


def test_an_edit_reaches_garmin_without_any_sync_screen(world):
    plan, links, sync = world
    plan["a"] = _session(3)
    report = run(sync)
    assert report.pushed == 1 and sync.client.calendar() == [("2026-11-03", "Corsa facile")]
    assert links["a"]["status"] == "ok"
    # Nothing changed: nothing to do.
    assert run(sync).pushed == 0


def test_a_moved_session_leaves_its_old_day(world):
    plan, links, sync = world
    plan["a"] = _session(3)
    run(sync)
    plan["a"] = _session(5)
    run(sync)
    assert sync.client.calendar() == [("2026-11-05", "Corsa facile")]


def test_a_renamed_session_is_not_duplicated(world):
    plan, links, sync = world
    plan["a"] = _session(3)
    run(sync)
    plan["a"] = _session(3, title="Lungo lento")
    run(sync)
    assert sync.client.calendar() == [("2026-11-03", "Lungo lento")]


def test_a_deleted_session_leaves_the_watch(world):
    plan, links, sync = world
    plan["a"] = _session(3)
    run(sync)
    del plan["a"]
    report = run(sync)
    assert report.deleted == 1 and sync.client.calendar() == [] and "a" not in links


def test_the_short_variant_is_what_gets_uploaded(world):
    plan, links, sync = world
    plan["a"] = _session(3, short_variant=ShortVariant(title="Corsa corta", steps=[]), is_short_active=True)
    run(sync)
    assert sync.client.calendar() == [("2026-11-03", "Corsa corta")]


def test_a_failed_schedule_leaves_no_orphan_and_is_retried(world):
    plan, links, sync = world
    plan["a"] = _session(3)
    sync.client.fail_schedule = True
    report = run(sync)
    assert report.failed == 1 and links["a"]["status"] == "failed" and "schedule failed" in links["a"]["error"]
    assert sync.client.workouts == {}
    sync.client.fail_schedule = False
    run(sync)
    assert links["a"]["status"] == "ok" and sync.client.calendar() == [("2026-11-03", "Corsa facile")]


def test_a_rate_limit_stops_and_keeps_it_pending(world):
    plan, links, sync = world
    plan["a"] = _session(3)
    sync.client.rate_limit = True
    report = run(sync)
    assert report.stopped_early and links["a"]["status"] == "pending"


def test_a_calendar_synced_the_old_way_is_adopted_not_duplicated(world):
    plan, links, sync = world
    wid = sync.client.upload_workout(sync.build_workout_payload(_session(3)))["workoutId"]
    sync.client.schedule_workout(wid, "2026-11-03")
    plan["a"] = _session(3)
    report = run(sync)
    assert report.adopted == 1
    assert sync.client.calendar() == [("2026-11-03", "Corsa facile")]


def test_a_past_session_stays_on_the_calendar(world):
    plan, links, sync = world
    plan["a"] = _session(3)
    run(sync)
    # A week later the session is behind the window but still in the plan.
    later = date(2026, 11, 10)
    plan_backup = dict(plan)
    plan.clear()
    import training_plan.garmin_push as gp
    original = gp._session_exists
    gp._session_exists = lambda user_id, sid: sid in plan_backup
    try:
        report = gp.reconcile("u", sync, today=later)
    finally:
        gp._session_exists = original
    assert report.deleted == 0 and sync.client.calendar() == [("2026-11-03", "Corsa facile")]


def test_recurring_titles_are_not_moved_to_another_week(world, monkeypatch):
    """The bug that slid whole plans a week forward: matching by title."""
    plan, links, sync = world
    plan["a"] = _session(3, title="Corsa facile")
    plan["b"] = _session(10, title="Corsa facile")
    run(sync)
    moved = []
    import training_plan.plan_store as ps
    monkeypatch.setattr(ps, "update_session", lambda u, sid, ch, by_user: moved.append((sid, ch)))
    assert garmin_push.pull_moves("u", sync.list_scheduled_workouts(None, None)) == 0
    assert moved == []


def test_a_workout_moved_on_garmin_moves_its_session(world, monkeypatch):
    plan, links, sync = world
    plan["a"] = _session(3)
    run(sync)
    sid = links["a"]["scheduled_id"]
    wid, _ = sync.client.schedule[sid]
    sync.client.schedule[sid] = (wid, "2026-11-04")
    moved = []
    import training_plan.plan_store as ps
    monkeypatch.setattr(ps, "update_session", lambda u, s, ch, by_user: moved.append((s, ch)))
    assert garmin_push.pull_moves("u", sync.list_scheduled_workouts(None, None)) == 1
    assert moved == [("a", {"date": "2026-11-04"})]
    assert links["a"]["garmin_date"] == date(2026, 11, 4) and links["a"]["pushed_hash"].startswith("2026-11-04|")
