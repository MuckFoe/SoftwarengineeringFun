"""Spec 007: GIF search and resolve-for-post (FR-1, FR-2, FR-9, NFR-2, NFR-3).

Each call charges its limiter first, so a refused call makes no request to GIPHY and,
because the limiter does not record refusals, does not count toward the limit.
"""

from collections.abc import Hashable
from enum import StrEnum

from app.gifs.giphy import GifServiceError, GiphyClient
from app.gifs.models import GifRef
from app.gifs.ratelimit import SlidingWindowLimiter
from app.gifs.rules import normalise_query


class GifError(StrEnum):
    UNAVAILABLE = "gif_unavailable"
    RATE_LIMITED = "gif_rate_limited"
    NOT_ALLOWED = "gif_not_allowed"


async def search(
    client: GiphyClient, limiter: SlidingWindowLimiter, key: Hashable, q: str
) -> tuple[bool, list[GifRef]] | tuple[GifError, int | None]:
    """(is_trending, results), or (error, retry_after) where retry_after is set only when
    rate-limited."""
    retry_after = limiter.try_acquire(key)
    if retry_after is not None:
        return GifError.RATE_LIMITED, retry_after
    term = normalise_query(q)
    try:
        if not term:
            return True, await client.trending()
        return False, await client.search(term)
    except GifServiceError:
        return GifError.UNAVAILABLE, None


async def resolve_for_post(
    client: GiphyClient, limiter: SlidingWindowLimiter, key: Hashable, gif_id: str
) -> GifRef | tuple[GifError, int | None]:
    """The GIF to post, or (error, retry_after) where retry_after is set only when
    rate-limited."""
    retry_after = limiter.try_acquire(key)
    if retry_after is not None:
        return GifError.RATE_LIMITED, retry_after
    try:
        gif = await client.get(gif_id)
    except GifServiceError:
        return GifError.UNAVAILABLE, None
    if gif is None:
        return GifError.NOT_ALLOWED, None
    return gif
