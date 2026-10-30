"""Spec 006 task 24: REST `/api/learn` (topics, start, state, record, assets).

FR-2, FR-4, FR-6, FR-26, FR-27; AC-2, AC-4, AC-6, AC-13. The catalogue is the real `lessons/`
folder, loaded the way startup loads it. A second lesson with an image is stored by hand as
a *removed* lesson (no current version), the way the loader leaves a lesson whose folder is
gone: sessions on it still work and its assets are still served.
"""

import dataclasses
import hashlib
import json
import re
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

import asyncpg
import pytest
from fastapi.routing import iter_route_contexts
from fastapi.testclient import TestClient

from app import asgi
from app import db as app_db
from app.config import Settings
from app.learn import repo as learn_repo
from app.learn import service as learn_service
from app.learn.lesson_file import Lesson, Step, TextCheck, parse_lesson, parse_topic
from app.learn.loader import load_lessons
from app.main import create_app
from app.problems import repo as problems_repo
from app.problems.signature import TestInput, parse_signature
from tests.integration.keycloak_fixtures import (  # noqa: F401  (pytest fixtures)
    Keycloak,
    keycloak,
    login_as,
)

COOKIE_KEY = "test-session-cookie-key"  # noqa: S105  (placeholder, not a real secret)
APP_DIR = Path(__file__).resolve().parents[2] / "app"
PNG = (
    Path(__file__).parent / "fixtures" / "lessons_valid" / "01-docker" / "01-basics" / "layers.png"
)
REMOVED_KEY = "99-gone/01-pictures"
SECRET = "zebra-secret-answer"


def _settings(kc: Keycloak, database_url: str) -> Settings:
    return Settings(
        oidc_issuer=kc.issuer,
        oidc_client_id=kc.client_id,
        oidc_client_secret=kc.client_secret,
        session_cookie_key=COOKIE_KEY,
        database_url=database_url,
        runner_url="http://unused",
    )


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    await load_lessons(db, asgi.LESSONS_DIR)
    yield db


@pytest.fixture
async def client(
    keycloak: Keycloak,  # noqa: F811
    database_url: str,
    migrated: asyncpg.Connection,
) -> AsyncIterator[TestClient]:
    with TestClient(create_app(_settings(keycloak, database_url))) as test_client:
        yield test_client


PICTURES = Lesson(
    title="Pictures",
    summary="A lesson with an image.",
    minutes=5,
    images=("layers.png",),
    steps=(
        Step(
            kind="explanation",
            title="Look",
            body="Layers: ![layers](layers.png)",
            hint=None,
            check=None,
        ),
        Step(
            kind="quiz",
            title="Name it",
            body="What is it?",
            hint="Stripes.",
            check=TextCheck(accept=(SECRET,)),
        ),
    ),
)


async def _removed_lesson_with_image(conn: asyncpg.Connection) -> tuple[uuid.UUID, str]:
    """A lesson version with an image whose lesson has no current version (removed)."""
    data = PNG.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    await conn.execute(
        """insert into lesson_asset (sha256, media_type, data) values ($1, 'image/png', $2)
           on conflict (sha256) do nothing""",
        sha,
        data,
    )
    content = json.dumps({**dataclasses.asdict(PICTURES), "images": {"layers.png": sha}})
    version_id = await conn.fetchval(
        """insert into lesson_version (lesson_key, content_hash, content)
           values ($1, $2, $3::jsonb)
           on conflict (lesson_key, content_hash) do update set content = excluded.content
           returning id""",
        REMOVED_KEY,
        hashlib.sha256(content.encode()).hexdigest(),
        content,
    )
    await conn.execute(
        """insert into lesson (key, topic_key, topic_title, current_version_id)
           values ($1, '99-gone', 'Gone', null) on conflict (key) do nothing""",
        REMOVED_KEY,
    )
    return version_id, sha


async def _session_on(
    conn: asyncpg.Connection, version_id: uuid.UUID
) -> learn_repo.LearningSession:
    session = await learn_repo.create_session(conn, version_id)
    await learn_repo.ensure_step(conn, session.id, 0)
    return session


# --- FR-2 / AC-2 --------------------------------------------------------------------------


