"""Spec 018 tasks 6 and 7: the problem list filters, order and fields, the categories
endpoint, and category/difficulty on create and update. FR-4, FR-9, FR-10, FR-11, FR-13,
FR-14, NFR-4.

The router is mounted on a bare app with the database dependency pointed at the test
database, so these tests need PostgreSQL only (no Keycloak). The role dependency is
overridden for the editor-only routes; the list routes are exercised with no user at all,
which is the guest/invitee case (FR-14).
"""

from collections.abc import AsyncIterator
from types import SimpleNamespace

import asyncpg
import httpx
import pytest
from fastapi import FastAPI

from app import db as app_db
from app.auth.deps import User
from app.problems import api as problems_api
from app.problems.categories import CATEGORY_IDS

EDITOR = User(sub="editor-1", name="Edith", roles=["editor"])
SIG = "def add(a: int, b: int) -> int"


@pytest.fixture
async def conn(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    await db.execute("truncate problem, problem_test cascade")
    yield db


@pytest.fixture
async def client(conn: asyncpg.Connection) -> AsyncIterator[httpx.AsyncClient]:
    app = FastAPI()
    app.include_router(problems_api.router)
    app.state.settings = SimpleNamespace(base_path="")

    async def _conn() -> AsyncIterator[asyncpg.Connection]:
        yield conn

    app.dependency_overrides[problems_api.get_conn] = _conn
    # `require_role` returns a new closure per call, so override each one the routes hold.
    for route in problems_api.router.routes:
        for dep in route.dependant.dependencies:  # type: ignore[attr-defined]
            if dep.call is not None and dep.call.__qualname__.startswith("require_role"):
                app.dependency_overrides[dep.call] = lambda: EDITOR
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


async def _add(
    conn: asyncpg.Connection,
    title: str,
    category: str | None,
    difficulty: str | None,
    description: str = "d",
) -> None:
    await conn.execute(
        """insert into problem (title, description, signature, function_name, params,
                                return_type, is_starter, category, difficulty)
           values ($1, $2, $3, 'add', '[]', 'int', true, $4, $5)""",
        title,
        description,
        SIG,
        category,
        difficulty,
    )


@pytest.fixture
async def mixed(conn: asyncpg.Connection) -> None:
    await _add(conn, "Zed array", "arrays", "easy")
    await _add(conn, "Alpha array", "arrays", "easy", description="mentions needle")
    await _add(conn, "Hard array", "arrays", "hard")
    await _add(conn, "Medium array", "arrays", "medium")
    await _add(conn, "String easy", "strings", "easy")
    await _add(conn, "String hard", "strings", "hard")
    await _add(conn, "Graph medium", "graphs-trees", "medium")
    await _add(conn, "No category", None, "easy")
    await _add(conn, "No difficulty", "arrays", None)


async def _titles(client: httpx.AsyncClient, **params: str) -> list[str]:
    response = await client.get("/api/problems", params=params)
    assert response.status_code == 200, response.text
    return [p["title"] for p in response.json()]


async def test_fr10_filter_by_category(client: httpx.AsyncClient, mixed: None) -> None:
    got = await client.get("/api/problems", params={"category": "strings"})
    assert {p["title"] for p in got.json()} == {"String easy", "String hard"}
    assert all(p["category"] == "strings" for p in got.json())


async def test_fr10_filter_by_difficulty(client: httpx.AsyncClient, mixed: None) -> None:
    got = await client.get("/api/problems", params={"difficulty": "hard"})
    assert {p["title"] for p in got.json()} == {"Hard array", "String hard"}


async def test_fr10_filters_combine_with_each_other_and_with_search(
    client: httpx.AsyncClient, mixed: None
) -> None:
    both = await client.get("/api/problems", params={"category": "arrays", "difficulty": "easy"})
    assert {p["title"] for p in both.json()} == {"Zed array", "Alpha array"}
    assert all(p["category"] == "arrays" and p["difficulty"] == "easy" for p in both.json())

    narrowed = await _titles(client, category="arrays", difficulty="easy", q="needle")
    assert narrowed == ["Alpha array"]
    assert await _titles(client, category="strings", q="needle") == []


async def test_fr10_an_invalid_filter_value_is_422_naming_the_parameter(
    client: httpx.AsyncClient, mixed: None
) -> None:
    for name, value in (("category", "nope"), ("difficulty", "brutal")):
        response = await client.get("/api/problems", params={name: value})
        assert response.status_code == 422
        assert response.json()["detail"]["field"] == name


async def test_fr11_order_is_category_then_difficulty_then_title_nulls_last(
    client: httpx.AsyncClient, mixed: None
) -> None:
    assert await _titles(client) == [
        "Alpha array",
        "Zed array",
        "Medium array",
        "Hard array",
        "No difficulty",
        "String easy",
        "String hard",
        "Graph medium",
        "No category",
    ]


async def test_fr9_items_carry_category_and_difficulty_and_never_tests(
    client: httpx.AsyncClient, mixed: None
) -> None:
    items = (await client.get("/api/problems", params={"q": "Graph"})).json()
    assert items == [
        {
            "id": items[0]["id"],
            "title": "Graph medium",
            "is_starter": True,
            "category": "graphs-trees",
            "difficulty": "medium",
        }
    ]
    other = (await client.get("/api/problems", params={"q": "No category"})).json()[0]
    assert other["category"] is None


async def test_fr9_the_detail_response_has_no_tests(client: httpx.AsyncClient, mixed: None) -> None:
    listed = (await client.get("/api/problems")).json()[0]
    detail = (await client.get(f"/api/problems/{listed['id']}")).json()
    assert "tests" not in detail
    assert "tests" not in listed


async def test_fr14_the_categories_endpoint_lists_all_eleven_in_order_without_a_user(
    client: httpx.AsyncClient, mixed: None
) -> None:
    response = await client.get("/api/problems/categories")

    assert response.status_code == 200
    body = response.json()
    assert [c["id"] for c in body] == CATEGORY_IDS
    assert len(body) == 11
    assert body[0] == {"id": "arrays", "label": "Arrays"}
    assert body[2]["label"] == "Hash maps & sets"


async def test_fr14_the_list_needs_no_user_so_a_guest_gets_the_same_results(
    client: httpx.AsyncClient, mixed: None
) -> None:
    # No session, no override of the editor role: exactly a guest's request.
    assert len(await _titles(client, category="arrays")) == 5


def _body(**extra: object) -> dict:
    return {
        "title": "New one",
        "description": "Add them.",
        "signature": SIG,
        "tests": [{"args": [1, 2], "expected": 3}],
        **extra,
    }


async def test_fr13_create_with_category_and_difficulty_lists_under_them(
    client: httpx.AsyncClient, conn: asyncpg.Connection
) -> None:
    response = await client.post(
        "/api/problems", json=_body(category="math-bits", difficulty="hard")
    )

    assert response.status_code == 201
    got = (await client.get("/api/problems", params={"category": "math-bits"})).json()
    assert [(p["title"], p["difficulty"]) for p in got] == [("New one", "hard")]


async def test_fr13_create_without_them_stores_null(
    client: httpx.AsyncClient, conn: asyncpg.Connection
) -> None:
    await client.post("/api/problems", json=_body())

    got = (await client.get("/api/problems")).json()
    assert got[0]["category"] is None
    assert got[0]["difficulty"] is None


async def test_fr13_an_invalid_category_or_difficulty_is_refused_naming_the_field(
    client: httpx.AsyncClient, conn: asyncpg.Connection
) -> None:
    for field, value in (("category", "nope"), ("difficulty", "brutal")):
        response = await client.post("/api/problems", json=_body(**{field: value}))
        assert response.status_code == 422
        assert response.json()["detail"]["errors"][0]["field"] == field
    assert await conn.fetchval("select count(*) from problem") == 0


async def test_fr13_update_sets_category_and_omitting_it_leaves_it_unchanged(
    client: httpx.AsyncClient, conn: asyncpg.Connection
) -> None:
    created = await client.post("/api/problems", json=_body(category="arrays", difficulty="easy"))
    pid = created.json()["id"]

    changed = await client.put(f"/api/problems/{pid}", json=_body(category="strings"))
    assert changed.status_code == 200
    row = await conn.fetchrow("select category, difficulty from problem")
    assert (row["category"], row["difficulty"]) == ("strings", "easy")

    untouched = await client.put(f"/api/problems/{pid}", json=_body(title="Renamed"))
    assert untouched.status_code == 200
    row = await conn.fetchrow("select category, difficulty, title from problem")
    assert (row["category"], row["difficulty"], row["title"]) == ("strings", "easy", "Renamed")


async def test_fr13_update_with_an_invalid_category_is_refused_and_changes_nothing(
    client: httpx.AsyncClient, conn: asyncpg.Connection
) -> None:
    pid = (await client.post("/api/problems", json=_body(category="arrays"))).json()["id"]

    response = await client.put(f"/api/problems/{pid}", json=_body(title="X", category="nope"))

    assert response.status_code == 422
    assert response.json()["detail"]["errors"][0]["field"] == "category"
    assert await conn.fetchval("select title from problem") == "New one"


async def test_fr13_the_edit_response_carries_category_and_difficulty(
    client: httpx.AsyncClient, conn: asyncpg.Connection
) -> None:
    await _add(conn, "Edit me", "strings", "hard")
    await _add(conn, "Edit bare", None, None)
    listed = {p["title"]: p["id"] for p in (await client.get("/api/problems")).json()}
    got = (await client.get(f"/api/problems/{listed['Edit me']}/edit")).json()
    assert (got["category"], got["difficulty"]) == ("strings", "hard")
    bare = (await client.get(f"/api/problems/{listed['Edit bare']}/edit")).json()
    assert (bare["category"], bare["difficulty"]) == (None, None)
