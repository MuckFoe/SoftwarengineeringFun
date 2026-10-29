"""Spec 005 task 7: `docker-compose.hub.yml` and the api image's base-path build arg.

Covers FR4, FR7, the Memory NFR and the Isolation NFR statically (plan §3.5). The file is
read through `docker compose config`, the same canonical form the hub's own
`check/static.sh` reads, so `mem_limit` arrives in bytes and short-form lists are expanded.
"""

import json
import os
import re
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
COMPOSE = REPO / "docker-compose.hub.yml"
ENV_EXAMPLE = REPO / ".env.hub.example"
HUB_DIR = Path(os.environ.get("HUB_DIR", Path.home() / "Desktop" / "ProjectHub" / "hub"))
MIB = 1024 * 1024
SANDBOX_MEMORY_MIB = 256  # runner/service.py's --memory per sandbox container
MEMORY_BUDGET_MIB = 1024


@pytest.fixture(scope="module")
def config() -> dict:
    out = subprocess.run(  # noqa: S603
        # --profile "*": include the build-only sandbox service in the listing.
        ["docker", "compose", "-f", str(COMPOSE), "--profile", "*", "config"]  # noqa: S607
        + ["--format", "json", "--no-env-resolution"],
        cwd=REPO,
        env={k: v for k, v in os.environ.items() if not k.startswith("COMPOSE_")},
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return json.loads(out)


def _running(config: dict) -> dict:
    """Services plain `up` starts; build-only profiles never run."""
    return {name: s for name, s in config["services"].items() if not s.get("profiles")}


# --- FR4 ---------------------------------------------------------------------


def test_fr4_services_are_exactly_the_apps_own_and_none_is_an_identity_provider(config):
    services = config["services"]
    assert set(services) == {"db", "runner", "api", "sandbox"}
    for name, service in services.items():
        for text in (name, service.get("image", "")):
            assert not re.search(r"keycloak|oauth2-proxy|dex|authentik|identity", text), name


# --- Isolation NFR -----------------------------------------------------------


def test_isolation_only_api_is_on_the_hub_network(config):
    services = config["services"]
    on_hub = {name for name, s in services.items() if "hub" in (s.get("networks") or {})}
    assert on_hub == {"api"}
    assert set(services["db"]["networks"]) == {"app"}
    assert set(services["runner"]["networks"]) == {"app"}
    assert services["api"]["networks"]["hub"]["aliases"] == ["collab-api"]
    assert config["networks"]["hub"]["external"] is True


def test_isolation_no_service_publishes_a_port(config):
    for name, service in config["services"].items():
        assert not service.get("ports"), name


# --- Memory NFR --------------------------------------------------------------


def test_memory_limits_and_sandbox_cap_stay_within_1gb(config):
    running = _running(config)
    limits = {name: int(s["mem_limit"]) // MIB for name, s in running.items()}
    assert limits == {"db": 160, "api": 224, "runner": 64}
    cap = int(running["runner"]["environment"]["SANDBOX_MAX_CONCURRENT"])
    assert cap == 2
    assert sum(limits.values()) + cap * SANDBOX_MEMORY_MIB <= MEMORY_BUDGET_MIB


# --- FR7 ---------------------------------------------------------------------


def test_fr7_restart_volume_and_fixed_project_name(config):
    assert config["name"] == "collab"
    for name, service in config["services"].items():
        assert service.get("restart") == "unless-stopped", name
    [mount] = [v for v in config["services"]["db"]["volumes"] if v["type"] == "volume"]
    assert mount["source"] == "db-data"
    assert mount["target"] == "/var/lib/postgresql/data"
    assert "db-data" in config["volumes"]


# --- Secrets NFR: every variable is documented --------------------------------


def test_every_variable_appears_in_env_hub_example():
    if not ENV_EXAMPLE.exists():
        pytest.skip(".env.hub.example not written yet (spec 005 task 6)")
    used = set(re.findall(r"\$\{([A-Z_][A-Z0-9_]*)", COMPOSE.read_text()))
    documented = set(re.findall(r"^([A-Z_][A-Z0-9_]*)=", ENV_EXAMPLE.read_text(), re.M))
    assert used
    assert used <= documented, sorted(used - documented)


# --- the hub's own static check ----------------------------------------------


def test_hub_static_check_passes():
    script = HUB_DIR / "check" / "static.sh"
    if not script.exists():
        pytest.skip(f"hub repo not found at {HUB_DIR}; set HUB_DIR")
    proc = subprocess.run(  # noqa: S603
        [str(script), str(COMPOSE)], capture_output=True, text=True, timeout=300
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr


# --- api image: APP_BASE_PATH build arg ----------------------------------------


def _built_index_html(*build_args: str) -> str:
    tag = "collab-api:base-path-test"
    subprocess.run(  # noqa: S603
        ["docker", "build", "-q", "-t", tag, "-f", "backend/Dockerfile", *build_args, "."],  # noqa: S607
        cwd=REPO,
        check=True,
        capture_output=True,
        timeout=900,
    )
    return subprocess.run(  # noqa: S603
        ["docker", "run", "--rm", tag, "cat", "/app/frontend/dist/index.html"],  # noqa: S607
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def test_api_image_built_with_base_path_references_it():
    html = _built_index_html("--build-arg", "APP_BASE_PATH=/collab/")
    assert '"/collab/assets/' in html


def test_api_image_built_without_base_path_is_unchanged():
    html = _built_index_html()
    assert '"/assets/' in html
    assert "/collab/" not in html
