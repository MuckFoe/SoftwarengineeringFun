"""Spec 020: the client for the self-hosted model (FR-14, FR-14a, NFR Data stays on the
user's network).

Ollama's OpenAI-compatible API: `base_url` includes `/v1`, completions are POSTed to
`{base}/chat/completions`, and Ollama's own `GET {root}/api/ps` (root = base without `/v1`)
says whether the model is loaded. One request per call, to the configured host only: no
retries and no fallback.
"""

import asyncio
from typing import Any

import httpx

TEMPERATURE = 0.2
MAX_TOKENS = 250
ANSWER_MAX_TOKENS = 400  # spec 020 FR-19: an answer to a question
REVEALED_MAX_TOKENS = 1200  # FR-20: a confirmed answer may carry the whole solution
PS_TIMEOUT_S = 3.0


class LlmUnavailable(RuntimeError):
    """The model could not be reached, failed, timed out or answered with nothing usable."""


class LlmClient:
    def __init__(
        self, base_url: str, model: str, api_key: str | None, reasoning_effort: str
    ) -> None:
        base = base_url.rstrip("/")
        self._completions_url = f"{base}/chat/completions"
        root = base.removesuffix("/v1")
        self._ps_url = f"{root}/api/ps"
        self._model = model
        self._reasoning_effort = reasoning_effort
        headers = {"Accept": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        self._http = httpx.AsyncClient(headers=headers, follow_redirects=False)

    async def is_loaded(self) -> bool:
        """False only when `/api/ps` answers a list of models without ours; any error or
        unexpected answer counts as loaded."""
        try:
            async with asyncio.timeout(PS_TIMEOUT_S):
                resp = await self._http.get(self._ps_url, timeout=PS_TIMEOUT_S)
            resp.raise_for_status()
            models = resp.json().get("models")
        except (TimeoutError, httpx.HTTPError, ValueError, AttributeError):
            return True
        if not isinstance(models, list):
            return True
        return any(self._is_ours(m) for m in models)

    async def complete(
        self, messages: list[dict[str, str]], timeout_s: float, max_tokens: int = MAX_TOKENS
    ) -> str:
        body: dict[str, Any] = {
            "model": self._model,
            "messages": messages,
            "temperature": TEMPERATURE,
            "max_tokens": max_tokens,
            "stream": False,
        }
        if self._reasoning_effort:
            body["reasoning_effort"] = self._reasoning_effort
        # A deadline on the whole call, not just each phase, keeps a trickling reply in budget.
        try:
            async with asyncio.timeout(timeout_s):
                resp = await self._http.post(self._completions_url, json=body, timeout=timeout_s)
        except TimeoutError as exc:
            raise LlmUnavailable("the model timed out") from exc
        except httpx.HTTPError as exc:
            raise LlmUnavailable(type(exc).__name__) from exc
        if not resp.is_success:
            raise LlmUnavailable(f"the model answered {resp.status_code}")
        try:
            content = resp.json()["choices"][0]["message"]["content"]
        except (ValueError, LookupError, TypeError) as exc:
            raise LlmUnavailable("malformed answer") from exc
        if not isinstance(content, str) or not content.strip():
            raise LlmUnavailable("empty answer")
        return content

    async def aclose(self) -> None:
        await self._http.aclose()

    def _is_ours(self, entry: Any) -> bool:
        if not isinstance(entry, dict):
            return False
        names = {entry.get("name"), entry.get("model")}
        return self._model in names or f"{self._model}:latest" in names
