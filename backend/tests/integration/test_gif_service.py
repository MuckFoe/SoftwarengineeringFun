"""`gifs.service` search and resolve-for-post against the fake GIPHY (007 task 13).

FR-2, FR-9, NFR-2, NFR-3. The limiter is the real one with an injected clock; the
fake GIPHY is a real HTTP server on a local port.
"""

from collections.abc import AsyncIterator

import pytest

from app.gifs import service
from app.gifs.giphy import GiphyClient
from app.gifs.models import GifRef
from app.gifs.ratelimit import POSTS_PER_MINUTE, SEARCHES_PER_MINUTE, SlidingWindowLimiter
from app.gifs.service import GifError
from tests.fakes.fake_giphy import CAT_IDS, GONE_ID, R_RATED_ID, TRENDING_IDS, FakeGiphy

API_KEY = "test-key-not-secret"
ADA = ("S", "Ada")
BEN = ("S", "Ben")


def _frozen_clock() -> float:
    return 1000.0


def _search_limiter() -> SlidingWindowLimiter:
    return SlidingWindowLimiter(SEARCHES_PER_MINUTE, 60, _frozen_clock)


def _post_limiter() -> SlidingWindowLimiter:
    return SlidingWindowLimiter(POSTS_PER_MINUTE, 60, _frozen_clock)


@pytest.fixture
async def client(fake_giphy: FakeGiphy) -> AsyncIterator[GiphyClient]:
    c = GiphyClient(fake_giphy.base_url, API_KEY)
    try:
        yield c
    finally:
        await c.aclose()


@pytest.fixture
async def keyless_client(fake_giphy: FakeGiphy) -> AsyncIterator[GiphyClient]:
    c = GiphyClient(fake_giphy.base_url, None)
    try:
        yield c
    finally:
        await c.aclose()


def _ids(gifs: list[GifRef]) -> list[str]:
    return [g.id for g in gifs]


# -- FR-2: empty term shows trending; a term shows its matches ---------------------------


async def test_blank_term_returns_trending(client: GiphyClient, fake_giphy: FakeGiphy) -> None:
    trending, results = await service.search(client, _search_limiter(), ADA, "  ")

    assert trending is True
    assert _ids(results) == list(TRENDING_IDS)  # type: ignore[arg-type]
    assert [r.path for r in fake_giphy.requests] == ["/v1/gifs/trending"]


async def test_term_returns_its_matches(client: GiphyClient, fake_giphy: FakeGiphy) -> None:
    trending, results = await service.search(client, _search_limiter(), ADA, "cat")

    assert trending is False
    assert _ids(results) == [i for i in CAT_IDS if i != R_RATED_ID]  # type: ignore[arg-type]
    assert [r.path for r in fake_giphy.requests] == ["/v1/gifs/search"]


# -- FR-9: service unreachable or no key → unavailable ----------------------------------


async def test_search_unreachable_is_unavailable(
    client: GiphyClient, fake_giphy: FakeGiphy
) -> None:
    fake_giphy.refuse_connections()

    assert await service.search(client, _search_limiter(), ADA, "cat") == (
        GifError.UNAVAILABLE,
        None,
    )


async def test_search_server_error_is_unavailable(
    client: GiphyClient, fake_giphy: FakeGiphy
) -> None:
    fake_giphy.fail_with(500)

    assert await service.search(client, _search_limiter(), ADA, "") == (
        GifError.UNAVAILABLE,
        None,
    )


async def test_search_without_key_is_unavailable_and_sends_nothing(
    keyless_client: GiphyClient, fake_giphy: FakeGiphy
) -> None:
    assert await service.search(keyless_client, _search_limiter(), ADA, "cat") == (
        GifError.UNAVAILABLE,
        None,
    )
    assert await service.search(keyless_client, _search_limiter(), ADA, "") == (
        GifError.UNAVAILABLE,
        None,
    )
    assert fake_giphy.requests == []


async def test_post_unreachable_is_unavailable(client: GiphyClient, fake_giphy: FakeGiphy) -> None:
    fake_giphy.refuse_connections()

    assert await service.resolve_for_post(client, _post_limiter(), ADA, "cat-1") == (
        GifError.UNAVAILABLE,
        None,
    )


async def test_post_without_key_is_unavailable_and_sends_nothing(
    keyless_client: GiphyClient, fake_giphy: FakeGiphy
) -> None:
    assert await service.resolve_for_post(keyless_client, _post_limiter(), ADA, "cat-1") == (
        GifError.UNAVAILABLE,
        None,
    )
    assert fake_giphy.requests == []


# -- NFR-3: 21st search / 6th post refused, others unaffected ---------------------------


async def test_21st_search_is_rate_limited_without_a_request(
    client: GiphyClient, fake_giphy: FakeGiphy
) -> None:
    limiter = _search_limiter()
    for _ in range(SEARCHES_PER_MINUTE):
        trending, _results = await service.search(client, limiter, ADA, "cat")
        assert trending is False

    error, retry_after = await service.search(client, limiter, ADA, "cat")

    assert error == GifError.RATE_LIMITED
    assert isinstance(retry_after, int)
    assert retry_after >= 1
    assert len(fake_giphy.requests) == SEARCHES_PER_MINUTE

    trending, results = await service.search(client, limiter, BEN, "cat")
    assert trending is False
    assert results


async def test_6th_post_is_rate_limited_without_a_request(
    client: GiphyClient, fake_giphy: FakeGiphy
) -> None:
    limiter = _post_limiter()
    for _ in range(POSTS_PER_MINUTE):
        gif = await service.resolve_for_post(client, limiter, ADA, "cat-1")
        assert isinstance(gif, GifRef)

    error, retry_after = await service.resolve_for_post(client, limiter, ADA, "cat-1")  # type: ignore[misc]

    assert error == GifError.RATE_LIMITED
    assert isinstance(retry_after, int)
    assert retry_after >= 1
    assert len(fake_giphy.requests) == POSTS_PER_MINUTE

    gif = await service.resolve_for_post(client, limiter, BEN, "cat-1")
    assert isinstance(gif, GifRef)


# -- NFR-2 / FR-3: post resolves allowed ids only ---------------------------------------


async def test_post_resolves_an_allowed_id(client: GiphyClient) -> None:
    gif = await service.resolve_for_post(client, _post_limiter(), ADA, "cat-1")

    assert isinstance(gif, GifRef)
    assert gif.id == "cat-1"
    assert gif.title == "Happy cat"


@pytest.mark.parametrize("gif_id", [R_RATED_ID, GONE_ID])
async def test_post_with_disallowed_or_gone_id_is_not_allowed(
    client: GiphyClient, gif_id: str
) -> None:
    assert await service.resolve_for_post(client, _post_limiter(), ADA, gif_id) == (
        GifError.NOT_ALLOWED,
        None,
    )
