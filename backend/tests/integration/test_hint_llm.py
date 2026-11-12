"""`LlmClient` against the fake model (020 task 7).

AC-12 (FR-14), AC-12a (FR-14a), AC-15 (NFR Data stays on the user's network). The fake is
a real HTTP server on a local port, so the real `httpx` path, timeouts and connection
refusal are exercised.
"""

from collections.abc import AsyncIterator, Callable
from typing import Any
from urllib.parse import urlsplit

import pytest

from app.hints.llm import LlmClient, LlmUnavailable
from tests.fakes.fake_llm import DEFAULT_MODEL, FakeLlm

MESSAGES = [
    {"role": "system", "content": "You are a tutor."},
    {"role": "user", "content": "Problem: two sum"},
]
API_KEY = "test-key-not-secret"


@pytest.fixture
async def make_client(fake_llm: FakeLlm) -> AsyncIterator[Callable[..., LlmClient]]:
    clients: list[LlmClient] = []

    def make(
        *, api_key: str | None = None, reasoning_effort: str = "none", model: str = DEFAULT_MODEL
    ) -> LlmClient:
        client = LlmClient(fake_llm.base_url, model, api_key, reasoning_effort)
        clients.append(client)
        return client

    yield make
    for client in clients:
        await client.aclose()


def _completions(fake: FakeLlm) -> list[Any]:
    return [r for r in fake.requests if r.path == "/v1/chat/completions"]


# -- complete: the happy path -----------------------------------------------------------


async def test_complete_returns_the_reply_text(fake_llm: FakeLlm, make_client) -> None:
    fake_llm.reply_with("Handle the empty list first.")
    assert await make_client().complete(MESSAGES, 2) == "Handle the empty list first."


# -- AC-15: one request, to the configured host only, with the documented body ------------


async def test_complete_sends_one_request_with_the_body(fake_llm: FakeLlm, make_client) -> None:
    fake_llm.reply_with("hint")
    await make_client().complete(MESSAGES, 2)

    assert len(fake_llm.requests) == 1
    [req] = _completions(fake_llm)
    assert req.headers["host"] == urlsplit(fake_llm.base_url).netloc
    assert req.body == {
        "model": DEFAULT_MODEL,
        "messages": MESSAGES,
        "temperature": 0.2,
        "max_tokens": 250,
        "stream": False,
        "reasoning_effort": "none",
    }
    assert "authorization" not in req.headers


async def test_api_key_is_sent_as_bearer(fake_llm: FakeLlm, make_client) -> None:
    await make_client(api_key=API_KEY).complete(MESSAGES, 2)
    [req] = _completions(fake_llm)
    assert req.headers["authorization"] == f"Bearer {API_KEY}"


async def test_empty_reasoning_effort_is_not_sent(fake_llm: FakeLlm, make_client) -> None:
    await make_client(reasoning_effort="").complete(MESSAGES, 2)
    [req] = _completions(fake_llm)
    assert "reasoning_effort" not in req.body
    assert req.body["max_tokens"] == 250


# -- AC-12: every failure is LlmUnavailable, with no retry ---------------------------------


async def test_timeout_raises_unavailable(fake_llm: FakeLlm, make_client) -> None:
    fake_llm.delay(0.5)
    with pytest.raises(LlmUnavailable):
        await make_client().complete(MESSAGES, 0.1)
    assert len(_completions(fake_llm)) == 1


async def test_server_error_raises_unavailable(fake_llm: FakeLlm, make_client) -> None:
    fake_llm.fail_with(500)
    with pytest.raises(LlmUnavailable):
        await make_client().complete(MESSAGES, 2)
    assert len(_completions(fake_llm)) == 1


async def test_refused_connection_raises_unavailable(fake_llm: FakeLlm, make_client) -> None:
    fake_llm.refuse_connections()
    with pytest.raises(LlmUnavailable):
        await make_client().complete(MESSAGES, 2)


async def test_no_choices_raises_unavailable(fake_llm: FakeLlm, make_client) -> None:
    fake_llm.garbage()
    with pytest.raises(LlmUnavailable):
        await make_client().complete(MESSAGES, 2)


@pytest.mark.parametrize(
    "answer",
    [
        {"choices": []},
        {"choices": [{"message": {"role": "assistant", "content": ""}}]},
        {"choices": [{"message": {"role": "assistant", "content": None}}]},
        {"choices": [{}]},
        ["not", "an", "object"],
    ],
)
async def test_empty_or_malformed_choices_raise_unavailable(
    fake_llm: FakeLlm, make_client, monkeypatch: pytest.MonkeyPatch, answer: Any
) -> None:
    monkeypatch.setattr(fake_llm, "_completion", lambda body: (200, answer))
    with pytest.raises(LlmUnavailable):
        await make_client().complete(MESSAGES, 2)


# -- AC-12a: is_loaded asks Ollama's root /api/ps; any error counts as loaded --------------


async def test_is_loaded_true_when_model_listed(fake_llm: FakeLlm, make_client) -> None:
    assert await make_client().is_loaded() is True
    [req] = fake_llm.requests
    assert req.path == "/api/ps"


async def test_is_loaded_false_on_empty_list(fake_llm: FakeLlm, make_client) -> None:
    fake_llm.set_cold(True)
    assert await make_client().is_loaded() is False


async def test_is_loaded_false_when_only_other_models_listed(
    fake_llm: FakeLlm, make_client
) -> None:
    assert await make_client(model="qwen3.6:35b").is_loaded() is False


async def test_is_loaded_true_when_ps_fails(fake_llm: FakeLlm, make_client) -> None:
    fake_llm.ps_fail_with(500)
    assert await make_client().is_loaded() is True


@pytest.mark.parametrize("garbage", [{"nothing": True}, {"models": "x"}, ["x"]])
async def test_is_loaded_true_on_garbage(
    fake_llm: FakeLlm, make_client, monkeypatch: pytest.MonkeyPatch, garbage: Any
) -> None:
    monkeypatch.setattr(fake_llm, "_ps", lambda: (200, garbage))
    assert await make_client().is_loaded() is True


async def test_is_loaded_true_when_connection_refused(fake_llm: FakeLlm, make_client) -> None:
    client = make_client()
    fake_llm.refuse_connections()
    assert await client.is_loaded() is True
