"""Lesson loader (spec 006 plan, Wiring and Versioning). FR-2, FR-4, FR-5, FR-28.

Reads `lessons/<topic>/<lesson>/lesson.toml` at startup. A lesson's key is
`<topic folder>/<lesson folder>`; folder-name order is listing order. Every file is parsed
before anything is written, so one bad lesson raises its `LessonError` and leaves the
database as it was (FR-5).

Each lesson becomes a snapshot: the parsed lesson as canonical JSON, with its `images` list
replaced by `{file name: SHA-256 of the file}`. The snapshot's SHA-256 is its content hash; a
`lesson_version` is inserted only when `(lesson_key, content_hash)` is new. Images are stored
content-addressed in `lesson_asset`, so an old version's images stay served after a file
changes. Lessons whose folder is gone keep their versions but lose `current_version_id`
(FR-28). Nothing is deleted.
"""

import dataclasses
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import asyncpg

from app.learn.lesson_file import Lesson, LessonError, parse_lesson, parse_topic
from app.problems.images import sniff_media_type


@dataclass(frozen=True)
class _Asset:
    sha256: str
    media_type: str
    data: bytes


@dataclass(frozen=True)
class _Snapshot:
    key: str
    topic_key: str
    topic_title: str
    content: str  # canonical JSON
    content_hash: str
    assets: tuple[_Asset, ...]


def _folders(parent: Path) -> list[Path]:
    return sorted(p for p in parent.iterdir() if p.is_dir() and not p.name.startswith((".", "_")))


def _snapshot(
    key: str, topic_key: str, topic_title: str, folder: Path, lesson: Lesson
) -> _Snapshot:
    assets = []
    images = {}
    for name in lesson.images:
        data = (folder / name).read_bytes()
        sha = hashlib.sha256(data).hexdigest()
        media_type = sniff_media_type(data)
        if media_type is None:  # parse_lesson has checked it; only a race could get here
            raise LessonError(folder / name, "is not a PNG, JPEG, GIF or WebP")
        assets.append(_Asset(sha256=sha, media_type=media_type, data=data))
        images[name] = sha
    content = {**dataclasses.asdict(lesson), "images": images}
    canonical = json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return _Snapshot(
        key=key,
        topic_key=topic_key,
        topic_title=topic_title,
        content=canonical,
        content_hash=hashlib.sha256(canonical.encode()).hexdigest(),
        assets=tuple(assets),
    )


def _read_lessons(lessons_dir: Path) -> list[_Snapshot]:
    """Parses and snapshots every lesson in folder-name order. Raises the first LessonError."""
    # Small files read once at startup; blocking I/O here is acceptable.
    snapshots = []
    for topic_folder in _folders(lessons_dir):
        topic = parse_topic(topic_folder)
        for lesson_folder in _folders(topic_folder):
            lesson = parse_lesson(lesson_folder)
            key = f"{topic_folder.name}/{lesson_folder.name}"
            snapshots.append(_snapshot(key, topic_folder.name, topic.title, lesson_folder, lesson))
    return snapshots


async def load_lessons(conn: asyncpg.Connection, lessons_dir: Path) -> int:
    """Stores the lessons under `lessons_dir`. Returns how many new versions were inserted."""
    snapshots = _read_lessons(lessons_dir)
    inserted = 0
    async with conn.transaction():
        for snap in snapshots:
            for asset in snap.assets:
                await conn.execute(
                    """insert into lesson_asset (sha256, media_type, data) values ($1, $2, $3)
                       on conflict (sha256) do nothing""",
                    asset.sha256,
                    asset.media_type,
                    asset.data,
                )
            version_id = await conn.fetchval(
                """insert into lesson_version (lesson_key, content_hash, content)
                   values ($1, $2, $3::jsonb)
                   on conflict (lesson_key, content_hash) do nothing
                   returning id""",
                snap.key,
                snap.content_hash,
                snap.content,
            )
            if version_id is None:
                version_id = await conn.fetchval(
                    "select id from lesson_version where lesson_key = $1 and content_hash = $2",
                    snap.key,
                    snap.content_hash,
                )
            else:
                inserted += 1
            await conn.execute(
                """insert into lesson (key, topic_key, topic_title, current_version_id)
                   values ($1, $2, $3, $4)
                   on conflict (key) do update set topic_key = excluded.topic_key,
                       topic_title = excluded.topic_title,
                       current_version_id = excluded.current_version_id""",
                snap.key,
                snap.topic_key,
                snap.topic_title,
                version_id,
            )
        await conn.execute(
            "update lesson set current_version_id = null where not (key = any($1::text[]))",
            [snap.key for snap in snapshots],
        )
    return inserted
