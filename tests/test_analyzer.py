import json
from unittest.mock import MagicMock, patch

import pytest

from core.llm.analyzer import LLMAnalysisResult, SemanticAnalyzer, _parse_json_response
from core.llm.prompts import build_user_prompt

MOCK_RESPONSE = {
    "canonical_classes": [
        {"name": "car", "aliases": ["car", "automobile", "vehicle-car"], "confidence": 0.97, "reasoning": "synonyms"},
        {"name": "person", "aliases": ["person", "pedestrian", "human"], "confidence": 0.99, "reasoning": "same concept"},
        {"name": "truck", "aliases": ["truck", "lorry"], "confidence": 0.92, "reasoning": "heavy vehicle"},
    ],
    "unmapped": [],
}


def make_mock_client(response_text: str):
    """Return a mock openai.OpenAI client whose chat.completions.create returns response_text."""
    client = MagicMock()
    choice = MagicMock()
    choice.message.content = response_text
    response = MagicMock()
    response.choices = [choice]
    client.chat.completions.create.return_value = response
    return client


# ── Pure data-class tests (no network) ───────────────────────────────────────

def test_analysis_result_to_mapping():
    result = LLMAnalysisResult(MOCK_RESPONSE)
    mapping = result.to_mapping()
    assert mapping["car"] == ["car", "automobile", "vehicle-car"]
    assert mapping["person"] == ["person", "pedestrian", "human"]


def test_analysis_result_confidence():
    result = LLMAnalysisResult(MOCK_RESPONSE)
    conf = result.to_confidence_map()
    assert conf["car"] == pytest.approx(0.97)


def test_parse_json_strips_fences():
    text = "```json\n{\"a\": 1}\n```"
    data = _parse_json_response(text)
    assert data == {"a": 1}


def test_parse_json_plain():
    data = _parse_json_response('{"x": 2}')
    assert data["x"] == 2


def test_build_user_prompt_includes_all_datasets():
    prompt = build_user_prompt({"ds1": ["cat", "dog"], "ds2": ["kitten"]})
    assert "ds1" in prompt
    assert "cat" in prompt
    assert "kitten" in prompt


def test_build_user_prompt_domain_hint():
    prompt = build_user_prompt({"ds": ["tank"]}, domain_hint="military")
    assert "military" in prompt


# ── SemanticAnalyzer tests (OpenRouter / openai client mocked) ────────────────

def test_analyzer_no_api_key():
    with pytest.raises(ValueError, match="OPENROUTER_API_KEY"):
        SemanticAnalyzer(api_key="")


@patch("core.llm.analyzer.openai.OpenAI")
def test_analyzer_success(mock_openai_cls):
    mock_client = make_mock_client(json.dumps(MOCK_RESPONSE))
    mock_openai_cls.return_value = mock_client

    analyzer = SemanticAnalyzer(api_key="test-key")
    result = analyzer.analyze(
        {"ds1": ["car", "automobile", "vehicle-car"], "ds2": ["person", "pedestrian", "human", "truck", "lorry"]}
    )
    assert len(result.canonical_classes) == 3
    assert result.unmapped == []


@patch("core.llm.analyzer.openai.OpenAI")
def test_analyzer_empty_input(mock_openai_cls):
    analyzer = SemanticAnalyzer(api_key="test-key")
    with pytest.raises(ValueError, match="empty"):
        analyzer.analyze({})


@patch("core.llm.analyzer.openai.OpenAI")
def test_analyzer_adds_unmapped_labels(mock_openai_cls):
    """Labels not covered by LLM response get added to unmapped list."""
    partial_response = {
        "canonical_classes": [
            {"name": "car", "aliases": ["car"], "confidence": 1.0, "reasoning": ""},
        ],
        "unmapped": [],
    }
    mock_client = make_mock_client(json.dumps(partial_response))
    mock_openai_cls.return_value = mock_client

    analyzer = SemanticAnalyzer(api_key="test-key")
    result = analyzer.analyze({"ds": ["car", "mystery_label"]})
    assert "mystery_label" in result.unmapped


@patch("core.llm.analyzer.openai.OpenAI")
@patch("core.llm.analyzer.time.sleep")
def test_analyzer_retries_on_rate_limit(mock_sleep, mock_openai_cls):
    import openai as _openai

    # First call raises RateLimitError, second succeeds
    good_choice = MagicMock()
    good_choice.message.content = json.dumps(MOCK_RESPONSE)
    good_response = MagicMock()
    good_response.choices = [good_choice]

    mock_client = MagicMock()
    mock_client.chat.completions.create.side_effect = [
        _openai.RateLimitError("rate limit", response=MagicMock(), body={}),
        good_response,
    ]
    mock_openai_cls.return_value = mock_client

    analyzer = SemanticAnalyzer(api_key="test-key")
    result = analyzer.analyze(
        {"ds1": ["car", "automobile", "vehicle-car"], "ds2": ["person", "pedestrian", "human", "truck", "lorry"]}
    )
    assert len(result.canonical_classes) == 3
    assert mock_sleep.called
