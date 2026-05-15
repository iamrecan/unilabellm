from __future__ import annotations

import json
import logging
import time

import openai

from core.config import settings
from core.llm.prompts import SYSTEM_PROMPT, build_user_prompt

logger = logging.getLogger(__name__)

_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


class LLMAnalysisResult:
    def __init__(self, raw: dict) -> None:
        self.raw = raw
        self.canonical_classes: list[dict] = raw.get("canonical_classes", [])
        self.unmapped: list[str] = raw.get("unmapped", [])

    def to_mapping(self) -> dict[str, list[str]]:
        """Return {canonical_name: [aliases]} dict."""
        return {c["name"]: c["aliases"] for c in self.canonical_classes}

    def to_confidence_map(self) -> dict[str, float]:
        """Return {canonical_name: confidence} dict."""
        return {c["name"]: c.get("confidence", 1.0) for c in self.canonical_classes}


class SemanticAnalyzer:
    def __init__(self, api_key: str | None = None) -> None:
        # Explicit empty string means "no key" — don't fall back to settings
        key = api_key if api_key is not None else settings.openrouter_api_key
        if not key:
            raise ValueError(
                "OPENROUTER_API_KEY is not set. Add it to .env or set the environment variable."
            )
        self._client = openai.OpenAI(
            api_key=key,
            base_url=_OPENROUTER_BASE_URL,
        )

    def analyze(
        self,
        dataset_classes: dict[str, list[str]],
        domain_hint: str | None = None,
    ) -> LLMAnalysisResult:
        """Analyze class labels from multiple datasets and return semantic groups."""
        if not dataset_classes:
            raise ValueError("dataset_classes cannot be empty")

        user_prompt = build_user_prompt(dataset_classes, domain_hint)
        last_error: Exception | None = None

        for attempt in range(1, settings.llm_max_retries + 1):
            try:
                logger.info("LLM analysis attempt %d/%d", attempt, settings.llm_max_retries)
                response = self._client.chat.completions.create(
                    model=settings.llm_model,
                    max_tokens=4096,
                    messages=[
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                    timeout=settings.llm_timeout,
                )
                text = response.choices[0].message.content or ""
                text = text.strip()
                data = _parse_json_response(text)
                self._validate_response(data, dataset_classes)
                logger.info(
                    "LLM returned %d canonical classes", len(data.get("canonical_classes", []))
                )
                return LLMAnalysisResult(data)

            except openai.RateLimitError as e:
                last_error = e
                wait = 15 * attempt  # 15s, 30s, 45s… free tier needs longer waits
                logger.warning("LLM rate limit, retrying in %ds: %s", wait, e)
                time.sleep(wait)
            except openai.APIStatusError as e:
                # OpenRouter forwards upstream 429s as APIStatusError, not RateLimitError
                if e.status_code == 429:
                    last_error = e
                    wait = 15 * attempt
                    logger.warning("Upstream rate limit (429), retrying in %ds: %s", wait, e)
                    time.sleep(wait)
                else:
                    last_error = e
                    logger.error("LLM API status error %d: %s", e.status_code, e)
                    raise
            except openai.APITimeoutError as e:
                last_error = e
                wait = 10 * attempt
                logger.warning("LLM timeout, retrying in %ds: %s", wait, e)
                time.sleep(wait)
            except (json.JSONDecodeError, ValueError) as e:
                last_error = e
                logger.warning("LLM response parse error on attempt %d: %s", attempt, e)
                if attempt == settings.llm_max_retries:
                    break
            except openai.APIError as e:
                last_error = e
                logger.error("LLM API error: %s", e)
                raise

        raise RuntimeError(
            f"LLM analysis failed after {settings.llm_max_retries} attempts. "
            f"Last error: {last_error}"
        )

    def _validate_response(
        self, data: dict, dataset_classes: dict[str, list[str]]
    ) -> None:
        if "canonical_classes" not in data:
            raise ValueError("Response missing 'canonical_classes' key")

        all_input = {label for labels in dataset_classes.values() for label in labels}
        all_output: set[str] = set()
        for cls in data["canonical_classes"]:
            if "name" not in cls or "aliases" not in cls:
                raise ValueError(f"Canonical class missing 'name' or 'aliases': {cls}")
            for alias in cls["aliases"]:
                if alias in all_output:
                    raise ValueError(f"Alias '{alias}' appears in multiple canonical classes")
                all_output.add(alias)

        missing = all_input - all_output - set(data.get("unmapped", []))
        if missing:
            logger.warning("LLM did not map %d labels: %s", len(missing), missing)
            data.setdefault("unmapped", []).extend(missing)


def _parse_json_response(text: str) -> dict:
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(
            line for line in lines if not line.startswith("```")
        )
    return json.loads(text)
