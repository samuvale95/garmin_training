"""Intensity distribution: what the session was for, against what it became."""

from datetime import date

import pytest

from training_plan import intensity


def _zones(threshold=170):
    return intensity.Zones.from_threshold(threshold)


def _stream(*segments):
    """A heart-rate stream from (bpm, seconds) pairs, sampled once a second."""
    heart_rates: list[float] = []
    for bpm, seconds in segments:
        heart_rates.extend([bpm] * seconds)
    return heart_rates, list(range(len(heart_rates)))


# ---- zones ---------------------------------------------------------------------------


def test_zones_come_off_the_threshold_not_off_an_age():
    z = _zones(170)
    assert z.threshold_hr == 170
    assert z.aerobic_hr == 144  # 85% of 170, truncated
    assert z.zone_of(140) == intensity.ZONE_EASY
    assert z.zone_of(155) == intensity.ZONE_GREY
    assert z.zone_of(178) == intensity.ZONE_HARD


def test_the_boundaries_are_inclusive_downwards():
    """A sample sitting exactly on a boundary belongs to the easier zone -- the boundary
    itself is an approximation, and rounding a borderline sample up would inflate the
    thing this module exists to detect."""
    z = _zones(170)
    assert z.zone_of(144) == intensity.ZONE_EASY
    assert z.zone_of(170) == intensity.ZONE_GREY


# ---- time in zone ----------------------------------------------------------------------


def test_time_in_zone_counts_seconds_not_samples():
    heart_rates, times = _stream((130, 1800), (160, 600), (180, 300))
    in_zone = intensity.time_in_zone(heart_rates, times, _zones())
    assert in_zone.easy_seconds == 1800
    assert in_zone.grey_seconds == 600
    assert in_zone.hard_seconds == 300
    assert in_zone.total_seconds == 2700


def test_an_unevenly_sampled_stream_weights_by_the_gap():
    """Strava records at 'smart' intervals that stretch when nothing changes. Counting
    each sample as one second under-weights the steady parts of a run -- which are
    exactly the parts this analysis is about."""
    heart_rates = [130, 130, 175]
    times = [0, 600, 1200]  # ten minutes easy, then ten hard
    in_zone = intensity.time_in_zone(heart_rates, times, _zones())
    assert in_zone.easy_seconds == 1200
    assert in_zone.hard_seconds == 1  # the last sample, with no gap after it


def test_a_dropout_contributes_no_time_rather_than_a_guess():
    heart_rates = [130] * 600 + [None] * 300 + [130] * 600
    times = list(range(1500))
    in_zone = intensity.time_in_zone(heart_rates, times, _zones())
    assert in_zone.total_seconds == 1200
    assert in_zone.grey_seconds == 0


def test_an_empty_stream_is_an_empty_distribution():
    assert intensity.time_in_zone([], None, _zones()).total_seconds == 0


def test_shares_add_up():
    heart_rates, times = _stream((130, 1600), (160, 200), (180, 200))
    in_zone = intensity.time_in_zone(heart_rates, times, _zones())
    total = sum(in_zone.share(z) for z in (intensity.ZONE_EASY, intensity.ZONE_GREY, intensity.ZONE_HARD))
    assert total == pytest.approx(1.0)


# ---- one session -----------------------------------------------------------------------


def _execution(intent, segments, activity_id=1, day=None):
    heart_rates, times = _stream(*segments)
    return intensity.read_execution(
        activity_id=activity_id,
        day=day or date(2026, 9, 1),
        title="Fondo",
        intent=intent,
        heart_rates=heart_rates,
        times=times,
        zones=_zones(),
    )


def test_an_easy_run_actually_run_easy_is_honoured():
    execution = _execution("facile", [(135, 3600)])
    assert execution.honoured is True
    assert "facile davvero" in execution.detail


def test_the_mistake_this_module_exists_for():
    """Forty percent of an 'easy' hour spent above the aerobic threshold. Every single
    kilometre felt reasonable; the distribution is what says otherwise."""
    execution = _execution("facile", [(135, 2160), (158, 1440)])
    assert execution.honoured is False
    assert "doveva essere facile" in execution.detail
    assert "144 bpm" in execution.detail


