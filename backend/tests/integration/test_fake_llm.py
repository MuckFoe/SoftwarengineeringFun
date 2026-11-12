"""The fake LLM (020 task 2) behaves as the hint tests rely on.

It is a real HTTP server on a local socket, so these checks use plain `httpx`.
"""

import time
from collections.abc import Iterator
from typing import Any

import httpx
import pytest

from tests.fakes.fake_llm import DEFAULT_HINTS, MARKUP_REPLY, FakeLlm


def _messages(note: str | None = None, signature: str = "def add(a, b)") -> list[dict[str, str]]:
    user = f"Problem\nAdd\n{signature}\n\nCurrent code\npass"
    if note is not None:
        user += f"\n\nNote\n{note}"
    return [{"role": "system", "content": "You are a tutor."}, {"role": "user", "content": user}]


def _ask(fake: FakeLlm, note: str | None = None, **extra: Any) -> httpx.Response:
    body = {"model": "fake-model", "messages": _messages(note), "stream": False, **extra}
    return httpx.post(f"{fake.base_url}/chat/completions", json=body, timeout=15)


def _content(resp: httpx.Response) -> str:
    assert resp.status_code == 200
    return resp.json()["choices"][0]["message"]["content"]


def _ps(fake: FakeLlm) -> httpx.Response:
    return httpx.get(f"{fake.root_url}/api/ps", timeout=5)


@pytest.fixture
def controlled_llm() -> Iterator[FakeLlm]:
    fake = FakeLlm(control_port=0, slow_seconds=0.6, cold_seconds=0.3).start()
    try:
        yield fake
    finally:
        fake.stop()


def test_queued_replies_are_served_in_order(fake_llm: FakeLlm) -> None:
    fake_llm.reply_with("first", "second")
    first = _ask(fake_llm)
    assert first.json()["choices"][0]["message"]["role"] == "assistant"
    assert _content(first) == "first"
    assert _content(_ask(fake_llm)) == "second"
    assert _content(_ask(fake_llm)) in DEFAULT_HINTS  # queue drained: default answer


def test_every_request_is_recorded_in_process_and_over_control(
    controlled_llm: FakeLlm,
) -> None:
    httpx.post(
        f"{controlled_llm.base_url}/chat/completions",
        json={"model": "fake-model", "messages": _messages("hi")},
        headers={"Authorization": "Bearer k", "X-Probe": "yes"},
        timeout=5,
    )
    [recorded] = controlled_llm.requests
    assert recorded.path == "/v1/chat/completions"
    assert recorded.headers["authorization"] == "Bearer k"
    assert recorded.headers["x-probe"] == "yes"
    assert recorded.body == {"model": "fake-model", "messages": _messages("hi")}

    over_http = httpx.get(f"{controlled_llm.control_url}/requests", timeout=5).json()
    assert over_http == [
        {
            "path": "/v1/chat/completions",
            "headers": recorded.headers,
            "body": {"model": "fake-model", "messages": _messages("hi")},
        }
    ]
    assert httpx.get(f"{controlled_llm.control_url}/health", timeout=5).text == "ok"


def test_delay_fail_garbage_and_refuse_then_reset(fake_llm: FakeLlm) -> None:
    fake_llm.delay(0.5)
    started = time.monotonic()
    _content(_ask(fake_llm))
    assert time.monotonic() - started >= 0.5
    with pytest.raises(httpx.ReadTimeout):
        httpx.post(
            f"{fake_llm.base_url}/chat/completions",
            json={"model": "m", "messages": _messages()},
            timeout=0.1,
        )

    fake_llm.reset()
    fake_llm.fail_with(503)
    assert _ask(fake_llm).status_code == 503

    fake_llm.reset()
    fake_llm.garbage()
    garbage = _ask(fake_llm)
    assert garbage.status_code == 200
    assert "choices" not in garbage.json()

    fake_llm.reset()
    fake_llm.refuse_connections()
    with pytest.raises(httpx.ConnectError):
        _ask(fake_llm)
    fake_llm.accept_connections()
    _content(_ask(fake_llm))

    fake_llm.refuse_connections()
    fake_llm.reply_with("queued")
    fake_llm.reset()  # listens again, clears the queue, the recordings and every failure
    assert fake_llm.requests == []
    started = time.monotonic()
    assert _content(_ask(fake_llm)) in DEFAULT_HINTS
    assert time.monotonic() - started < 0.4


