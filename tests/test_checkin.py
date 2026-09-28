"""The 10-second check-in: validation, and what the day's verdict reads from it."""

from datetime import date, timedelta

import pytest

from training_plan import checkin, readiness
from training_plan.checkin import CheckIn, InvalidCheckIn

TODAY = date(2026, 9, 28)
YESTERDAY = TODAY - timedelta(days=1)


def test_pain_needs_an_area_and_an_area_needs_pain():
    CheckIn(TODAY, "dolore", "dura", "ginocchio").validate(TODAY)
    with pytest.raises(InvalidCheckIn):
        CheckIn(TODAY, "dolore", "dura").validate(TODAY)
    with pytest.raises(InvalidCheckIn):
        CheckIn(TODAY, "bene", "facile", "ginocchio").validate(TODAY)


def test_tomorrow_cannot_be_answered():
    with pytest.raises(InvalidCheckIn):
        CheckIn(TODAY + timedelta(days=1), "bene").validate(TODAY)


def test_a_rest_day_has_no_effort():
    CheckIn(TODAY, "stanco").validate(TODAY)


def test_pain_is_a_strong_signal_that_names_the_area_and_the_day():
    [signal] = checkin.signals([CheckIn(YESTERDAY, "dolore", "giusta", "ginocchio")], TODAY)
    assert signal.severity == readiness.SEVERITY_STRONG
    assert signal.detail == "Dolore al ginocchio segnalato ieri"


def test_too_hard_and_tired_are_moderate():
    signals = checkin.signals([CheckIn(TODAY, "stanco", "troppo")], TODAY)
    assert {s.key for s in signals} == {"checkin_too_hard", "checkin_tired"}
    assert {s.severity for s in signals} == {readiness.SEVERITY_MODERATE}


def test_older_answers_do_not_count():
    assert checkin.signals([CheckIn(TODAY - timedelta(days=2), "dolore", None, "piede")], TODAY) == []


def test_knee_pain_yesterday_makes_a_hard_day_cautious():
    from tests.test_readiness import REPEATS, _snapshot

    reported = checkin.signals([CheckIn(YESTERDAY, "dolore", "giusta", "ginocchio")], TODAY)
    verdict = readiness.assess_day(_snapshot(), REPEATS, today=TODAY, reported=reported)
    assert verdict.state in (readiness.STATE_CAUTIOUS, readiness.STATE_DEPLETED)
    assert verdict.signals[0].detail == "Dolore al ginocchio segnalato ieri"


def test_pain_counts_even_without_a_night_of_data():
    from tests.test_readiness import REPEATS, _snapshot

    reported = checkin.signals([CheckIn(TODAY, "dolore", None, "caviglia")], TODAY)
    verdict = readiness.assess_day(_snapshot(has_overnight_data=False), REPEATS, today=TODAY, reported=reported)
    assert verdict.state == readiness.STATE_CAUTIOUS