def _expected_catalogue() -> list[dict]:
    topics = []
    for topic_dir in sorted(p for p in asgi.LESSONS_DIR.iterdir() if p.is_dir()):
        lessons = []
        for lesson_dir in sorted(p for p in topic_dir.iterdir() if p.is_dir()):
            lesson = parse_lesson(lesson_dir)
            lessons.append(
                {
                    "key": f"{topic_dir.name}/{lesson_dir.name}",
                    "title": lesson.title,
                    "summary": lesson.summary,
                    "step_count": len(lesson.steps),
                    "minutes": lesson.minutes,
                }
            )
        topics.append(
            {"key": topic_dir.name, "title": parse_topic(topic_dir).title, "lessons": lessons}
        )
    return topics


async def test_ac2_topics_lists_docker_and_tailscale_with_their_lessons(
    client: TestClient,
) -> None:
    response = client.get("/api/learn/topics")

    assert response.status_code == 200
    body = response.json()
    assert body == _expected_catalogue()
    assert [t["title"] for t in body] == ["Docker", "Tailscale"]
    for topic in body:
        assert topic["lessons"]
        for lesson in topic["lessons"]:
            assert lesson["title"] and lesson["summary"]
            assert lesson["step_count"] > 0 and lesson["minutes"] > 0


async def test_topics_leave_out_a_removed_lesson(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    await _removed_lesson_with_image(migrated)

    body = client.get("/api/learn/topics").json()

    keys = [lesson["key"] for topic in body for lesson in topic["lessons"]]
    assert REMOVED_KEY not in keys
    assert "99-gone" not in [t["key"] for t in body]


# --- FR-4 / AC-4 --------------------------------------------------------------------------


async def test_ac4_no_route_can_create_or_change_a_lesson(client: TestClient) -> None:
    # `iter_route_contexts` flattens included routers (`app.routes` alone would not).
    learn_routes = [
        (context.path, set(context.methods or ()))
        for context in iter_route_contexts(client.app.routes)  # type: ignore[attr-defined]
        if context.path.startswith("/api/learn/")
    ]
    assert {path for path, _ in learn_routes} >= {
        "/api/learn/topics",
        "/api/learn/assets/{sha256}",
    }
    for path, methods in learn_routes:
        if path.startswith(("/api/learn/topics", "/api/learn/assets")):
            assert methods and methods <= {"GET", "HEAD"}, path


def test_ac4_only_the_startup_loader_writes_lesson_tables() -> None:
    writes = re.compile(
        r"\b(insert\s+into|update|delete\s+from)\s+lesson(_version|_asset)?\b", re.IGNORECASE
    )
    writers = sorted(
        str(path.relative_to(APP_DIR))
        for path in APP_DIR.rglob("*.py")
        if writes.search(path.read_text())
    )
    assert writers == ["learn/loader.py"]


# --- FR-6 / AC-6 --------------------------------------------------------------------------


async def test_ac6_anonymous_start_gives_201_and_a_session_at_step_0(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    first = client.post("/api/learn/sessions", json={"lesson_key": "01-docker/01-basics"})
    second = client.post("/api/learn/sessions", json={"lesson_key": "01-docker/01-basics"})

    assert first.status_code == 201
    assert second.status_code == 201
    assert set(first.json()) == {"invite_id"}
    invite = first.json()["invite_id"]
    assert invite != second.json()["invite_id"]
    session = await learn_repo.get_session_by_invite(migrated, invite)
    assert session is not None
    assert session.current_step == 0
    assert client.get(f"/api/learn/sessions/{invite}").json() == {"state": "active"}


async def test_ac6_unknown_or_removed_lesson_gives_404(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    await _removed_lesson_with_image(migrated)

    unknown = client.post("/api/learn/sessions", json={"lesson_key": "01-docker/99-nope"})
    removed = client.post("/api/learn/sessions", json={"lesson_key": REMOVED_KEY})

    assert unknown.status_code == 404
    assert unknown.json() == {"error": "not_found"}
    assert removed.status_code == 404
    assert removed.json() == {"error": "not_found"}


async def test_ac6_parity_anonymous_coding_sessions_are_allowed_too(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    problem_id = await problems_repo.create(
        migrated,
        title="Sum two",
        description="d",
        sig=parse_signature("def add(a: int, b: int) -> int"),
        tests=[TestInput(args=[2, 3], expected=5)],
        created_by_sub=None,
        created_by_name=None,
    )

    response = client.post("/api/sessions", json={"problem_id": str(problem_id)})

    assert response.status_code == 201


# --- session state (FR-26, FR-27) ---------------------------------------------------------


async def test_unknown_invite_gives_404_for_state_and_record(client: TestClient) -> None:
    for path in ("/api/learn/sessions/no-such-invite", "/api/learn/sessions/no-such/record"):
        response = client.get(path)
        assert response.status_code == 404
        assert response.json() == {"error": "not_found"}


async def test_a_completed_session_gives_state_completed(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    version_id, _ = await _removed_lesson_with_image(migrated)
    session = await _session_on(migrated, version_id)
    await migrated.execute(
        "update learning_session set completed_at = now(), current_step = 2 where id = $1",
        session.id,
    )

    response = client.get(f"/api/learn/sessions/{session.invite_id}")

    assert response.status_code == 200
    assert response.json() == {"state": "completed"}


async def test_a_stale_session_gives_423_and_can_reactivate_false_when_anonymous(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    version_id, _ = await _removed_lesson_with_image(migrated)
    session = await _session_on(migrated, version_id)
    await migrated.execute("update learning_session set stale_at = now() where id = $1", session.id)

    response = client.get(f"/api/learn/sessions/{session.invite_id}")

    assert response.status_code == 423
    assert response.json() == {"error": "stale", "can_reactivate": False}
    record = client.get(f"/api/learn/sessions/{session.invite_id}/record")
    assert record.status_code == 200
    assert record.json()["stale"] is True


async def test_a_stale_session_gives_can_reactivate_true_to_an_admin(
    client: TestClient,
    migrated: asyncpg.Connection,
    login_as,  # noqa: F811
) -> None:
    version_id, _ = await _removed_lesson_with_image(migrated)
    session = await _session_on(migrated, version_id)
    await migrated.execute("update learning_session set stale_at = now() where id = $1", session.id)
    login_as(client, "admin1")

    response = client.get(f"/api/learn/sessions/{session.invite_id}")

    assert response.status_code == 423
    assert response.json() == {"error": "stale", "can_reactivate": True}


# --- record (FR-26, AC-13) and assets -----------------------------------------------------


async def test_record_has_outline_current_step_passed_and_current_steps_and_no_answers(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    version_id, _ = await _removed_lesson_with_image(migrated)
    session = await _session_on(migrated, version_id)
    participant = await learn_service.join(migrated, session.id, "Ada")
    await learn_service.continue_(migrated, session.id, participant.id, "Ada", 0)

    response = client.get(f"/api/learn/sessions/{session.invite_id}/record")

    assert response.status_code == 200
    body = response.json()
    assert body["lesson"] == {
        "key": REMOVED_KEY,
        "title": "Pictures",
        "topic": "Gone",
        "steps": [
            {"position": 0, "title": "Look", "kind": "explanation"},
            {"position": 1, "title": "Name it", "kind": "quiz"},
        ],
    }
    assert body["current_step"] == 1
    assert body["completed"] is False
    assert body["stale"] is False
    assert [s["position"] for s in body["steps"]] == [0, 1]
    assert body["steps"][0]["passed"]["by"] == "Ada"
    assert body["steps"][1]["passed"] is None
    assert body["steps"][1]["answer"] is None
    assert body["steps"][1]["hint_html"] is None
    assert SECRET not in response.text  # AC-13
    assert "Stripes" not in response.text


async def test_an_asset_referenced_by_a_lesson_is_served_immutable(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    version_id, sha = await _removed_lesson_with_image(migrated)
    session = await _session_on(migrated, version_id)
    record = client.get(f"/api/learn/sessions/{session.invite_id}/record").json()
    src = re.search(r'<img[^>]*src="([^"]+)"', record["steps"][0]["body_html"])
    assert src is not None
    assert src.group(1) == f"/api/learn/assets/{sha}"

    response = client.get(src.group(1))

    assert response.status_code == 200
    assert response.content == PNG.read_bytes()
    assert response.headers["content-type"] == "image/png"
    assert "immutable" in response.headers["cache-control"]


async def test_an_unknown_asset_gives_404(client: TestClient) -> None:
    response = client.get("/api/learn/assets/" + "0" * 64)

    assert response.status_code == 404
    assert response.json() == {"error": "not_found"}
