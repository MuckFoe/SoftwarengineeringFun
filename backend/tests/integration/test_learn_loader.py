"""Spec 006 task 11: the lesson loader (`learn/loader.py`). FR-2, FR-4, FR-5, FR-28."""

import hashlib
import json
from collections.abc import AsyncIterator
from pathlib import Path

import asyncpg
import pytest

from app import db as app_db
from app.learn.lesson_file import LessonError
from app.learn.loader import load_lessons

FIXTURES = Path(__file__).parent / "fixtures"
VALID = FIXTURES / "lessons_valid"  # 01-docker/{01-basics, 02-ports}
ADDED = FIXTURES / "lessons_added"  # VALID + 02-tailscale/01-exit-nodes
CHANGED = FIXTURES / "lessons_changed"  # 01-basics step 2 and image changed; 02-ports gone
INVALID = FIXTURES / "lessons_invalid"  # 01-basics valid, 02-broken has no correct answer

BASICS = "01-docker/01-basics"
PORTS = "01-docker/02-ports"
EXIT_NODES = "02-tailscale/01-exit-nodes"


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    # The database is shared by the module; each test here starts with no lessons.
    await db.execute("truncate lesson, lesson_version, lesson_asset cascade")
    yield db


async def _catalogue(conn: asyncpg.Connection) -> dict[str, asyncpg.Record]:
    rows = await conn.fetch("select key, topic_key, topic_title, current_version_id from lesson")
    return {r["key"]: r for r in rows}


async def _versions(conn: asyncpg.Connection, key: str) -> list[asyncpg.Record]:
    return await conn.fetch(
        "select id, content_hash, content from lesson_version where lesson_key = $1"
        " order by created_at, id",
        key,
    )


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


async def test_loading_the_valid_set_stores_each_lesson_with_a_current_version(
    migrated: asyncpg.Connection,
) -> None:
    await load_lessons(migrated, VALID)

    lessons = await _catalogue(migrated)
    assert set(lessons) == {BASICS, PORTS}
    assert lessons[BASICS]["topic_key"] == "01-docker"
    assert lessons[BASICS]["topic_title"] == "Docker"
    for key in (BASICS, PORTS):
        (version,) = await _versions(migrated, key)
        assert lessons[key]["current_version_id"] == version["id"]


async def test_the_snapshot_is_canonical_json_with_images_as_sha256(
    migrated: asyncpg.Connection,
) -> None:
    await load_lessons(migrated, VALID)

    (version,) = await _versions(migrated, BASICS)
    raw = await migrated.fetchval(
        "select content::text from lesson_version where id = $1", version["id"]
    )
    content = json.loads(raw)
    image_sha = _sha(VALID / BASICS / "layers.png")
    assert content["title"] == "Basics"
    assert content["images"] == {"layers.png": image_sha}
    assert [s["kind"] for s in content["steps"]] == ["explanation", "quiz"]
    assert content["steps"][1]["check"] == {"type": "text", "accept": ["container"]}
    canonical = json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    assert version["content_hash"] == hashlib.sha256(canonical.encode()).hexdigest()

    asset = await migrated.fetchrow(
        "select media_type, data from lesson_asset where sha256 = $1", image_sha
    )
    assert asset["media_type"] == "image/png"
    assert asset["data"] == (VALID / BASICS / "layers.png").read_bytes()


async def test_ac4_a_lesson_added_to_the_folder_is_listed_after_reload(
    migrated: asyncpg.Connection,
) -> None:
    await load_lessons(migrated, VALID)
    await load_lessons(migrated, ADDED)

    lessons = await _catalogue(migrated)
    assert set(lessons) == {BASICS, PORTS, EXIT_NODES}
    assert lessons[EXIT_NODES]["topic_title"] == "Tailscale"
    (version,) = await _versions(migrated, EXIT_NODES)
    assert lessons[EXIT_NODES]["current_version_id"] == version["id"]


async def test_ac5_an_invalid_set_raises_naming_the_file_and_writes_nothing(
    migrated: asyncpg.Connection,
) -> None:
    with pytest.raises(LessonError) as raised:
        await load_lessons(migrated, INVALID)

    assert raised.value.path == INVALID / "01-docker" / "02-broken" / "lesson.toml"
    assert "correct" in raised.value.problem
    counts = await migrated.fetchrow(
        """select (select count(*) from lesson) as lessons,
                  (select count(*) from lesson_version) as versions,
                  (select count(*) from lesson_asset) as assets"""
    )
    assert dict(counts) == {"lessons": 0, "versions": 0, "assets": 0}


async def test_ac5_an_invalid_set_leaves_an_earlier_load_untouched(
    migrated: asyncpg.Connection,
) -> None:
    await load_lessons(migrated, VALID)
    before = await _catalogue(migrated)

    with pytest.raises(LessonError):
        await load_lessons(migrated, INVALID)

    assert await _catalogue(migrated) == before
    assert await migrated.fetchval("select count(*) from lesson_version") == 2


async def test_fr28_reloading_an_unchanged_set_inserts_no_new_version(
    migrated: asyncpg.Connection,
) -> None:
    await load_lessons(migrated, VALID)
    before = await _catalogue(migrated)
    await load_lessons(migrated, VALID)

    assert await _catalogue(migrated) == before
    assert await migrated.fetchval("select count(*) from lesson_version") == 2
    assert await migrated.fetchval("select count(*) from lesson_asset") == 1


async def test_fr28_a_changed_step_adds_a_version_and_the_old_one_and_its_assets_remain(
    migrated: asyncpg.Connection,
) -> None:
    await load_lessons(migrated, VALID)
    (first,) = await _versions(migrated, BASICS)

    await load_lessons(migrated, CHANGED)

    versions = await _versions(migrated, BASICS)
    assert [v["id"] for v in versions][0] == first["id"]
    assert len(versions) == 2
    second = versions[1]
    assert second["content_hash"] != first["content_hash"]
    assert (await _catalogue(migrated))[BASICS]["current_version_id"] == second["id"]
    old_sha = _sha(VALID / BASICS / "layers.png")
    new_sha = _sha(CHANGED / BASICS / "layers.png")
    assets = {r["sha256"] for r in await migrated.fetch("select sha256 from lesson_asset")}
    assert assets == {old_sha, new_sha}
    assert json.loads(first["content"])["images"] == {"layers.png": old_sha}


async def test_fr28_a_removed_lesson_is_unlisted_but_its_versions_remain(
    migrated: asyncpg.Connection,
) -> None:
    await load_lessons(migrated, VALID)
    (version,) = await _versions(migrated, PORTS)

    await load_lessons(migrated, CHANGED)

    lessons = await _catalogue(migrated)
    assert lessons[PORTS]["current_version_id"] is None
    assert [v["id"] for v in await _versions(migrated, PORTS)] == [version["id"]]


async def test_fr28_a_lesson_that_comes_back_points_at_its_matching_version_again(
    migrated: asyncpg.Connection,
) -> None:
    await load_lessons(migrated, VALID)
    (version,) = await _versions(migrated, PORTS)
    await load_lessons(migrated, CHANGED)
    await load_lessons(migrated, VALID)

    assert (await _catalogue(migrated))[PORTS]["current_version_id"] == version["id"]
    assert len(await _versions(migrated, PORTS)) == 1
