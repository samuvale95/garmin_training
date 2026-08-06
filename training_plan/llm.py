"""The one place in this codebase that talks to a language model.

Nothing else imports a provider SDK or knows a model name. Two roles, configured
separately because they have different requirements:

- **text** -- writes one or two Italian sentences over numbers that have *already* been
  computed. Any decent model does this.
- **vision** -- reads a photo of a plate and returns macros. Needs a vision-capable
  model, which rules out DeepSeek's text-only line entirely.

Both go through OpenRouter's OpenAI-compatible endpoint, so switching between Qwen and
DeepSeek is an env var, and pointing the whole thing at a local Ollama/vLLM server is
the same env var -- which is the door worth keeping open, since the vision role means
photographs of the user's food leaving the machine.

**Every function here returns `None` instead of raising.** No screen may depend on a
model being reachable: the callers have a deterministic sentence to fall back to and a
manual-entry path, and a nutrition screen that errors out because a third-party API
timed out would be worse than one that quietly says less. This is the same rule
`body_insights.py` applies to Garmin's undocumented fields.

The model is never asked for a number that could be computed instead. It phrases
`nutrition.py`'s arithmetic, and it reads a photograph -- a genuinely perceptual task
with no closed-form answer. That boundary is the design.
"""

from __future__ import annotations

import base64
import json
import logging
import os
from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field, ValidationError

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"

# Defaults verified against OpenRouter's live model list. Both are picked for being
# cheap enough that a per-meal call is not worth thinking about:
#
# - text: DeepSeek v3.2, ~$0.27/M in. It writes one sentence; there is nothing to reason
#   about, so a thinking model would only add latency.
# - vision: Qwen3-VL 235B instruct, ~$0.21/M in. A dedicated vision-language model, and
#   the whole reason the vision role exists as a separate setting -- DeepSeek has no
#   vision model at all.
#
# Both move: re-check `https://openrouter.ai/api/v1/models` rather than trusting these.
DEFAULT_TEXT_MODEL = "deepseek/deepseek-v3.2"
DEFAULT_VISION_MODEL = "qwen/qwen3-vl-235b-a22b-instruct"

DEFAULT_TIMEOUT_S = 20.0


def _api_key() -> str | None:
    """The OpenRouter key.

    `OPENRUTER_API_KEY` is the spelling in this project's `.env` -- read first, with the
    correctly-spelled name accepted too so a later fix to the `.env` doesn't silently
    turn the feature off.
    """
    return os.getenv("OPENRUTER_API_KEY") or os.getenv("OPENROUTER_API_KEY") or None


def _base_url() -> str:
    return os.getenv("LLM_BASE_URL", DEFAULT_BASE_URL).rstrip("/")


def _timeout() -> float:
    try:
        return float(os.getenv("LLM_TIMEOUT_S", DEFAULT_TIMEOUT_S))
    except ValueError:
        return DEFAULT_TIMEOUT_S


def photo_upload_enabled() -> bool:
    """Whether a plate photo may be sent to a hosted model.

    On when a key is configured, and switched off with `PASSO_PHOTO_UPLOAD=0`. The
    setting exists because this is the one call in the app that sends a photograph
    taken inside the user's home to a third party -- `config_state()` reports it so the
    UI can say so plainly rather than leaving it buried here.
    """
    raw = os.getenv("PASSO_PHOTO_UPLOAD")
    if raw is not None:
        return raw.strip().lower() not in ("0", "false", "no", "off", "")
    return _api_key() is not None


def config_state() -> dict:
    """What the client needs to decide which states to render -- never the key itself."""
    return {
        "configured": _api_key() is not None,
        "text_model": os.getenv("LLM_TEXT_MODEL", DEFAULT_TEXT_MODEL),
        "vision_model": os.getenv("LLM_VISION_MODEL", DEFAULT_VISION_MODEL),
        "photo_upload_enabled": photo_upload_enabled(),
    }


