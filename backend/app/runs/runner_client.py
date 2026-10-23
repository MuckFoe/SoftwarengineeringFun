"""Runner client (plan.md "Runner" contract, api side), FR-21."""

from dataclasses import dataclass
from typing import Any

import httpx

REQUEST_TIMEOUT_S = 25.0  # a few seconds above the runner's own 20 s outer timeout


class RunnerUnavailable(RuntimeError):
    """The runner could not be reached, or reported an infrastructure failure (503)."""


@dataclass(frozen=True)
class CaseOutcome:
    status: str  # "ok" | "error" | "timeout" | "memory"
    value: Any = None
    error_message: str | None = None
    traceback: str | None = None


async def execute(
    runner_url: str, code: str, function_name: str, cases: list[list[Any]]
) -> list[CaseOutcome]:
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_S) as client:
            response = await client.post(
                f"{runner_url}/execute",
                json={"code": code, "function_name": function_name, "cases": cases},
            )
    except httpx.HTTPError as exc:
        raise RunnerUnavailable(f"could not reach the runner: {exc}") from exc
    if response.status_code == 503:
        raise RunnerUnavailable(f"the runner reported an infrastructure failure: {response.text}")
    response.raise_for_status()
    return [CaseOutcome(**case) for case in response.json()["cases"]]
