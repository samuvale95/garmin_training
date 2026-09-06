"""The adapter's contract is that it never raises and never lets a bad estimate through.

Every test here drives `httpx.post` through a stub: nothing in this suite may reach
OpenRouter, and the failure paths (timeout, 500, malformed JSON, a plausible-looking
object with a negative number in it) are the ones worth pinning down, because they are
what the screens actually have to survive.
"""

from __future__ import annotations

import httpx
import pytest

from training_plan import llm


def _reply(content: str) -> dict:
    return {"choices": [{"message": {"content": content}}]}


class FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("boom", request=None, response=None)

    def json(self):
        return self._payload


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("OPENRUTER_API_KEY", "test-key")
    return monkeypatch


def _capture(monkeypatch, *payloads):
    """Stub `httpx.post`, returning each payload in turn, and record the calls."""
    calls: list[dict] = []
    queue = list(payloads)

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return queue.pop(0) if queue else FakeResponse(_reply("ok"))

    monkeypatch.setattr(httpx, "post", fake_post)
    return calls


# ---- configuration ------------------------------------------------------------------


def test_the_env_spelling_in_this_project_is_the_one_read(monkeypatch):
    monkeypatch.setenv("OPENRUTER_API_KEY", "typo-spelling")
    assert llm.config_state()["configured"] is True


def test_the_correct_spelling_also_works(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "correct-spelling")
    assert llm.config_state()["configured"] is True


def test_config_never_leaks_the_key(monkeypatch):
    monkeypatch.setenv("OPENRUTER_API_KEY", "secret")
    assert "secret" not in str(llm.config_state())


def test_no_key_means_no_narrative_and_no_call(monkeypatch):
    calls = _capture(monkeypatch)
    assert llm.write_fuelling_narrative({"domani_carico": "duro"}) is None
    assert calls == []


def test_no_key_means_no_photo_upload():
    assert llm.photo_upload_enabled() is False


def test_photo_upload_can_be_switched_off_with_a_key_present(configured):
    configured.setenv("PASSO_PHOTO_UPLOAD", "0")
    assert llm.photo_upload_enabled() is False
    assert llm.estimate_macros_from_photo(b"jpeg") is None


# ---- the text role ------------------------------------------------------------------


def test_a_narrative_comes_back_unquoted(configured):
    _capture(configured, FakeResponse(_reply('"Stasera pasta, domani si lavora."')))
    assert llm.write_fuelling_narrative({}) == "Stasera pasta, domani si lavora."


def test_a_timeout_degrades_to_none(configured):
    def fake_post(url, **kwargs):
        raise httpx.ReadTimeout("too slow")

    configured.setattr(httpx, "post", fake_post)
    assert llm.write_fuelling_narrative({}) is None


def test_a_server_error_degrades_to_none(configured):
    _capture(configured, FakeResponse({}, status_code=500))
    assert llm.write_fuelling_narrative({}) is None


def test_a_response_with_no_content_degrades_to_none(configured):
    _capture(configured, FakeResponse({"choices": []}))
    assert llm.write_fuelling_narrative({}) is None


def test_the_text_model_is_configurable(configured):
    configured.setenv("LLM_TEXT_MODEL", "qwen/qwen3-max")
    calls = _capture(configured, FakeResponse(_reply("va bene")))
    llm.write_fuelling_narrative({})
    assert calls[0]["json"]["model"] == "qwen/qwen3-max"


# ---- the vision role ----------------------------------------------------------------


VALID_ESTIMATE = (
    '{"description": "pasta al pomodoro", "kcal": 620, "carb_g": 95, '
    '"protein_g": 20, "fat_g": 15, "confidence": "medium"}'
)


def test_a_valid_estimate_is_parsed(configured):
    _capture(configured, FakeResponse(_reply(VALID_ESTIMATE)))
    estimate = llm.estimate_macros_from_photo(b"jpeg-bytes")
    assert estimate.description == "pasta al pomodoro"
    assert estimate.carb_g == 95
    assert estimate.confidence == "medium"


def test_a_fenced_estimate_is_parsed(configured):
    """Models wrap JSON in a ```json fence whatever the prompt says. Not worth a retry."""
    _capture(configured, FakeResponse(_reply(f"```json\n{VALID_ESTIMATE}\n```")))
    assert llm.estimate_macros_from_photo(b"jpeg-bytes").carb_g == 95


def test_commentary_around_the_object_is_tolerated(configured):
    _capture(configured, FakeResponse(_reply(f"Ecco la stima:\n{VALID_ESTIMATE}\nSpero sia utile.")))
    assert llm.estimate_macros_from_photo(b"jpeg-bytes").kcal == 620


