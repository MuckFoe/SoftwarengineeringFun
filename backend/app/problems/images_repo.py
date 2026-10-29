"""Description images repository (spec 002 plan, Data model: `problem_image`).

An image is immutable and addressed by its id. It isn't tied to a problem, so it can be
uploaded before the problem it belongs to exists.
"""

import uuid
from dataclasses import dataclass

import asyncpg


@dataclass(frozen=True)
class StoredImage:
    media_type: str
    data: bytes


async def insert(
    conn: asyncpg.Connection, media_type: str, data: bytes, uploaded_by_sub: str
) -> uuid.UUID:
    return await conn.fetchval(
        """insert into problem_image (media_type, data, uploaded_by_sub)
           values ($1, $2, $3) returning id""",
        media_type,
        data,
        uploaded_by_sub,
    )


async def get(conn: asyncpg.Connection, image_id: uuid.UUID) -> StoredImage | None:
    row = await conn.fetchrow("select media_type, data from problem_image where id = $1", image_id)
    return StoredImage(media_type=row["media_type"], data=row["data"]) if row else None


async def existing_ids(conn: asyncpg.Connection, ids: list[uuid.UUID]) -> set[uuid.UUID]:
    """Which of `ids` are stored images."""
    rows = await conn.fetch("select id from problem_image where id = any($1::uuid[])", ids)
    return {r["id"] for r in rows}
