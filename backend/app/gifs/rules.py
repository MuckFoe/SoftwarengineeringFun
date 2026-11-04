"""Spec 007: GIF query and result rules (FR-1, FR-2, FR-10, FR-12, NFR-1, NFR-2)."""

from collections.abc import Mapping
from urllib.parse import urlsplit

from app.gifs.models import GifRef

ALLOWED_RATINGS: frozenset[str] = frozenset({"g", "pg", "pg-13"})
REQUEST_RATING = "pg-13"
MAX_QUERY_CHARS = 50
RESULT_LIMIT = 24


def normalise_query(q: str) -> str:
    """Strip surrounding whitespace and clip to MAX_QUERY_CHARS."""
    return q.strip()[:MAX_QUERY_CHARS]


def _media_url(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    parts = urlsplit(value)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return None
    return value


def _positive_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        n = value
    elif isinstance(value, str) and value.isascii() and value.isdigit():
        n = int(value)
    else:
        return None
    return n if n > 0 else None


def parse_result(item: Mapping[str, object]) -> GifRef | None:
    """Map one GIPHY item to a GifRef; None for a disallowed rating or bad media."""
    if item.get("rating") not in ALLOWED_RATINGS:
        return None
    gif_id = item.get("id")
    if not isinstance(gif_id, str) or not gif_id:
        return None
    images = item.get("images")
    if not isinstance(images, Mapping):
        return None
    animated = images.get("fixed_width")
    still = images.get("fixed_width_still")
    if not isinstance(animated, Mapping) or not isinstance(still, Mapping):
        return None
    url = _media_url(animated.get("url"))
    still_url = _media_url(still.get("url"))
    width = _positive_int(animated.get("width"))
    height = _positive_int(animated.get("height"))
    if url is None or still_url is None or width is None or height is None:
        return None
    title = item.get("title")
    return GifRef(
        id=gif_id,
        title=title if isinstance(title, str) else "",
        url=url,
        still_url=still_url,
        width=width,
        height=height,
    )