def test_unparseable_output_is_retried_once_then_given_up_on(configured):
    calls = _capture(
        configured,
        FakeResponse(_reply("Direi che sono circa 600 calorie.")),
        FakeResponse(_reply("Non lo so.")),
    )
    assert llm.estimate_macros_from_photo(b"jpeg-bytes") is None
    assert len(calls) == 2


def test_the_retry_can_succeed(configured):
    calls = _capture(
        configured,
        FakeResponse(_reply("Direi che sono circa 600 calorie.")),
        FakeResponse(_reply(VALID_ESTIMATE)),
    )
    assert llm.estimate_macros_from_photo(b"jpeg-bytes").carb_g == 95
    assert len(calls) == 2
    # The retry carries the conversation, so the model can see what it got wrong.
    assert len(calls[1]["json"]["messages"]) == 3


def test_an_out_of_range_estimate_is_rejected(configured):
    """A model that answers with negative grams or an invented confidence level is
    returning nonsense; better the manual form than a plausible-looking wrong number."""
    bad = VALID_ESTIMATE.replace('"carb_g": 95', '"carb_g": -10')
    _capture(configured, FakeResponse(_reply(bad)), FakeResponse(_reply(bad)))
    assert llm.estimate_macros_from_photo(b"jpeg-bytes") is None


def test_the_image_is_sent_as_a_data_url(configured):
    calls = _capture(configured, FakeResponse(_reply(VALID_ESTIMATE)))
    llm.estimate_macros_from_photo(b"jpeg-bytes", "image/png")
    content = calls[0]["json"]["messages"][0]["content"]
    assert content[1]["image_url"]["url"].startswith("data:image/png;base64,")


def test_the_vision_model_is_configurable(configured):
    configured.setenv("LLM_VISION_MODEL", "qwen/qwen3-vl-30b-a3b-instruct")
    calls = _capture(configured, FakeResponse(_reply(VALID_ESTIMATE)))
    llm.estimate_macros_from_photo(b"jpeg-bytes")
    assert calls[0]["json"]["model"] == "qwen/qwen3-vl-30b-a3b-instruct"


def test_the_base_url_is_configurable(configured):
    """The whole reason the adapter exists: pointing it at a local vision model is a
    config change, not a rewrite -- and food photos then never leave the machine."""
    configured.setenv("LLM_BASE_URL", "http://localhost:11434/v1")
    calls = _capture(configured, FakeResponse(_reply(VALID_ESTIMATE)))
    llm.estimate_macros_from_photo(b"jpeg-bytes")
    assert calls[0]["url"] == "http://localhost:11434/v1/chat/completions"


# ---- the typed-description role -----------------------------------------------------


def test_a_typed_meal_is_estimated_by_the_text_model(configured):
    """The description path is the vision path minus the photograph: same shape out,
    same retry ladder -- but billed to the cheap text model, since there is no image."""
    calls = _capture(configured, FakeResponse(_reply(VALID_ESTIMATE)))
    estimate = llm.estimate_macros_from_text("80 g di pasta al pomodoro")

    assert estimate.carb_g == 95
    assert calls[0]["json"]["model"] == llm.DEFAULT_TEXT_MODEL
    # The user's own words reach the model verbatim; nothing summarises them first.
    assert calls[0]["json"]["messages"][-1]["content"] == "80 g di pasta al pomodoro"


def test_an_empty_description_is_not_sent_anywhere(configured):
    calls = _capture(configured, FakeResponse(_reply(VALID_ESTIMATE)))
    assert llm.estimate_macros_from_text("   ") is None
    assert calls == []


def test_no_key_means_no_typed_estimate(monkeypatch):
    calls = _capture(monkeypatch)
    assert llm.estimate_macros_from_text("due uova") is None
    assert calls == []


def test_the_photo_switch_does_not_disable_the_typed_path(configured):
    """`PASSO_PHOTO_UPLOAD=0` is about photographs leaving the house, not sentences."""
    configured.setenv("PASSO_PHOTO_UPLOAD", "0")
    _capture(configured, FakeResponse(_reply(VALID_ESTIMATE)))

    assert llm.estimate_macros_from_photo(b"jpeg-bytes") is None
    assert llm.estimate_macros_from_text("due uova").carb_g == 95


def test_a_malformed_typed_estimate_is_retried_once(configured):
    calls = _capture(
        configured,
        FakeResponse(_reply("certo! ecco:")),
        FakeResponse(_reply(VALID_ESTIMATE)),
    )
    assert llm.estimate_macros_from_text("due uova").carb_g == 95
    assert len(calls) == 2
