"""Images API (spec 002 plan, Contracts): POST /api/images, GET /api/images/{id}.

FR3, FR4, NFR Security. The upload is the raw request body, read in chunks and cut off
one byte past the limit; its format comes from its magic bytes, never from the declared
Content-Type. Serving is public, like the problem text that references the images.
"""

import uuid
from typing import Annotated

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel

from app.auth.deps import User, require_role
from app.problems import images_repo
from app.problems.api import get_conn
from app.problems.images import MAX_IMAGE_BYTES, sniff_media_type

router = APIRouter(prefix="/api/images")

ACCEPTED_FORMATS = ["png", "jpeg", "gif", "webp"]
SERVE_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'",
    "Content-Disposition": "inline",
    "Cache-Control": "public, max-age=31536000, immutable",
}

Conn = Annotated[asyncpg.Connection, Depends(get_conn)]


class UploadedOut(BaseModel):
    id: uuid.UUID
    url: str


async def _read_capped(request: Request, limit: int) -> bytes | None:
    """The body, or None once it exceeds `limit` bytes (the rest is never read)."""
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > limit:
            return None
    return bytes(data)


@router.post("", status_code=status.HTTP_201_CREATED, response_model=UploadedOut)
async def upload_image(
    request: Request,
    user: Annotated[User, Depends(require_role("editor"))],
    conn: Conn,
) -> UploadedOut:
    data = await _read_capped(request, MAX_IMAGE_BYTES)
    if data is None:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail={"error": "image_too_large", "limit_bytes": MAX_IMAGE_BYTES},
        )
    media_type = sniff_media_type(data)
    if media_type is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail={"error": "image_format", "accepted": ACCEPTED_FORMATS},
        )
    image_id = await images_repo.insert(conn, media_type, data, user.sub)
    return UploadedOut(id=image_id, url=f"/api/images/{image_id}")


@router.get("/{image_id}")
async def get_image(image_id: uuid.UUID, conn: Conn) -> Response:
    image = await images_repo.get(conn, image_id)
    if image is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"error": "not_found"})
    return Response(content=image.data, media_type=image.media_type, headers=SERVE_HEADERS)
