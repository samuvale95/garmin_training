from __future__ import annotations

import argparse
import sys
from datetime import date, datetime

from dotenv import load_dotenv

from .garmin_sync import GarminRateLimitError, GarminSync, GarminSyncError
from .models import Step, TrainingSession
from .parser import TrainingPlanValidationError, parse_training_plan


def _format_pace(seconds_per_km: int) -> str:
    return f"{seconds_per_km // 60}:{seconds_per_km % 60:02d}"


def _step_summary(steps: list[Step]) -> str:
    if not steps:
        return "no structured steps"

    parts = []
    for step in steps:
        unit = "min" if step.duration_type == "time" else "km"
        part = f"{step.type} {step.duration_value}{unit}"
        if step.target_pace:
            slower = _format_pace(step.target_pace.slower_sec_per_km)
            faster = _format_pace(step.target_pace.faster_sec_per_km)
            part += f" @ {faster}-{slower}/km"
        parts.append(part)
    return ", ".join(parts)


def _print_dry_run(sessions: list[TrainingSession]) -> None:
    for session in sessions:
        print(f"[DRY RUN] {session.date} | {session.sport} | {session.title} | {_step_summary(session.steps)}")


def _prompt_mfa() -> str:
    return input("Garmin MFA code: ").strip()


def _authenticate() -> GarminSync:
    """Log in, raising GarminSyncError (or GarminRateLimitError) on failure."""
    sync = GarminSync(prompt_mfa=_prompt_mfa)
    sync.login()
    return sync


def _login(args: argparse.Namespace) -> int:
    """Verify credentials on their own, so auth problems don't surface mid-import."""
    try:
        _authenticate()
    except GarminSyncError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    print("Login OK - session token cached, later runs will not need to log in again.")
    return 0


def _print_diff(diff) -> None:
    summary = f"Plan vs calendar: {len(diff.to_create)} to add, {len(diff.already_present)} already scheduled"
    if diff.content_checked:
        summary += f", {len(diff.changed)} changed"
    print(summary + ".")

    if diff.changed:
        print(f"\nContents changed since they were imported: {len(diff.changed)}")
        for change in diff.changed:
            print(f"  ~ {change.session.date} | {change.session.title}")
            print(f"      file: {change.local_hash}  |  Garmin: {change.remote_hash}")
            print(f"      {_step_summary(change.session.steps)}")

    # Compared by identity: TrainingSession holds a list, so it is not hashable.
    changed_ids = {id(change.session) for change in diff.changed}
    unchanged = [s for s in diff.already_present if id(s) not in changed_ids]
    if unchanged:
        label = "Already on the calendar, unchanged" if diff.content_checked else "Already on the calendar (skipped)"
        print(f"\n{label}: {len(unchanged)}")
        for session in unchanged:
            print(f"  = {session.date} | {session.title}")

    if diff.extra_on_garmin:
        print(f"\nOn the calendar but NOT in this file: {len(diff.extra_on_garmin)}")
        for workout in diff.extra_on_garmin:
            print(f"  ? {workout.date} | {workout.title}")
        print("  (left untouched - remove them with the 'delete' command if you want them gone)")

    if diff.to_create:
        print(f"\nTo be added: {len(diff.to_create)}")
        for session in diff.to_create:
            print(f"  + {session.date} | {session.sport} | {session.title} | {_step_summary(session.steps)}")


def _sync(args: argparse.Namespace) -> int:
    try:
        sessions = parse_training_plan(args.file)
    except TrainingPlanValidationError as exc:
        print("Training plan file is invalid:", file=sys.stderr)
        for error in exc.errors:
            print(f"  - {error}", file=sys.stderr)
        return 1

    if not sessions:
        print("No sessions found in file.")
        return 0

    # Without a calendar to compare against, a dry run can only preview the file itself.
    if args.dry_run and args.no_diff:
        _print_dry_run(sessions)
        return 0

    try:
        sync = _authenticate()
    except GarminSyncError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    changed = []
    if args.no_diff:
        to_create = sessions
    else:
        check_content = args.deep or args.update
        if check_content:
            print("Comparing session contents (one extra read per scheduled session)...")
        try:
            diff = sync.diff_plan(sessions, check_content=check_content)
        except GarminSyncError as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 1

        _print_diff(diff)
        to_create = diff.to_create
        changed = diff.changed if args.update else []

        if diff.changed and not args.update:
            print("\nRe-run with --update to rewrite the changed session(s) on Garmin.")

        if not to_create and not changed:
            print("\nNothing to do - the calendar already matches this file.")
            return 0

    if args.dry_run:
        print("\n[DRY RUN] nothing was written to Garmin Connect.")
        return 0

    if changed and not args.yes:
        print(f"\n{len(changed)} session(s) will be DELETED and recreated from the file.")
        if input("Proceed? [y/N] ").strip().lower() != "y":
            print("Aborted. Nothing was changed.")
            return 0

    print()
    results = sync.replace_all(changed) + sync.sync_all(to_create)

    succeeded = 0
    for result in results:
        session = result.session
        if result.success:
            succeeded += 1
            print(f"OK   {session.date} | {session.sport} | {session.title}")
        else:
            print(f"FAIL {session.date} | {session.sport} | {session.title} | {result.error}", file=sys.stderr)

    failed = len(results) - succeeded
    print(f"\n{succeeded} succeeded, {failed} failed")
    return 1 if failed else 0


