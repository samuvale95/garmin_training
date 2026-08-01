from datetime import date

import pytest

from training_plan import cli
from training_plan.garmin_sync import DeleteResult, ScheduledWorkout


def _write_plan(tmp_path, content):
    path = tmp_path / "plan.yaml"
    path.write_text(content)
    return path


def test_sync_only_adds_sessions_missing_from_the_calendar(tmp_path, capsys, monkeypatch):
    path = _write_plan(
        tmp_path,
        """
        sessions:
          - date: "2026-08-01"
            sport: running
            title: Gia presente
          - date: "2026-08-03"
            sport: running
            title: Nuova
        """,
    )

    created = []

    class DiffSync:
        def login(self):
            pass

        def diff_plan(self, sessions, check_content=False):
            from training_plan.garmin_sync import PlanDiff

            return PlanDiff(
                to_create=[s for s in sessions if s.title == "Nuova"],
                already_present=[s for s in sessions if s.title == "Gia presente"],
                extra_on_garmin=[],
            )

        def sync_all(self, sessions):
            from training_plan.garmin_sync import SyncResult

            created.extend(s.title for s in sessions)
            return [SyncResult(session=s, success=True) for s in sessions]

        def replace_all(self, changes):
            return []

    monkeypatch.setattr(cli, "GarminSync", lambda *a, **k: DiffSync())

    exit_code = cli.main(["sync", "--file", str(path)])

    assert exit_code == 0
    assert created == ["Nuova"]  # the already-scheduled one must not be re-created
    out = capsys.readouterr().out
    assert "1 to add" in out
    assert "1 succeeded" in out


def test_sync_does_nothing_when_calendar_already_matches(tmp_path, capsys, monkeypatch):
    path = _write_plan(
        tmp_path,
        """
        sessions:
          - date: "2026-08-01"
            sport: running
            title: Gia presente
        """,
    )

    class NoopSync:
        def login(self):
            pass

        def diff_plan(self, sessions, check_content=False):
            from training_plan.garmin_sync import PlanDiff

            return PlanDiff(to_create=[], already_present=list(sessions), extra_on_garmin=[])

        def sync_all(self, sessions):
            raise AssertionError("nothing should be created when the diff is empty")

        def replace_all(self, changes):
            return []

    monkeypatch.setattr(cli, "GarminSync", lambda *a, **k: NoopSync())

    assert cli.main(["sync", "--file", str(path)]) == 0
    assert "Nothing to do" in capsys.readouterr().out


def test_sync_no_diff_flag_imports_everything(tmp_path, capsys, monkeypatch):
    path = _write_plan(
        tmp_path,
        """
        sessions:
          - date: "2026-08-01"
            sport: running
            title: Una
        """,
    )

    class ForceSync:
        def login(self):
            pass

        def diff_plan(self, sessions, check_content=False):
            raise AssertionError("--no-diff must skip the calendar comparison")

        def sync_all(self, sessions):
            from training_plan.garmin_sync import SyncResult

            return [SyncResult(session=s, success=True) for s in sessions]

        def replace_all(self, changes):
            return []

    monkeypatch.setattr(cli, "GarminSync", lambda *a, **k: ForceSync())

    assert cli.main(["sync", "--file", str(path), "--no-diff"]) == 0
    assert "1 succeeded" in capsys.readouterr().out


def test_sync_dry_run_shows_diff_without_writing(tmp_path, capsys, monkeypatch):
    path = _write_plan(
        tmp_path,
        """
        sessions:
          - date: "2026-08-03"
            sport: running
            title: Nuova
        """,
    )

    class DryRunSync:
        def login(self):
            pass

        def diff_plan(self, sessions, check_content=False):
            from training_plan.garmin_sync import PlanDiff

            return PlanDiff(to_create=list(sessions), already_present=[], extra_on_garmin=[])

        def sync_all(self, sessions):
            raise AssertionError("dry run must not write to Garmin")

        def replace_all(self, changes):
            raise AssertionError("dry run must not write to Garmin")

    monkeypatch.setattr(cli, "GarminSync", lambda *a, **k: DryRunSync())

    assert cli.main(["sync", "--file", str(path), "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert "+ 2026-08-03" in out
    assert "DRY RUN" in out


def test_sync_dry_run_prints_preview_without_calling_garmin(tmp_path, capsys, monkeypatch):
    path = _write_plan(
        tmp_path,
        """
        sessions:
          - date: "2026-08-01"
            sport: running
            title: Easy run
        """,
    )

    def fail_if_called(*args, **kwargs):
        raise AssertionError("GarminSync should not be constructed during an offline dry-run")

    monkeypatch.setattr(cli, "GarminSync", fail_if_called)

    # --dry-run alone now reads the calendar to build a diff; pairing it with
    # --no-diff is the fully offline preview.
    exit_code = cli.main(["sync", "--file", str(path), "--dry-run", "--no-diff"])

    assert exit_code == 0
    out = capsys.readouterr().out
    assert "2026-08-01" in out
    assert "Easy run" in out


def test_sync_invalid_file_reports_errors_and_exits_nonzero(tmp_path, capsys):
    path = _write_plan(
        tmp_path,
        """
        sessions:
          - date: "not-a-date"
            sport: running
            title: Bad
        """,
    )

    exit_code = cli.main(["sync", "--file", str(path)])

    assert exit_code == 1
    err = capsys.readouterr().err
    assert "invalid date" in err


class FakeSync:
    def __init__(self, *args, **kwargs):
        self.logged_in = False

    def login(self):
        self.logged_in = True

    def list_scheduled_workouts(self, start, end):
        return [
            ScheduledWorkout(1, 10, date(2026, 8, 1), "running", "Easy Run"),
            ScheduledWorkout(2, 11, date(2026, 8, 2), "cycling", "Long Ride"),
        ]

    def select_workouts(self, workouts, sport=None, title_match=None):
        selected = workouts
        if sport:
            selected = [w for w in selected if w.sport == sport]
        if title_match:
            selected = [w for w in selected if title_match.lower() in w.title.lower()]
        return selected

    def delete_all(self, workouts):
        return [DeleteResult(workout=w, success=True) for w in workouts]


def test_delete_prompts_for_confirmation_and_aborts_on_decline(monkeypatch, capsys):
    monkeypatch.setattr(cli, "GarminSync", FakeSync)
    monkeypatch.setattr("builtins.input", lambda prompt: "n")

    exit_code = cli.main(["delete", "--from", "2026-08-01", "--to", "2026-08-31"])

    assert exit_code == 0
    out = capsys.readouterr().out
    assert "Aborted" in out


def test_delete_yes_flag_skips_confirmation(monkeypatch, capsys):
    monkeypatch.setattr(cli, "GarminSync", FakeSync)

    def fail_if_prompted(prompt):
        raise AssertionError("should not prompt when --yes is passed")

    monkeypatch.setattr("builtins.input", fail_if_prompted)

    exit_code = cli.main(["delete", "--from", "2026-08-01", "--to", "2026-08-31", "--yes"])

    assert exit_code == 0
    out = capsys.readouterr().out
    assert "2 succeeded" in out


def test_delete_filters_by_sport_and_title(monkeypatch, capsys):
    monkeypatch.setattr(cli, "GarminSync", FakeSync)

    exit_code = cli.main(
        ["delete", "--from", "2026-08-01", "--to", "2026-08-31", "--sport", "running", "--yes"]
    )

    assert exit_code == 0
    out = capsys.readouterr().out
    assert "Easy Run" in out
    assert "Long Ride" not in out