def test_api_ps_loaded_cold_and_failing(fake_llm: FakeLlm) -> None:
    loaded = _ps(fake_llm)
    assert loaded.status_code == 200
    assert loaded.json() == {"models": [{"name": "fake-model", "model": "fake-model"}]}
    assert fake_llm.requests[-1].path == "/api/ps"

    fake_llm.set_cold(True)
    assert _ps(fake_llm).json() == {"models": []}
    assert _ps(fake_llm).json() == {"models": []}
    fake_llm.set_cold(False)
    assert _ps(fake_llm).json()["models"]

    fake_llm.ps_fail_with(500)
    assert _ps(fake_llm).status_code == 500
    assert _content(_ask(fake_llm))  # completions are unaffected
    fake_llm.reset()
    assert _ps(fake_llm).status_code == 200


def test_post_cold_affects_exactly_one_ps_call(controlled_llm: FakeLlm) -> None:
    resp = httpx.post(f"{controlled_llm.control_url}/cold", timeout=5)
    assert resp.status_code == 204
    _content(_ask(controlled_llm))  # a completion does not consume the cold state
    assert _ps(controlled_llm).json() == {"models": []}
    assert _ps(controlled_llm).json()["models"]

    httpx.post(f"{controlled_llm.control_url}/cold", timeout=5)
    assert httpx.post(f"{controlled_llm.control_url}/reset", timeout=5).status_code == 204
    assert _ps(controlled_llm).json()["models"]
    assert controlled_llm.requests[-1].path == "/api/ps"
    assert len(controlled_llm.requests) == 1  # reset cleared the earlier recordings


def test_note_directives(controlled_llm: FakeLlm) -> None:
    started = time.monotonic()
    _content(_ask(controlled_llm, "fake:slow"))
    assert time.monotonic() - started >= 0.6

    assert _ask(controlled_llm, "fake:error").status_code == 500

    solution = _content(_ask(controlled_llm, "please fake:solution"))
    assert solution.startswith("def add(a, b):")
    assert "return" in solution

    assert _content(_ask(controlled_llm, "fake:markup")) == MARKUP_REPLY
    assert MARKUP_REPLY == "<img src=x onerror=alert(1)> try the empty case"

    started = time.monotonic()
    _content(_ask(controlled_llm, "fake:cold"))
    assert time.monotonic() - started >= 0.3

    # A queued reply wins over a directive.
    controlled_llm.reply_with("queued")
    assert _content(_ask(controlled_llm, "fake:error")) == "queued"


def test_default_slow_and_cold_durations() -> None:
    fake = FakeLlm()
    assert fake.slow_seconds == 10
    assert 1.5 <= fake.cold_seconds <= 2.5


def test_solution_uses_the_requested_function_name(fake_llm: FakeLlm) -> None:
    body = {
        "model": "fake-model",
        "messages": _messages("fake:solution", signature="def two_sum(nums, target)"),
    }
    resp = httpx.post(f"{fake_llm.base_url}/chat/completions", json=body, timeout=5)
    assert "def two_sum(nums, target)" in _content(resp)


def test_two_default_answers_in_a_row_differ(fake_llm: FakeLlm) -> None:
    answers = [_content(_ask(fake_llm, "stuck on empty input")) for _ in range(len(DEFAULT_HINTS))]
    assert all(a != b for a, b in zip(answers, answers[1:], strict=False))
    assert set(answers) == set(DEFAULT_HINTS)
    assert all(_content(_ask(fake_llm)) in DEFAULT_HINTS for _ in range(2))


def test_base_url_includes_v1_and_root_does_not(fake_llm: FakeLlm) -> None:
    assert fake_llm.base_url == f"{fake_llm.root_url}/v1"
