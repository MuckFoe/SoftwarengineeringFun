"""Spec 005 task 21: `deploy/hub/RUNBOOK.md`, the operator's steps on the hub.

Checks the runbook against what the deploy actually provides: every file, hub script and
smoke flag it names exists; it never deletes `db-data`; credentials go to `.env.hub`
(Secrets NFR); each manual on-hub check names its spec criterion and what to record.
"""

import os
import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
RUNBOOK = REPO / "deploy" / "hub" / "RUNBOOK.md"
SMOKE = REPO / "deploy" / "hub" / "smoke.sh"
HUB_DIR = Path(os.environ.get("HUB_DIR", Path.home() / "Desktop" / "ProjectHub" / "hub"))


@pytest.fixture(scope="module")
def text() -> str:
    return RUNBOOK.read_text()


def _commands(text: str) -> str:
    """The fenced command blocks: what the operator actually types."""
    return "\n".join(re.findall(r"^```[a-z]*\n(.*?)^```", text, re.M | re.S))


def test_names_only_files_this_repo_has(text: str):
    for name in (
        "docker-compose.hub.yml",
        ".env.hub.example",
        "deploy/hub/smoke.sh",
        "keycloak-theme/collab",
    ):
        assert name in text, name
        assert (REPO / name).exists(), name


def test_hub_commands_exist(text: str):
    used = set(re.findall(r"(?<![\w/.])((?:bin|check)/[a-z-]+(?:\.sh)?)\b", text))
    assert {"bin/add-client", "bin/set-login-theme", "bin/reload", "check/static.sh"} <= used
    if not HUB_DIR.exists():
        pytest.skip(f"hub repo not found at {HUB_DIR}; set HUB_DIR")
    for script in used:
        assert (HUB_DIR / script).exists(), script
    for path in ("caddy/apps/collab.caddy", "keycloak/themes/collab/login/theme.properties"):
        assert path.split("/login/")[0] in text, path
        assert (HUB_DIR / path).exists(), path


def test_smoke_flags_exist(text: str):
    flags = set(re.findall(r"deploy/hub/smoke\.sh[^\n`]*", text))
    used = {f for line in flags for f in re.findall(r"--[a-z-]+", line)}
    assert {"--fresh", "--sample-memory"} <= used
    smoke = SMOKE.read_text()
    for flag in used:
        assert f"{flag})" in smoke, flag


def test_add_client_matches_the_callback(text: str):
    assert "bin/add-client collab confidential /api/auth/callback" in text


def test_never_deletes_data(text: str):
    commands = _commands(text)
    assert not re.search(r"\bdown\b[^\n]*\s(-v|--volumes)\b", commands)
    assert not re.search(r"volume\s+(rm|prune)|system\s+prune", commands)
    # The prose names the deleting commands only to forbid them.
    assert re.search(r"\*\*Never\*\* run `docker compose \.\.\. down -v`", text)
    assert "db-data" in text


def test_credentials_go_to_env_hub(text: str):
    for var in ("OIDC_CLIENT_SECRET", "SESSION_COOKIE_KEY", "POSTGRES_PASSWORD"):
        assert var in text, var
    assert "chmod 600 .env.hub" in text
    # No literal secret assigned on a command line or in the text.
    assert not re.search(r'(SECRET|PASSWORD|KEY)=(?!"?\$)[^\s`<]', text)


@pytest.mark.parametrize("criterion", ["FR2a", "FR7", "FR8", "Memory"])
def test_each_manual_check_names_criterion_and_record(text: str, criterion: str):
    heading = re.search(rf"^### .*\b{criterion}\b.*$", text, re.M)
    assert heading, f"no check heading for {criterion}"
    section = text[heading.end() :].split("\n### ", 1)[0]
    assert "notes.md" in section, f"{criterion}: says nothing about what to record"
