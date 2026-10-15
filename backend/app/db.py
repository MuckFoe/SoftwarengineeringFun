"""asyncpg pool and a minimal SQL migration runner.

Migrations are the numbered `.sql` files in `migrations/`, applied in name order, each
once, inside its own transaction, and recorded in `schema_migration`.
"""

from pathlib import Path

import asyncpg

MIGRATIONS_DIR = Path(__file__).parent / "migrations"

# Serialises concurrent migrators (e.g. two api processes starting at once).
_LOCK_KEY = 0x5C4E_3A01


async def create_pool(dsn: str) -> asyncpg.Pool:
    return await asyncpg.create_pool(dsn)


def _read_migrations(migrations_dir: Path) -> list[tuple[str, str]]:
    # Small files read once at startup; blocking I/O here is acceptable.
    return [(p.name, p.read_text()) for p in sorted(migrations_dir.glob("[0-9]*.sql"))]


async def migrate(conn: asyncpg.Connection, migrations_dir: Path = MIGRATIONS_DIR) -> list[str]:
    """Apply every not-yet-applied migration; return the names applied by this call."""
    migrations = _read_migrations(migrations_dir)
    applied_now: list[str] = []
    async with conn.transaction():
        await conn.execute("select pg_advisory_xact_lock($1)", _LOCK_KEY)
        await conn.execute(
            """create table if not exists schema_migration (
                   name text primary key,
                   applied_at timestamptz not null default now()
               )"""
        )
        done = {r["name"] for r in await conn.fetch("select name from schema_migration")}
        for name, sql in migrations:
            if name in done:
                continue
            await conn.execute(sql)
            await conn.execute("insert into schema_migration (name) values ($1)", name)
            applied_now.append(name)
    return applied_now