def _parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def _list(args: argparse.Namespace) -> int:
    try:
        sync = _authenticate()
    except GarminSyncError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    try:
        workouts = sync.list_scheduled_workouts(_parse_date(args.frm), _parse_date(args.to))
    except GarminSyncError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    if not workouts:
        print("No scheduled workouts found in that range.")
        return 0

    for workout in workouts:
        print(f"{workout.date} | {workout.sport} | {workout.title} | id={workout.scheduled_workout_id}")
    return 0


def _delete(args: argparse.Namespace) -> int:
    try:
        sync = _authenticate()
    except GarminSyncError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    try:
        workouts = sync.list_scheduled_workouts(_parse_date(args.frm), _parse_date(args.to))
    except GarminSyncError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    selected = sync.select_workouts(workouts, sport=args.sport, title_match=args.title_match)

    if not selected:
        print("No workouts match the given filters. Nothing to delete.")
        return 0

    print(f"The following {len(selected)} workout(s) will be deleted:")
    for workout in selected:
        print(f"  {workout.date} | {workout.sport} | {workout.title}")

    if not args.yes:
        answer = input("Proceed with deletion? [y/N] ").strip().lower()
        if answer != "y":
            print("Aborted. Nothing was deleted.")
            return 0

    results = sync.delete_all(selected)

    succeeded = 0
    for result in results:
        workout = result.workout
        if result.success:
            succeeded += 1
            print(f"OK   deleted {workout.date} | {workout.sport} | {workout.title}")
        else:
            print(
                f"FAIL {workout.date} | {workout.sport} | {workout.title} | {result.error}",
                file=sys.stderr,
            )

    failed = len(results) - succeeded
    print(f"\n{succeeded} succeeded, {failed} failed")
    return 1 if failed else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="import_training_plan", description="Import a training plan into Garmin Connect")
    subparsers = parser.add_subparsers(dest="command", required=True)

    login_parser = subparsers.add_parser(
        "login", help="Verify credentials and cache a session token (cheapest way to test auth)"
    )
    login_parser.set_defaults(func=_login)

    sync_parser = subparsers.add_parser("sync", help="Create and schedule workouts from a training plan file")
    sync_parser.add_argument("--file", required=True, help="Path to the training-plan YAML file")
    sync_parser.add_argument("--dry-run", action="store_true", help="Preview without writing to Garmin Connect")
    sync_parser.add_argument(
        "--no-diff",
        action="store_true",
        help="Import every session in the file, even ones already on the calendar (may duplicate)",
    )
    sync_parser.add_argument(
        "--deep",
        action="store_true",
        help="Also compare session contents, to spot edits that kept the same date and title "
        "(costs one extra read per scheduled session)",
    )
    sync_parser.add_argument(
        "--update",
        action="store_true",
        help="Implies --deep: delete and recreate the sessions whose contents changed",
    )
    sync_parser.add_argument("--yes", action="store_true", help="Skip the confirmation prompt for --update")
    sync_parser.set_defaults(func=_sync)

    list_parser = subparsers.add_parser("list", help="List existing Garmin Connect calendar workouts")
    list_parser.add_argument("--from", dest="frm", required=True, help="Start date (YYYY-MM-DD)")
    list_parser.add_argument("--to", required=True, help="End date (YYYY-MM-DD)")
    list_parser.set_defaults(func=_list)

    delete_parser = subparsers.add_parser("delete", help="Delete a selected subset of existing calendar workouts")
    delete_parser.add_argument("--from", dest="frm", required=True, help="Start date (YYYY-MM-DD)")
    delete_parser.add_argument("--to", required=True, help="End date (YYYY-MM-DD)")
    delete_parser.add_argument("--sport", help="Only select workouts of this sport")
    delete_parser.add_argument("--title-match", help="Only select workouts whose title contains this text (case-insensitive)")
    delete_parser.add_argument("--yes", action="store_true", help="Skip the interactive confirmation prompt")
    delete_parser.set_defaults(func=_delete)

    return parser


def main(argv: list[str] | None = None) -> int:
    load_dotenv()
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
