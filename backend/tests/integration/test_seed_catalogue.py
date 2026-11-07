"""Spec 018 task 43: the real 150-problem seed, end to end. FR-1, FR-4, FR-5, FR-7, NFR-1 to NFR-4.

Real PostgreSQL, real runner, no mocks. Per-reference runs of every problem through the runner
are `test_fr6_each_seed_problem_validates_and_its_reference_passes` (test_seed_content.py); the
static and determinism checks are `scripts/seed_check.py`, reused here rather than duplicated.
"""

import json
import os
import sys
import uuid
from collections import Counter
from collections.abc import AsyncIterator
from pathlib import Path
from types import SimpleNamespace

import asyncpg
import httpx
import pytest
from fastapi import FastAPI

from app import db as app_db
from app.problems import api as problems_api
from app.problems.categories import CATEGORY_IDS
from app.problems.seed import load_seed
from app.runs import service

ROOT = Path(__file__).resolve().parents[3]
SEED_DIR = ROOT / "seed" / "problems"
RUNNER_URL = os.environ.get("RUNNER_URL", "http://127.0.0.1:58080")
DIFFICULTIES = ("easy", "medium", "hard")

sys.path.insert(0, str(ROOT / "scripts"))
import seed_check  # noqa: E402


def _folders() -> list[Path]:
    return sorted(p for p in SEED_DIR.iterdir() if p.is_dir())


def _data(folder: Path) -> dict:
    return json.loads((folder / "problem.json").read_text())


@pytest.fixture
async def seeded(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    await load_seed(db, SEED_DIR)
    yield db


@pytest.fixture
async def client(seeded: asyncpg.Connection) -> AsyncIterator[httpx.AsyncClient]:
    app = FastAPI()
    app.include_router(problems_api.router)
    app.state.settings = SimpleNamespace(base_path="")

    async def _conn() -> AsyncIterator[asyncpg.Connection]:
        yield seeded

    app.dependency_overrides[problems_api.get_conn] = _conn
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


async def test_fr1_a_fresh_database_lists_150_problems_50_per_difficulty(
    client: httpx.AsyncClient,
) -> None:
    listed = (await client.get("/api/problems")).json()
    assert len(listed) == 150
    assert Counter(p["difficulty"] for p in listed) == {d: 50 for d in DIFFICULTIES}


async def test_fr4_every_cell_has_3_to_6_problems_and_each_has_one_category(
    client: httpx.AsyncClient, seeded: asyncpg.Connection
) -> None:
    listed = (await client.get("/api/problems")).json()
    assert len({p["id"] for p in listed}) == 150  # each problem appears once in the list
    cells = Counter((p["category"], p["difficulty"]) for p in listed)
    assert set(cells) <= {(c, d) for c in CATEGORY_IDS for d in DIFFICULTIES}
    for cat in CATEGORY_IDS:
        for dif in DIFFICULTIES:
            assert 3 <= cells[(cat, dif)] <= 6, f"{cat}/{dif} has {cells[(cat, dif)]}"
    assert await seeded.fetchval("select count(*) from problem where category is null") == 0
    assert await seeded.fetchval("select count(*) from problem where difficulty is null") == 0


def test_fr5_nfr1_nfr3_every_reference_passes_its_tests_twice_identically() -> None:
    # seed_check runs each reference twice and compares both runs with each other and `expected`.
    violations = seed_check.check_seed(_folders(), expect_total=True)
    assert violations == []


def _first_of_each_difficulty() -> list[Path]:
    first: dict[str, Path] = {}
    for folder in _folders():
        first.setdefault(_data(folder)["difficulty"], folder)
    return [first[d] for d in DIFFICULTIES]


@pytest.mark.parametrize("folder", _first_of_each_difficulty(), ids=lambda f: f.name)
async def test_fr7_a_reference_is_correct_and_a_mutated_one_is_not(
    seeded: asyncpg.Connection, folder: Path
) -> None:
    data = _data(folder)
    reference = (folder / "reference.py").read_text()
    problem_id = await seeded.fetchval("select id from problem where title = $1", data["title"])
    session_id = await seeded.fetchval(
        "insert into session (invite_id, current_problem_id) values ($1, $2) returning id",
        uuid.uuid4().hex,
        problem_id,
    )
    participant_id = await seeded.fetchval(
        "insert into participant (session_id, display_name) values ($1, 'Ada') returning id",
        session_id,
    )
    name = seed_check.function_name_of(data["signature"])

    good = await service.run(seeded, RUNNER_URL, session_id, problem_id, reference, participant_id)
    assert good.status == "done"
    assert good.accepted is True, f"{folder.name}: reference not accepted"

    # Mutation: the same function, but it returns a wrapper value no test expects.
    mutated = (
        reference
        + f"\n\n_original = {name}\n\ndef {name}(*args):\n    return [_original(*args), 'x']\n"
    )
    bad = await service.run(seeded, RUNNER_URL, session_id, problem_id, mutated, participant_id)
    assert bad.status == "done"
    assert bad.accepted is False
    assert any(r.outcome != "passed" for r in bad.results)


async def test_nfr4_non_editor_list_and_detail_contain_no_tests(
    client: httpx.AsyncClient,
) -> None:
    response = await client.get("/api/problems")
    assert response.status_code == 200
    listed = response.json()
    assert all("tests" not in p and "expected" not in json.dumps(p) for p in listed)
    for item in (listed[0], listed[75], listed[-1]):
        detail = (await client.get(f"/api/problems/{item['id']}")).json()
        assert "tests" not in detail
        assert "expected" not in json.dumps(detail)
