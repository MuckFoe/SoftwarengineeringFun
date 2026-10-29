"""Tasks 31-32: starter problems 1-20 (`seed/problems/01-...` through `20-...`). FR-6, NFR-3.

Spec 002 tasks 8-9: Markdown starter descriptions (FR8, FR9), over the `DESCRIBED` folders.
"""

import json
import os
import socket
import time
from collections.abc import AsyncIterator
from pathlib import Path
from urllib.parse import urlsplit

import asyncpg
import pytest

from app import db as app_db
from app.problems.markdown import render_description
from app.problems.seed import load_seed
from app.problems.signature import parse_signature, values_equal
from app.runs.runner_client import execute

SEED_DIR = Path(__file__).resolve().parents[3] / "seed" / "problems"
RUNNER_URL = os.environ.get("RUNNER_URL", "http://127.0.0.1:58080")

# Folder numbers whose description has been rewritten as sectioned Markdown (spec 002).
DESCRIBED = range(1, 21)
SECTIONS = ("Task", "Input", "Output", "Example", "Constraints")


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


@pytest.fixture
def runner_url() -> str:
    parts = urlsplit(RUNNER_URL)
    try:
        socket.create_connection((parts.hostname, parts.port), timeout=2).close()
    except OSError:
        pytest.fail(
            f"runner not reachable at {RUNNER_URL}; start it with "
            "`docker compose -f docker-compose.test.yml up -d --wait runner`",
            pytrace=False,
        )
    return RUNNER_URL


def _folders() -> list[Path]:
    return sorted(p for p in SEED_DIR.iterdir() if p.is_dir())


async def test_fr6_each_seed_problem_validates_and_its_reference_passes(
    migrated: asyncpg.Connection, runner_url: str
) -> None:
    folders = _folders()
    inserted = await load_seed(migrated, SEED_DIR)
    assert inserted == len(folders)

    for folder in folders:
        data = json.loads((folder / "problem.json").read_text())
        reference = (folder / "reference.py").read_text()
        function_name = parse_signature(data["signature"]).name
        cases = [t["args"] for t in data["tests"]]
        expected = [t["expected"] for t in data["tests"]]
        assert len(data["tests"]) >= 5, f"{folder.name} has fewer than 5 tests"

        start = time.monotonic()
        outcomes = await execute(runner_url, reference, function_name, cases)
        elapsed = time.monotonic() - start

        assert elapsed < 10, f"{folder.name} took {elapsed:.1f}s"  # NFR-3
        for outcome, exp in zip(outcomes, expected, strict=True):
            assert outcome.status == "ok", f"{folder.name}: {outcome}"
            assert values_equal(outcome.value, exp), f"{folder.name}: {outcome.value} != {exp}"


async def test_fr6_a_fresh_install_lists_exactly_20_starter_problems(
    migrated: asyncpg.Connection,
) -> None:
    folders = _folders()
    assert len(folders) == 20

    topics = set()
    for folder in folders:
        data = json.loads((folder / "problem.json").read_text())
        assert len(data["tests"]) >= 1, f"{folder.name} has no tests"
        topics.add(data["topic"])
    assert len(topics) > 1

    await load_seed(migrated, SEED_DIR)

    rows = await migrated.fetch("select is_starter, description from problem")
    assert len(rows) == 20
    assert all(r["is_starter"] for r in rows)
    assert all(r["description"].strip() for r in rows)  # spec 002 FR8


def _described() -> list[Path]:
    return [f for f in _folders() if int(f.name.split("-", 1)[0]) in DESCRIBED]


def test_002_described_range_has_its_folders() -> None:
    assert len(_described()) == len(DESCRIBED)


@pytest.mark.parametrize("folder", _described(), ids=lambda f: f.name)
def test_002_fr8_starter_description_is_non_empty_with_every_section(folder: Path) -> None:
    description = json.loads((folder / "problem.json").read_text())["description"]
    assert description.strip()

    html = render_description(description)
    for section in SECTIONS:
        assert f"<h2>{section}</h2>" in html, f"{folder.name} lacks a '{section}' section"


@pytest.mark.parametrize("folder", _described(), ids=lambda f: f.name)
def test_002_fr9_starter_description_does_not_reveal_hidden_test_arguments(folder: Path) -> None:
    data = json.loads((folder / "problem.json").read_text())
    for test in data["tests"]:
        encoded = json.dumps(test["args"])
        assert encoded not in data["description"], f"{folder.name} reveals {encoded}"