def _post_chat(model: str, messages: list[dict], *, max_tokens: int, json_object: bool) -> str | None:
    """One chat completion, or `None` for every possible failure.

    Deliberately built on `httpx` (already a dependency) rather than the `openai`
    client: this is one POST with a JSON body, and the SDK would add a dependency, its
    own retry policy and its own timeout semantics on top of a wire format that is
    stable precisely because everyone re-implements it.
    """
    key = _api_key()
    if not key:
        return None

    payload: dict[str, Any] = {"model": model, "messages": messages, "max_tokens": max_tokens}
    if json_object:
        # Best-effort: support varies by model and OpenRouter passes it through. The
        # parser downstream never assumes it worked (see `_parse_json_object`).
        payload["response_format"] = {"type": "json_object"}

    try:
        response = httpx.post(
            f"{_base_url()}/chat/completions",
            headers={
                "Authorization": f"Bearer {key}",
                # OpenRouter attributes traffic with these; harmless anywhere else.
                "HTTP-Referer": "https://passo.local",
                "X-Title": "Passo",
            },
            json=payload,
            timeout=_timeout(),
        )
        response.raise_for_status()
        data = response.json()
    except Exception:  # noqa: BLE001 - an unreachable model degrades, never raises
        logger.warning("LLM call to %s failed, degrading", model, exc_info=True)
        return None

    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        logger.warning("LLM response from %s had no content: %r", model, data)
        return None
    return content.strip() if isinstance(content, str) and content.strip() else None


def _parse_json_object(raw: str) -> dict | None:
    """The model's reply as a dict, tolerating the two things models do to JSON.

    They wrap it in a ```json fence, and they prepend a sentence of commentary. Neither
    is worth a retry on its own, so both are stripped here before the retry ladder in
    `estimate_macros_from_photo` decides anything.
    """
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("```")[1] if "```" in text[3:] else text[3:]
        if text.lstrip().startswith("json"):
            text = text.lstrip()[4:]
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        parsed = json.loads(text[start : end + 1])
    except ValueError:
        return None
    return parsed if isinstance(parsed, dict) else None


# ---- the text role ------------------------------------------------------------------

# The voice guidance, and the hard rules. The two "must not" clauses are the load-bearing
# ones: a model that invents a number breaks the promise that every figure on screen can
# be recomputed by hand, and one that moralises about food breaks the framing the whole
# feature is built on.
FUELLING_SYSTEM_PROMPT = """Sei la voce di Passo, un'app di allenamento per la corsa.

Scrivi UNA frase, al massimo DUE, in italiano, per dire a chi corre come mangiare oggi
in funzione dell'allenamento di domani.

Regole assolute:
- Non inventare numeri. Usa solo quelli che ti vengono dati, e solo se servono.
- Il tema è il RIFORNIMENTO, mai la restrizione: niente calorie da tagliare, niente peso,
  niente giudizi su cosa è stato mangiato, mai la parola "dieta".
- Tono asciutto, concreto, amichevole. Niente entusiasmo, niente esclamativi, niente
  emoji, niente elenchi.
- Parla di cibo vero (pasta, riso, pane, frutta), non di macronutrienti astratti.
- Rispondi solo con la frase, senza virgolette e senza preamboli."""

GOAL_SYSTEM_PROMPT = """Sei la voce di Passo, un'app di allenamento per la corsa.

Scrivi UNA frase, al massimo DUE, in italiano, che spieghi a chi corre come sta andando
verso la sua gara obiettivo.

Regole assolute:
- Non inventare numeri e non contraddire la valutazione che ti viene passata.
- Sii onesto: se i dati dicono che l'obiettivo è ambizioso, dillo senza addolcirlo e
  senza drammatizzarlo.
- Tono asciutto e concreto. Niente esclamativi, niente emoji, niente elenchi.
- Rispondi solo con la frase, senza virgolette e senza preamboli."""


