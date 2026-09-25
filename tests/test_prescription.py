"""Diagnosis into sessions: the numbers, the ranking, and what it refuses to do."""

from datetime import date

import pytest

from training_plan import intensity, paces, prescription
from training_plan.models import RepeatBlock, Step


def _block(easy, grey, hard, sessions=40):
    """A distribution with the given shares, over an hour of running per session."""
    total = sessions * 3600
    return intensity.BlockDistribution(
        sessions=sessions,
        from_date=date(2026, 1, 1),
        to_date=date(2026, 9, 1),
        zones=intensity.TimeInZone(round(total * easy), round(total * grey), round(total * hard)),
        easy_share=easy,
        grey_share=grey,
        hard_share=hard,
        easy_planned=sessions,
        easy_honoured=round(sessions * easy),
        findings=[],
    )


def _profile(easy_sec=355, threshold_sec=298):
    return paces.PaceProfile(
        easy=paces.PaceEstimate(155, easy_sec, 70000, easy_sec - 20, easy_sec + 20),
        threshold=paces.PaceEstimate(183, threshold_sec, 15000, threshold_sec - 20, threshold_sec + 20),
    )


ZONES = intensity.Zones.from_threshold(183)
TODAY = date(2026, 9, 16)


def _titles(items):
    return [p.key for p in items]


# ---- the ranking is the opinion -------------------------------------------------------


def test_the_grey_zone_is_told_to_slow_down_before_anything_else():
    """Adding quality on top of a grey-zone week is how a runner ends up doing three hard
    days and calling one of them easy."""
    out = prescription.prescribe(_block(0.54, 0.43, 0.03), ZONES, _profile(), today=TODAY)
    assert out[0].key == "rallenta"
    assert out[0].priority == 0
    assert out[0].heart_rate_cap == ZONES.aerobic_hr


def test_a_history_with_no_quality_gets_a_threshold_session():
    out = prescription.prescribe(_block(0.54, 0.43, 0.03), ZONES, _profile(), today=TODAY)
    assert "soglia" in _titles(out)


def test_a_polarized_athlete_is_told_nothing():
    """The screen has to be able to say "niente da cambiare". An app that always finds
    something to fix is an app nobody believes twice."""
    assert prescription.prescribe(_block(0.82, 0.14, 0.04), ZONES, _profile(), today=TODAY) == []


def test_enough_hard_work_but_a_flat_distribution_gets_the_separation_advice():
    out = prescription.prescribe(_block(0.62, 0.28, 0.10), ZONES, _profile(), today=TODAY)
    assert "brevi" in _titles(out)
    assert "soglia" not in _titles(out)


# ---- the sessions themselves ----------------------------------------------------------


def test_an_easy_prescription_is_slower_than_what_they_actually_run():
    """The measured median is what they run at their aerobic heart rate, and the whole
    finding is that it is too fast -- prescribing it back unchanged would prescribe the
    problem."""
    profile = _profile(easy_sec=355)
    session = prescription.easy_run(TODAY, profile, ZONES)
    step = session.steps[0]
    assert isinstance(step, Step)
    assert step.target_pace.faster_sec_per_km > 355


def test_the_heart_rate_ceiling_reaches_the_athlete_even_though_the_model_has_no_field_for_it():
    session = prescription.easy_run(TODAY, _profile(), ZONES)
    assert str(ZONES.aerobic_hr) in session.description


def test_threshold_repeats_are_built_as_a_real_repeat_block():
    """A repeat block is what makes the watch show "Ripetuta 3/5" instead of five
    indistinguishable steps."""
    session = prescription.cruise_intervals(TODAY, _profile())
    blocks = [s for s in session.steps if isinstance(s, RepeatBlock)]
    assert len(blocks) == 1
    assert blocks[0].reps == 5
    assert blocks[0].steps[0].target_pace is not None


