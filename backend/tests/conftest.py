"""Shared fixtures.

Database fixtures are lazy: only tests that request `database_url` or `db` need the
Postgres from `docker-compose.test.yml`; unit tests run without it.

Environment (same names as the compose file):
  TEST_DB_PASSWORD  password of the `postgres` superuser (required for DB tests)
  TEST_DB_HOST      default 127.0.0.1
  TEST_DB_PORT      default 55432
"""

import asyncio
import os
import secrets
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, datetime, timedelta
from urllib.parse import quote

import asyncpg
import pytest

from app import clock


def _server_dsn(database: str) -> str:
    password = os.environ.get("TEST_DB_PASSWORD")
    if not password:
        pytest.fail(
            "TEST_DB_PASSWORD is not set; start the test stack with "
            "`docker compose -f docker-compose.test.yml up -d --wait`",
            pytrace=False,
        )
    host = os.environ.get("TEST_DB_HOST", "127.0.0.1")
    port = os.environ.get("TEST_DB_PORT", "55432")
    return f"postgresql://postgres:{quote(password, safe='')}@{host}:{port}/{database}"


async def _admin(sql: str) -> None:
    conn = await asyncpg.connect(_server_dsn("postgres"))
    try:
        await conn.execute(sql)
    finally:
        await conn.close()


@pytest.fixture(scope="module")
def database_url() -> Iterator[str]:
    """A freshly created, empty database for this test module; dropped afterwards."""
    name = f"test_{secrets.token_hex(8)}"
    asyncio.run(_admin(f'create database "{name}"'))
    try:
        yield _server_dsn(name)
    finally:
        asyncio.run(_admin(f'drop database if exists "{name}" with (force)'))


@pytest.fixture
async def db(database_url: str) -> AsyncIterator[asyncpg.Connection]:
    """A connection to this module's database."""
    conn = await asyncpg.connect(database_url)
    try:
        yield conn
    finally:
        await conn.close()


class FrozenClock:
    """Controls `app.clock.now()` for one test."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch, start: datetime) -> None:
        self._monkeypatch = monkeypatch
        self.set(start)

    def set(self, at: datetime) -> None:
        self._monkeypatch.setattr(clock, "_override", at)

    def advance(self, delta: timedelta) -> None:
        self.set(clock.now() + delta)


@pytest.fixture
def frozen_clock(monkeypatch: pytest.MonkeyPatch) -> FrozenClock:
    """Freezes `clock.now()` at a fixed instant; restored after the test."""
    return FrozenClock(monkeypatch, datetime(2026, 1, 1, tzinfo=UTC))