def test_a_little_drift_does_not_fail_an_easy_run():
    """Hills, heat, the last kilometre home -- and heart rate lags effort either way."""
    execution = _execution("facile", [(135, 3300), (152, 300)])
    assert execution.honoured is True


def test_a_quality_session_above_threshold_is_not_a_discrepancy():
    """It is the session working. Flagging it would bury the finding that matters under
    six that do not."""
    execution = _execution("duro", [(135, 1200), (178, 1800), (140, 600)])
    assert execution.honoured is None
    assert "sopra soglia" in execution.detail


def test_a_stream_too_short_to_distribute_is_not_analysed():
    assert _execution("facile", [(135, 300)]) is None


# ---- the block -------------------------------------------------------------------------


def test_a_polarized_block_is_told_it_is_fine():
    executions = [
        _execution("facile", [(135, 3600)], activity_id=i, day=date(2026, 9, i)) for i in range(1, 9)
    ]
    executions.append(_execution("duro", [(178, 2400)], activity_id=9, day=date(2026, 9, 9)))
    block = intensity.read_block(executions)
    assert block.easy_share > intensity.POLARIZED_EASY_SHARE
    assert {f.key for f in block.findings} == {"distribuzione"}
    assert block.findings[0].headline == "La distribuzione è dove dovrebbe stare"


def test_easy_days_run_hard_are_the_headline_finding():
    executions = [
        _execution("facile", [(135, 1800), (158, 1800)], activity_id=i, day=date(2026, 9, i))
        for i in range(1, 7)
    ]
    block = intensity.read_block(executions)
    assert block.easy_planned == 6
    assert block.easy_honoured == 0
    finding = next(f for f in block.findings if f.key == "facili_non_facili")
    assert finding.headline == "I tuoi lenti non sono lenti"
    assert finding.severity == "attenzione"
    assert finding.action


def test_living_in_the_grey_zone_is_named():
    executions = [
        _execution("facile", [(158, 3600)], activity_id=i, day=date(2026, 9, i)) for i in range(1, 6)
    ]
    block = intensity.read_block(executions)
    assert block.grey_share > intensity.GREY_ZONE_WARNING_SHARE
    assert any(f.key == "zona_grigia" for f in block.findings)


def test_the_block_is_measured_in_time_not_in_sessions():
    """Eight easy half-hours and two hard hours are not an 80/20 split, and counting
    sessions instead of minutes is how the polarized rule gets misquoted."""
    executions = [
        _execution("facile", [(135, 1800)], activity_id=i, day=date(2026, 9, i)) for i in range(1, 9)
    ]
    executions += [
        _execution("duro", [(178, 3600)], activity_id=i, day=date(2026, 9, i)) for i in range(9, 11)
    ]
    block = intensity.read_block(executions)
    # 8 * 30 min easy = 240; 2 * 60 min hard = 120. By session count that is 80/20; by
    # time it is 67/33, and the time figure is the one that means anything.
    assert block.easy_share == pytest.approx(240 / 360, abs=0.01)
    distribution = next(f for f in block.findings if f.key == "distribuzione")
    assert distribution.headline == "Troppo poco tempo in facile"


def test_every_finding_declares_how_strong_its_evidence_is():
    """A measurement, a population finding and a personal correlation must not be
    presented in the same voice."""
    executions = [
        _execution("facile", [(135, 1800), (158, 1800)], activity_id=i, day=date(2026, 9, i))
        for i in range(1, 7)
    ]
    for finding in intensity.read_block(executions).findings:
        assert finding.evidence in (
            intensity.EVIDENCE_RESEARCH,
            intensity.EVIDENCE_YOURS,
            intensity.EVIDENCE_MEASURED,
        )
        assert finding.measured


def test_no_sessions_is_no_block():
    assert intensity.read_block([]) is None
