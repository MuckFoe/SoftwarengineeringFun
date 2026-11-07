"""Spec 011: `RunSandbox`, the streaming client of the runner's `/execute-stream`."""

import base64
import binascii
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass

import httpx

from app.runs.runner_client import RunnerUnavailable
from app.scratch.output import StreamDecoder

# No overall read timeout: the runner enforces the wall-time limit and ends the stream itself.
_TIMEOUT = httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=10.0)


@dataclass(frozen=True)
class Exited:
    code: int


@dataclass(frozen=True)
class TimeLimit:
    pass


Outcome = Exited | TimeLimit


async def run(
    runner_url: str, code: str, stdin_text: str
) -> AsyncIterator[tuple[str, str] | Outcome]:
    """Yield `(stream, text)` pieces as they arrive, then one final `Exited` or `TimeLimit`.

    Raises RunnerUnavailable on 503, an unreachable runner or a stream that ends without
    an outcome. Closing the generator closes the connection (the runner then kills the run).
    """
    decoder = StreamDecoder()
    outcome: Outcome | None = None
    try:
        async with (
            httpx.AsyncClient(timeout=_TIMEOUT) as client,
            client.stream(
                "POST",
                f"{runner_url}/execute-stream",
                json={"code": code, "stdin": stdin_text},
            ) as response,
        ):
            if response.status_code == 503:
                body = (await response.aread()).decode("utf-8", errors="replace")
                raise RunnerUnavailable(f"the runner reported an infrastructure failure: {body}")
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.strip():
                    continue
                msg = json.loads(line)
                if "end" in msg:
                    outcome = TimeLimit() if msg["end"] == "time_limit" else Exited(msg["code"])
                    break
                text = decoder.feed(msg["s"], base64.b64decode(msg["b"]))
                if text:
                    yield msg["s"], text
    except (httpx.HTTPError, json.JSONDecodeError, KeyError, binascii.Error) as exc:
        raise RunnerUnavailable(f"could not use the runner: {exc}") from exc
    if outcome is None:
        raise RunnerUnavailable("the runner stream ended without an outcome")
    for stream in ("out", "err"):
        tail = decoder.feed(stream, b"", final=True)
        if tail:
            yield stream, tail
    yield outcome