def test_the_short_repeats_are_faster_than_the_threshold_ones():
    profile = _profile()
    cruise = next(s for s in prescription.cruise_intervals(TODAY, profile).steps if isinstance(s, RepeatBlock))
    short = next(s for s in prescription.vo2_intervals(TODAY, profile).steps if isinstance(s, RepeatBlock))
    assert short.steps[0].target_pace.faster_sec_per_km < cruise.steps[0].target_pace.faster_sec_per_km


def test_a_session_is_prescribed_in_the_future():
    out = prescription.prescribe(_block(0.54, 0.43, 0.03), ZONES, _profile(), today=TODAY)
    assert all(p.session.date > TODAY for p in out)


def test_quality_sessions_need_a_measured_threshold_pace():
    """No measured pace, no invented one: a session written against a number nobody
    measured is exactly what this module exists not to produce."""
    thin = paces.PaceProfile(easy=_profile().easy, threshold=None)
    assert prescription.cruise_intervals(TODAY, thin) is None
    assert prescription.vo2_intervals(TODAY, thin) is None
    out = prescription.prescribe(_block(0.54, 0.43, 0.03), ZONES, thin, today=TODAY)
    assert _titles(out) == ["rallenta"]


def test_an_easy_run_still_works_without_any_measured_pace():
    """The heart-rate ceiling is the instruction that matters; the pace is context."""
    empty = paces.PaceProfile(easy=None, threshold=None)
    session = prescription.easy_run(TODAY, empty, ZONES)
    assert session.steps[0].target_pace is None
    assert str(ZONES.aerobic_hr) in session.description


# ---- every prescription explains itself ---------------------------------------------------


def test_each_prescription_carries_its_measurement_and_its_evidence_level():
    for item in prescription.prescribe(_block(0.54, 0.43, 0.03), ZONES, _profile(), today=TODAY):
        assert item.rationale and item.expected
        assert item.evidence in (prescription.EVIDENCE_RESEARCH, prescription.EVIDENCE_MEASURED)
        assert "%" in item.rationale


@pytest.mark.parametrize("shares", [(0.54, 0.43, 0.03), (0.62, 0.28, 0.10), (0.82, 0.14, 0.04)])
def test_the_prescriptions_never_outnumber_what_a_person_can_act_on(shares):
    out = prescription.prescribe(_block(*shares), ZONES, _profile(), today=TODAY)
    assert len(out) <= 2


# ---- reading a year of history without holding it ----------------------------------------


def test_filtering_samples_near_the_thresholds_does_not_change_the_profile():
    """The route keeps only the samples a profile can use; the paces must come out the same."""
    streams = {
        "heartrate": [140 + (i % 50) for i in range(40000)],
        "velocity_smooth": [2.4 + (i % 7) * 0.1 for i in range(40000)],
    }
    full = paces.build_profile(paces.samples_from_streams(streams), aerobic_hr=155, threshold_hr=183)
    near = paces.build_profile(
        paces.samples_from_streams(streams, near=(155, 183)), aerobic_hr=155, threshold_hr=183
    )
    assert full == near
    assert full.easy is not None and full.threshold is not None


@pytest.mark.parametrize("values", [[3.0], [3.0, 1.0], [2.0, 5.0, 1.0, 4.0]])
def test_median_of_a_sorted_list_matches_statistics(values):
    from statistics import median

    assert paces._median(sorted(values)) == median(values)


def test_a_history_without_a_plan_is_not_judged_against_one():
    """Every run read with no intent: an interval session is not a failed easy day."""
    hard = intensity.read_execution(
        activity_id=1,
        day=date(2026, 9, 1),
        title="Ripetute",
        intent=intensity.NO_INTENT,
        heart_rates=[185] * 3600,
        times=list(range(3600)),
        zones=ZONES,
    )
    block = intensity.read_block([hard])
    assert block.easy_planned == 0
    assert "facili_non_facili" not in [f.key for f in block.findings]
