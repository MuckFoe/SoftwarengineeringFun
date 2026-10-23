"""ASGI entrypoint for `uvicorn app.asgi:app` (task 37's Dockerfile).

Migrates and seeds the database once, before the app (and its own lifespan, which opens
the pool it uses while serving) is created.
"""

import asyncio
from pathlib import Path

from app import db
from app.config import load_settings
from app.main import create_app
from app.problems.seed import load_seed

# backend/app/asgi.py -> backend/app -> backend -> repo root -> seed
SEED_DIR = Path(__file__).resolve().parents[2] / "seed" / "problems"

settings = load_settings()


async def _migrate_and_seed() -> None:
    pool = await db.create_pool(settings.database_url)
    try:
        async with pool.acquire() as conn:
            await db.migrate(conn)
            if SEED_DIR.is_dir():
                await load_seed(conn, SEED_DIR)
    finally:
        await pool.close()


asyncio.run(_migrate_and_seed())

app = create_app(settings)
