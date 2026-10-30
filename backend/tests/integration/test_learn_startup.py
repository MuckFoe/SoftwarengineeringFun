"""Spec 006 task 21: lessons are loaded at startup (`asgi._migrate_and_seed`). FR-4, FR-5."""

from pathlib import Path

import asyncpg
import pytest

from app import asgi
from app.config import Settings
from app.learn.lesson_file import LessonError

FIXTURES = Path(__file__).parent / "fixtures"
VALID = FIXTURES / "lessons_valid"  # 01-docker/{01-basics, 02-ports}
INVALID = FIXTURES / "lessons_invalid"  # 01-basics valid, 02-broken has no correct answer


def _settings(database_url: str) -> Settings:
    return Settings(
        oidc_issuer="http://unused",
        oidc_client_id="unused",
        oidc_client_secret="unused",
        session_cookie_key="unused-session-cookie-key",
        database_url=database_url,
        runner_url="http://unused",
    )


async def _lesson_rows(conn: asyncpg.Connection) -> tuple[int, int, int]:
    return (
        await conn.fetchval("select count(*) from lesson"),
        await conn.fetchval("select count(*) from lesson_version"),
        await conn.fetchval("select count(*) from lesson_asset"),
    )


def test_lessons_dir_defaults_to_the_repo_lessons_folder() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    assert repo_root / "lessons" == asgi.LESSONS_DIR
    assert (asgi.LESSONS_DIR / "01-docker" / "topic.toml").is_file()


async def test_ac5_an_invalid_lesson_stops_startup_naming_the_file_and_stores_nothing(
    database_url: str, db: asyncpg.Connection
) -> None:
    with pytest.raises(LessonError) as raised:
        await asgi._migrate_and_seed(_settings(database_url), lessons_dir=INVALID)

    message = str(raised.value)
    assert message.startswith("lessons_invalid/01-docker/02-broken/lesson.toml: ")
    assert "no correct answer" in message
    assert await _lesson_rows(db) == (0, 0, 0)


async def test_startup_on_the_valid_set_fills_lesson_and_lesson_version(
    database_url: str, db: asyncpg.Connection
) -> None:
    await asgi._migrate_and_seed(_settings(database_url), lessons_dir=VALID)

    rows = await db.fetch("select key, current_version_id from lesson order by key")
    assert [r["key"] for r in rows] == ["01-docker/01-basics", "01-docker/02-ports"]
    assert all(r["current_version_id"] is not None for r in rows)
    assert await db.fetchval("select count(*) from lesson_version") == 2


async def test_a_missing_lessons_folder_stops_startup(
    database_url: str, db: asyncpg.Connection, tmp_path: Path
) -> None:
    before = await _lesson_rows(db)
    with pytest.raises(LessonError) as raised:
        await asgi._migrate_and_seed(_settings(database_url), lessons_dir=tmp_path / "lessons")

    assert str(raised.value) == "lessons: folder not found"
    assert await _lesson_rows(db) == before


def test_serve_exits_the_process_with_the_lesson_error(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fail(_: Settings) -> None:
        raise LessonError(Path("lessons/01-docker/02-broken/lesson.toml"), "no correct answer")

    monkeypatch.setattr(asgi, "load_settings", lambda: _settings("postgresql://unused"))
    monkeypatch.setattr(asgi, "_migrate_and_seed", _fail)

    with pytest.raises(SystemExit) as raised:
        asgi._serve()

    assert raised.value.code == "lessons/01-docker/02-broken/lesson.toml: no correct answer"
