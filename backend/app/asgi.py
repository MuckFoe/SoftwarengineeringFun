"""ASGI entrypoint for `uvicorn app.asgi:app` (task 37's Dockerfile).

`app` is built on first access: settings are loaded and the database is migrated and
seeded once, before the app (and its own lifespan, which opens the pool it uses while
serving) is created. Tests call `build_app(settings)` instead, so importing this module
has no side effects.
"""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import RedirectResponse
from starlette.routing import Mount, Route
from starlette.types import ASGIApp

from app import db
from app.config import Settings, load_settings
from app.learn.lesson_file import LessonError
from app.learn.loader import load_lessons
from app.main import create_app
from app.problems.seed import load_seed

# backend/app/asgi.py -> backend/app -> backend -> repo root -> seed
SEED_DIR = Path(__file__).resolve().parents[2] / "seed" / "problems"
# Spec 006: lessons/<topic>/<lesson>/lesson.toml, beside seed/ in the repo and the image.
LESSONS_DIR = Path(__file__).resolve().parents[2] / "lessons"


def build_app(settings: Settings) -> ASGIApp:
    """The app at the root, or, with `base_path` set, mounted under it (005 FR1).

    Under a base path, "/collab" redirects to "/collab/" and anything outside is a 404.
    """
    inner = create_app(settings)
    base = settings.base_path
    if not base:
        return inner

    async def _to_slash(request: Request) -> RedirectResponse:
        query = f"?{request.url.query}" if request.url.query else ""
        return RedirectResponse(f"{base}/{query}", status_code=307)

    # A mounted app's lifespan is not run by Starlette, so the outer app runs it.
    @asynccontextmanager
    async def _lifespan(_: Starlette) -> AsyncIterator[None]:
        async with inner.router.lifespan_context(inner):
            yield

    return Starlette(
        routes=[Route(base, _to_slash), Mount(base, app=inner)],
        lifespan=_lifespan,
    )


async def _migrate_and_seed(settings: Settings, *, lessons_dir: Path | None = None) -> None:
    """Migrates, seeds problems, then loads lessons (006 FR-4).

    A bad lesson, or no lessons folder at all, raises `LessonError` naming the file
    relative to the lessons folder's parent, e.g. `lessons/<topic>/<lesson>/lesson.toml`,
    and stores no lesson (FR-5).
    """
    lessons_dir = LESSONS_DIR if lessons_dir is None else lessons_dir
    pool = await db.create_pool(settings.database_url)
    try:
        async with pool.acquire() as conn:
            await db.migrate(conn)
            if SEED_DIR.is_dir():
                await load_seed(conn, SEED_DIR)
            if not lessons_dir.is_dir():
                raise LessonError(Path(lessons_dir.name), "folder not found")
            try:
                await load_lessons(conn, lessons_dir)
            except LessonError as err:
                path = err.path
                if path.is_relative_to(lessons_dir.parent):
                    path = path.relative_to(lessons_dir.parent)
                raise LessonError(path, err.problem) from None
    finally:
        await pool.close()


def _serve() -> ASGIApp:
    settings = load_settings()
    try:
        asyncio.run(_migrate_and_seed(settings))
    except LessonError as err:
        # Refuse to start (006 FR-5): the message, not a traceback, goes to stderr.
        raise SystemExit(str(err)) from None
    return build_app(settings)


def __getattr__(name: str) -> ASGIApp:
    if name == "app":
        app = _serve()
        globals()["app"] = app
        return app
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
