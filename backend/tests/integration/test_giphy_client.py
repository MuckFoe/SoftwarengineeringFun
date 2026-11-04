"""`GiphyClient` against the fake GIPHY (007 task 9).

FR-1, FR-2, FR-9, NFR-1, NFR-2, NFR-4. The fake is a real HTTP server on a local port, so
the real `httpx` path, timeouts and connection refusal are exercised.
"""

import time

import httpx
import pytest

from app.gifs.giphy import GifServiceError, GiphyClient
from app.gifs.models import GifRef
from tests.fakes.fake_giphy import (
    BROKEN_MEDIA_ID,
    CAT_IDS,
    GONE_ID,
    R_RATED_ID,
    TRENDING_IDS,
    UNTITLED_ID,
    FakeGiphy,
)

API_KEY = "test-key-not-secret"


def _client(fake: FakeGiphy, **kwargs: object) -> GiphyClient:
    return GiphyClient(fake.base_url, API_KEY, **kwargs)  # type: ignore[arg-type]


# -- FR-1: search "cat" shows matching GIFs; the request asks for PG-13 or lower ---------


async def test_search_cat_returns_the_cat_fixtures(fake_giphy: FakeGiphy) -> None:
    client = _client(fake_giphy)
    try:
        results = await client.search("cat")
    finally:
        await client.aclose()

    assert all(isinstance(r, GifRef) for r in results)
    assert [r.id for r in results] == [i for i in CAT_IDS if i != R_RATED_ID]
    first = results[0]
    assert first.title == "Happy cat"
    assert first.url.startswith(fake_giphy.base_url)
    assert first.still_url.startswith(fake_giphy.base_url)
    assert (first.width, first.height) == (200, 150)
    assert next(r for r in results if r.id == UNTITLED_ID).title == ""
    assert BROKEN_MEDIA_ID in {r.id for r in results}

    [recorded] = fake_giphy.requests
    assert recorded.path == "/v1/gifs/search"
    assert recorded.query["q"] == "cat"
    assert recorded.query["rating"] == "pg-13"


# -- FR-2: empty field shows trending, limited to PG-13 --------------------------------


async def test_trending_asks_for_pg13(fake_giphy: FakeGiphy) -> None:
    client = _client(fake_giphy)
    try:
        results = await client.trending()
    finally:
        await client.aclose()

    assert [r.id for r in results] == list(TRENDING_IDS)
    [recorded] = fake_giphy.requests
    assert recorded.path == "/v1/gifs/trending"
    assert recorded.query == {
        "api_key": API_KEY,
        "rating": "pg-13",
        "limit": "24",
    }


# -- NFR-2: nothing above PG-13; gone ids are None ---------------------------------------


async def test_r_rated_fixture_is_not_in_results(fake_giphy: FakeGiphy) -> None:
    client = _client(fake_giphy)
    try:
        results = await client.search("cat")
    finally:
        await client.aclose()
    assert R_RATED_ID not in {r.id for r in results}


async def test_get_returns_the_gif_or_none(fake_giphy: FakeGiphy) -> None:
    client = _client(fake_giphy)
    try:
        found = await client.get(CAT_IDS[0])
        r_rated = await client.get(R_RATED_ID)
        gone = await client.get(GONE_ID)
    finally:
        await client.aclose()

    assert found is not None
    assert found.id == CAT_IDS[0]
    assert r_rated is None
    assert gone is None
    assert [r.path for r in fake_giphy.requests] == [
        f"/v1/gifs/{CAT_IDS[0]}",
        f"/v1/gifs/{R_RATED_ID}",
        f"/v1/gifs/{GONE_ID}",
    ]
    assert all(r.query == {"api_key": API_KEY} for r in fake_giphy.requests)


async def test_get_cannot_escape_the_gif_path(fake_giphy: FakeGiphy) -> None:
    client = _client(fake_giphy)
    try:
        result = await client.get("../search")
    finally:
        await client.aclose()
    assert result is None
    assert all(r.path != "/v1/gifs/search" for r in fake_giphy.requests)


# -- NFR-1: only the search term and fixed parameters go out -----------------------------


async def test_search_sends_exactly_the_fixed_parameters_and_no_identifying_headers(
    fake_giphy: FakeGiphy,
) -> None:
    client = _client(fake_giphy)
    try:
        await client.search("cat")
    finally:
        await client.aclose()

    [recorded] = fake_giphy.requests
    assert set(recorded.query) == {"api_key", "q", "rating", "limit"}
    assert len(recorded.query_pairs) == 4
    assert recorded.query == {
        "api_key": API_KEY,
        "q": "cat",
        "rating": "pg-13",
        "limit": "24",
    }
    for header in ("referer", "cookie", "x-forwarded-for"):
        assert header not in recorded.headers


async def test_search_term_is_normalised(fake_giphy: FakeGiphy) -> None:
    client = _client(fake_giphy)
    try:
        await client.search("  cat  ")
        await client.search("x" * 60)
    finally:
        await client.aclose()
    first, second = fake_giphy.requests
    assert first.query["q"] == "cat"
    assert second.query["q"] == "x" * 50


# -- FR-9 / NFR-4: failures become GifServiceError, quickly ------------------------------


async def test_refused_connection_raises(fake_giphy: FakeGiphy) -> None:
    client = _client(fake_giphy)
    fake_giphy.refuse_connections()
    try:
        with pytest.raises(GifServiceError):
            await client.search("cat")
        with pytest.raises(GifServiceError):
            await client.get(CAT_IDS[0])
    finally:
        await client.aclose()


async def test_server_error_raises(fake_giphy: FakeGiphy) -> None:
    client = _client(fake_giphy)
    fake_giphy.fail_with(500)
    try:
        with pytest.raises(GifServiceError):
            await client.search("cat")
        with pytest.raises(GifServiceError):
            await client.trending()
        with pytest.raises(GifServiceError):
            await client.get(CAT_IDS[0])
    finally:
        await client.aclose()


async def test_delay_raises_within_two_seconds(fake_giphy: FakeGiphy) -> None:
    client = _client(fake_giphy)
    fake_giphy.delay(3)
    try:
        started = time.monotonic()
        with pytest.raises(GifServiceError):
            await client.search("cat")
        assert time.monotonic() - started < 2
    finally:
        await client.aclose()


async def test_no_api_key_raises_without_a_request(fake_giphy: FakeGiphy) -> None:
    client = GiphyClient(fake_giphy.base_url, None)
    try:
        with pytest.raises(GifServiceError):
            await client.search("cat")
        with pytest.raises(GifServiceError):
            await client.trending()
        with pytest.raises(GifServiceError):
            await client.get(CAT_IDS[0])
    finally:
        await client.aclose()
    assert fake_giphy.requests == []


@pytest.mark.parametrize("body", [b"not json", b"[]", b'{"data": {"id": "x"}}', b"{}"])
async def test_unusable_body_raises(body: bytes) -> None:
    # GIPHY sending garbage can't be staged on the fake, so a transport answers instead.
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, content=body))
    client = GiphyClient("https://giphy.invalid", API_KEY, transport=transport)
    try:
        with pytest.raises(GifServiceError):
            await client.search("cat")
    finally:
        await client.aclose()
