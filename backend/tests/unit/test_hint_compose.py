"""Spec 020 task 9: the model settings and the fake model in compose and the E2E env.

AC-1 (FR-1, FR-2): with the `HINTS_LLM_*` variables unset, `docker compose config` renders
them so the api's settings have hints off. Read statically through `docker compose config`,
like `test_hub_compose.py`; nothing is started.
"""

import json
import os
import re
import subprocess
from pathlib import Path

import pytest

from app.config import REQUIRED, load_settings

REPO = Path(__file__).resolve().parents[3]
APP_COMPOSES = [REPO / "docker-compose.hub.yml", REPO / "docker-compose.yml"]
TEST_COMPOSE = REPO / "docker-compose.test.yml"
GLOBAL_SETUP = REPO / "e2e" / "global-setup.ts"

HINT_VARS = (
    "HINTS_LLM_BASE_URL",
    "HINTS_LLM_MODEL",
    "HINTS_LLM_API_KEY",
    "HINTS_LLM_TIMEOUT_SECONDS",
    "HINTS_LLM_COLD_TIMEOUT_SECONDS",
)


def _required(compose: Path) -> set[str]:
    return set(re.findall(r"\$\{([A-Z_][A-Z0-9_]*):\?", compose.read_text()))


def _config(compose: Path, *extra: str, env: dict[str, str] | None = None) -> dict:
    # The shell's own HINTS_LLM_* and TEST_LLM_* would change what renders.
    drop = ("COMPOSE_", "HINTS_LLM_", "TEST_LLM_")
    base = {k: v for k, v in os.environ.items() if not k.startswith(drop)}
    out = subprocess.run(  # noqa: S603
        # --env-file /dev/null: ignore the repo's .env (the E2E setup writes one).
        ["docker", "compose", "-f", str(compose), "--env-file", "/dev/null", "config"]  # noqa: S607
        + ["--format", "json", *extra],
        cwd=REPO,
        env=base | (env or {}),
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return json.loads(out)


@pytest.mark.parametrize("compose", APP_COMPOSES, ids=["hub", "dev"])
def test_hint_variables_are_environment_references(compose):
    env = _config(compose, "--no-env-resolution", "--no-interpolate")["services"]["api"][
        "environment"
    ]
    for name in HINT_VARS:
        assert env[name] == f"${{{name}:-}}"
    # Unset keeps the code default ("none"); set to empty omits reasoning_effort.
    assert env["HINTS_LLM_REASONING_EFFORT"] == "${HINTS_LLM_REASONING_EFFORT-none}"


@pytest.mark.parametrize("compose", APP_COMPOSES, ids=["hub", "dev"])
def test_ac1_unset_variables_render_hints_off(compose):
    # Dummies for what the files and the app require; none are secrets.
    required = dict.fromkeys(_required(compose) | set(REQUIRED), "x") | {
        "DATABASE_URL": "postgresql://u:p@db/x",
        "OIDC_ISSUER": "http://kc/realms/x",
    }
    api_env = _config(compose, env=required)["services"]["api"]["environment"]
    for name in HINT_VARS:
        assert api_env[name] == ""
    assert api_env["HINTS_LLM_REASONING_EFFORT"] == "none"
    settings = load_settings({k: str(v) for k, v in api_env.items() if v is not None})
    assert settings.hint_llm_base_url is None
    assert settings.hint_llm_reasoning_effort == "none"


def test_test_stack_runs_the_fake_model_with_a_health_checked_control_port():
    required = dict.fromkeys(_required(TEST_COMPOSE), "x")
    llm = _config(TEST_COMPOSE, env=required)["services"]["llm"]
    assert llm["image"] == "python:3.12-slim"
    command = " ".join(llm["command"])
    assert "fake_llm.py" in command
    assert "--host=0.0.0.0" in command
    assert "--port=8080" in command
    assert "--control-port=8081" in command
    published = {(p["published"], p["target"]) for p in llm["ports"]}
    assert published == {("58380", 8080), ("58381", 8081)}
    assert all(p["host_ip"] == "127.0.0.1" for p in llm["ports"])
    assert "http://127.0.0.1:8081/health" in " ".join(llm["healthcheck"]["test"])
    assert any(v["target"].endswith("fake_llm.py") and v["read_only"] for v in llm["volumes"])


def test_e2e_env_points_the_api_at_the_fake_model():
    text = GLOBAL_SETUP.read_text()
    port = '${process.env.TEST_LLM_PORT ?? "58380"}'
    assert f"`HINTS_LLM_BASE_URL=http://host.docker.internal:{port}/v1`" in text
    assert "`HINTS_LLM_MODEL=fake-model`" in text
    assert "`HINTS_LLM_TIMEOUT_SECONDS=3`" in text
    assert "`HINTS_LLM_COLD_TIMEOUT_SECONDS=6`" in text
