"""One workout recorded by the watch and uploaded to Strava is one workout."""

from datetime import date, datetime, timedelta, timezone

from training_plan import intensity
from training_plan.history import match_duplicates, sport_family

T0 = datetime(2026, 9, 24, 17, 26, 47, tzinfo=timezone.utc)


def _garmin(activity_id, start=T0, minutes=41.0, sport="running"):
    return {"activity_id": activity_id, "sport": sport, "start_time": start, "duration_min": minutes}


def _strava(activity_id, start=T0, minutes=41.0, sport="Run", external_id=None):
    return {
        "activity_id": activity_id,
        "sport": sport,
        "start_time": start,
        "duration_min": minutes,
        "external_id": external_id,
    }


def test_garmin_upload_is_matched_by_external_id_whatever_the_times_say():
    out = match_duplicates([_garmin(111)], [_strava(9, start=T0 + timedelta(hours=3), external_id="garmin_ping_111")])
    assert out == {9: 111}


def test_push_uploads_are_recognised_too():
    assert match_duplicates([_garmin(111)], [_strava(9, external_id="garmin_push_111")]) == {9: 111}


def test_match_by_start_and_duration_when_there_is_no_external_id():
    out = match_duplicates([_garmin(111)], [_strava(9, start=T0 + timedelta(seconds=40), minutes=39.5)])
    assert out == {9: 111}


def test_two_workouts_on_the_same_day_stay_two():
    evening = T0 + timedelta(hours=9)
    out = match_duplicates([_garmin(111)], [_strava(9, start=evening)])
    assert out == {9: None}


def test_an_activity_only_on_strava_is_its_own_workout():
    assert match_duplicates([], [_strava(9)]) == {9: None}


def test_a_run_and_a_ride_at_the_same_time_are_never_merged():
    out = match_duplicates([_garmin(111, sport="road_biking")], [_strava(9, sport="Run")])
    assert out == {9: None}


def test_durations_that_disagree_are_different_workouts():
    out = match_duplicates([_garmin(111, minutes=60)], [_strava(9, minutes=30)])
    assert out == {9: None}


def test_the_closest_start_wins_among_several_candidates():
    garmin = [_garmin(111, start=T0 + timedelta(seconds=100)), _garmin(222, start=T0 + timedelta(seconds=10))]
    assert match_duplicates(garmin, [_strava(9)]) == {9: 222}


def test_an_external_id_for_an_activity_we_do_not_have_falls_back_on_times():
    out = match_duplicates([_garmin(111)], [_strava(9, external_id="garmin_ping_999")])
    assert out == {9: 111}


def test_sport_families_span_both_vocabularies():
    assert sport_family("TrailRun") == sport_family("trail_running") == "run"
    assert sport_family("Tennis") == sport_family("tennis")
    assert sport_family("Tennis") != sport_family("Hike")


def test_a_garmin_trail_run_counts_as_running():
    heart_rates = [150] * 1800
    execution = intensity.read_execution(
        activity_id=1,
        day=date(2026, 9, 24),
        title="Trail",
        intent=intensity.NO_INTENT,
        sport="trail_running",
        heart_rates=heart_rates,
        times=list(range(1800)),
        zones=intensity.Zones.from_threshold(183),
    )
    assert intensity.read_block([execution]).sessions == 1