def _write_sentence(system_prompt: str, facts: dict) -> str | None:
    content = _post_chat(
        os.getenv("LLM_TEXT_MODEL", DEFAULT_TEXT_MODEL),
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(facts, ensure_ascii=False)},
        ],
        max_tokens=200,
        json_object=False,
    )
    if content is None:
        return None
    # Models like to wrap a single sentence in quotes despite being told not to.
    return content.strip().strip('"').strip()


def write_fuelling_narrative(facts: dict) -> str | None:
    """The fuelling sentence, or `None` -- the caller falls back to
    `nutrition.templated_advice`, which is written to stand on its own."""
    return _write_sentence(FUELLING_SYSTEM_PROMPT, facts)


def write_goal_narrative(facts: dict) -> str | None:
    """The goal-confidence sentence. Unused until the goal feature lands; here because
    it is the same call with a different system prompt, and keeping it next to its twin
    is what stops the second one from growing its own HTTP client."""
    return _write_sentence(GOAL_SYSTEM_PROMPT, facts)


# ---- the vision role ----------------------------------------------------------------


class MacroEstimate(BaseModel):
    """What the vision model is asked for, and the shape the answer must arrive in.

    `confidence` is the model's own, and it is not decoration: portion size from a
    single photo is genuinely hard, and an estimate the model is unsure of has to *look*
    unsure on screen or the number acquires an authority it has not earned.
    """

    description: str = Field(min_length=1, max_length=200)
    kcal: float = Field(ge=0, le=5000)
    carb_g: float = Field(ge=0, le=1000)
    protein_g: float = Field(ge=0, le=500)
    fat_g: float = Field(ge=0, le=500)
    confidence: Literal["low", "medium", "high"]


VISION_PROMPT = """Guarda questo piatto e stima i macronutrienti della porzione mostrata.

Rispondi SOLO con un oggetto JSON, senza testo intorno e senza blocchi di codice:
{"description": "...", "kcal": 0, "carb_g": 0, "protein_g": 0, "fat_g": 0, "confidence": "low|medium|high"}

- "description": gli alimenti che riconosci, in italiano, minuscolo, max 8 parole.
- i grammi si riferiscono alla porzione nella foto, non a 100 g.
- "confidence": "low" se la porzione è difficile da giudicare (piatto visto di taglio,
  niente riferimenti di scala, ingredienti coperti), "high" solo se è davvero chiara.
- Se nella foto non c'è cibo, usa description "nessun cibo riconosciuto" e valori 0."""


def estimate_macros_from_photo(image_bytes: bytes, mime_type: str = "image/jpeg") -> MacroEstimate | None:
    """Macros for one plate, or `None` when the model is unavailable, disabled, or
    returned something that isn't a valid estimate after one retry.

    The retry exists because JSON-mode support is uneven across providers and a model
    that ignored `response_format` usually complies when told a second time. It is one
    retry, not a ladder: past that the honest move is to show the manual-entry form.
    """
    if not photo_upload_enabled():
        return None

    data_url = f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode('ascii')}"
    messages: list[dict] = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": VISION_PROMPT},
                {"type": "image_url", "image_url": {"url": data_url}},
            ],
        }
    ]
    model = os.getenv("LLM_VISION_MODEL", DEFAULT_VISION_MODEL)

    for attempt in range(2):
        raw = _post_chat(model, messages, max_tokens=400, json_object=True)
        if raw is None:
            return None
        parsed = _parse_json_object(raw)
        if parsed is not None:
            try:
                return MacroEstimate.model_validate(parsed)
            except ValidationError:
                logger.warning("vision model returned an out-of-shape estimate: %r", parsed)
        if attempt == 0:
            messages = messages + [
                {"role": "assistant", "content": raw},
                {
                    "role": "user",
                    "content": (
                        "Non è JSON valido. Rispondi SOLO con l'oggetto JSON richiesto, "
                        "senza testo intorno."
                    ),
                },
            ]
    return None
