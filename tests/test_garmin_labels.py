"""Garmin's enum strings, and the rule that none of them ever reach a screen raw."""

import pytest

from training_plan import garmin_labels


def test_the_key_that_started_this_decodes():
    """`MOD_RT_LOW_SS_GOOD` was printed verbatim under the day's readiness score."""
    assert (
        garmin_labels.readiness_feedback("MOD_RT_LOW_SS_GOOD")
        == "Prontezza media: il recupero è quasi completo e il punteggio del sonno è buono."
    )


def test_a_single_factor_needs_no_conjunction():
    assert garmin_labels.readiness_feedback("LOW_SLEEP_POOR") == "Prontezza bassa: il sonno è scarso."


def test_a_bare_level_is_still_a_sentence():
    assert garmin_labels.readiness_feedback("PRIME") == "Prontezza ottima."


def test_multi_word_levels_are_not_split():
    assert garmin_labels.readiness_feedback("VERY_HIGH_RT_LOW").startswith("Prontezza molto alta")


def test_a_low_recovery_time_is_phrased_as_the_good_news_it_is():
    """"il tempo di recupero è basso" is the right sentence and the wrong emphasis."""
    assert "recupero è quasi completo" in garmin_labels.readiness_feedback("HIGH_RT_LOW")


@pytest.mark.parametrize("key", ["WAT_UNKNOWN_X", "MOD_RT_FLUMMOX", "", None, "SS_GOOD"])
def test_anything_unreadable_becomes_nothing_rather_than_an_identifier(key):
    """The whole point. A card with one sentence missing is fine; a card showing
    `MOD_RT_FLUMMOX` is not."""
    assert garmin_labels.readiness_feedback(key) is None


def test_prose_is_handed_back_untouched():
    """Garmin does sometimes return a real sentence, and it must survive."""
    text = "Hai dormito bene stanotte."
    assert garmin_labels.readiness_feedback(text) == text


def test_levels_translate_on_their_own():
    assert garmin_labels.readiness_level_label("MODERATE") == "media"
    assert garmin_labels.readiness_level_label("nonsense") is None
    assert garmin_labels.readiness_level_label(None) is None
