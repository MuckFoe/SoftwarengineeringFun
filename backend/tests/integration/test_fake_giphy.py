"""The fake GIPHY (007 task 5) behaves as the GIF tests rely on.

It is a real HTTP server on a local socket, so these checks use plain `httpx`.
"""

import time
from collections.abc import Iterator

import httpx
import pytest

from tests.fakes.fake_giphy import (
    BROKEN_MEDIA_ID,
    CAT_IDS,
    GONE_ID,
    R_RATED_ID,
    TRENDING_IDS,
    UNTITLED_ID,
    FakeGiphy,
)


def _search(fake: FakeGiphy, q: str, **extra: str) -> httpx.Response:
    params = {"api_key": "k", "q": q, "rating": "pg-13", "limit": "24", **extra}
    return httpx.get(f"{fake.base_url}/v1/gifs/search", params=params, timeout=5)


def test_search_cat_returns_fixtures_and_is_recorded(fake_giphy: FakeGiphy) -> None:
    resp = httpx.get(
        f"{fake_giphy.base_url}/v1/gifs/search",
        params={"api_key": "k", "q": "cat", "rating": "pg-13"},
        headers={"X-Probe": "yes"},
        timeout=5,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert [item["id"] for item in body["data"]] == list(CAT_IDS)
    assert body["meta"]["status"] == 200

    [recorded] = fake_giphy.requests
    assert recorded.path == "/v1/gifs/search"
    assert recorded.query == {"api_key": "k", "q": "cat", "rating": "pg-13"}
    assert recorded.headers["x-probe"] == "yes"


def test_search_fixture_set_has_the_special_items(fake_giphy: FakeGiphy) -> None:
    items = {item["id"]: item for item in _search(fake_giphy, "cat").json()["data"]}
    assert items[R_RATED_ID]["rating"] == "r"
    assert items[UNTITLED_ID]["title"] == ""
    for item in items.values():
        for rendition in ("fixed_width", "fixed_width_still"):
            assert item["images"][rendition]["url"].startswith(fake_giphy.base_url)

    ok_media = items[CAT_IDS[0]]["images"]["fixed_width"]["url"]
    broken = items[BROKEN_MEDIA_ID]["images"]["fixed_width"]["url"]
    assert httpx.get(ok_media, timeout=5).status_code == 200
    assert httpx.get(broken, timeout=5).status_code == 404


def test_other_terms_are_empty_and_trending_has_its_own_set(fake_giphy: FakeGiphy) -> None:
    assert _search(fake_giphy, "zebra").json()["data"] == []
    resp = httpx.get(
        f"{fake_giphy.base_url}/v1/gifs/trending",
        params={"api_key": "k", "rating": "pg-13"},
        timeout=5,
    )
    assert [item["id"] for item in resp.json()["data"]] == list(TRENDING_IDS)


def test_get_by_id(fake_giphy: FakeGiphy) -> None:
    base = f"{fake_giphy.base_url}/v1/gifs"
    resp = httpx.get(f"{base}/{CAT_IDS[0]}", params={"api_key": "k"}, timeout=5)
    assert resp.status_code == 200
    assert resp.json()["data"]["id"] == CAT_IDS[0]
    assert (
        httpx.get(f"{base}/{R_RATED_ID}", params={"api_key": "k"}).json()["data"]["rating"] == "r"
    )
    assert httpx.get(f"{base}/{GONE_ID}", params={"api_key": "k"}, timeout=5).status_code == 404


def test_media_host_is_configurable() -> None:
    fake = FakeGiphy(media_base="http://giphy.example:9999")
    fake.start()
    try:
        item = _search(fake, "cat").json()["data"][0]
        assert item["images"]["fixed_width"]["url"].startswith("http://giphy.example:9999/")
    finally:
        fake.stop()


def test_fail_500_takes_effect_and_resets(fake_giphy: FakeGiphy) -> None:
    fake_giphy.fail_with(500)
    assert _search(fake_giphy, "cat").status_code == 500
    fake_giphy.reset()
    assert _search(fake_giphy, "cat").status_code == 200


def test_delay_takes_effect_and_resets(fake_giphy: FakeGiphy) -> None:
    fake_giphy.delay(1.0)
    with pytest.raises(httpx.TimeoutException):
        _search_with_timeout(fake_giphy, 0.3)
    fake_giphy.reset()
    started = time.monotonic()
    assert _search_with_timeout(fake_giphy, 2).status_code == 200
    assert time.monotonic() - started < 0.5


def _search_with_timeout(fake: FakeGiphy, timeout: float) -> httpx.Response:
    return httpx.get(
        f"{fake.base_url}/v1/gifs/search", params={"api_key": "k", "q": "cat"}, timeout=timeout
    )


def test_refuse_takes_effect_and_resets(fake_giphy: FakeGiphy) -> None:
    base_url = fake_giphy.base_url
    fake_giphy.refuse_connections()
    with pytest.raises(httpx.ConnectError):
        _search(fake_giphy, "cat")
    fake_giphy.reset()
    assert fake_giphy.base_url == base_url
    assert _search(fake_giphy, "cat").status_code == 200


def test_reset_clears_recorded_requests(fake_giphy: FakeGiphy) -> None:
    _search(fake_giphy, "cat")
    assert len(fake_giphy.requests) == 1
    fake_giphy.reset()
    assert fake_giphy.requests == []


# -- HTTP control path (task 21: the E2E stack drives the fake from Playwright) -----------


@pytest.fixture
def controlled() -> Iterator[FakeGiphy]:
    fake = FakeGiphy(control_port=0).start()
    try:
        yield fake
    finally:
        fake.stop()


def test_control_lists_recorded_requests(controlled: FakeGiphy) -> None:
    _search(controlled, "cat")
    resp = httpx.get(f"{controlled.control_url}/requests", timeout=5)
    assert resp.status_code == 200
    [recorded] = resp.json()
    assert recorded["path"] == "/v1/gifs/search"
    assert recorded["query"]["q"] == "cat"
    assert "host" in recorded["headers"]
    # Control traffic is not recorded as GIPHY traffic.
    assert len(controlled.requests) == 1


def test_control_switches_the_api_off_and_on(controlled: FakeGiphy) -> None:
    base_url = controlled.base_url
    _search(controlled, "cat")
    assert httpx.post(f"{controlled.control_url}/off", timeout=5).status_code == 204
    with pytest.raises(httpx.ConnectError):
        _search(controlled, "cat")
    # The control path stays reachable while the API is off.
    assert httpx.get(f"{controlled.control_url}/health", timeout=5).status_code == 200
    assert httpx.post(f"{controlled.control_url}/on", timeout=5).status_code == 204
    assert controlled.base_url == base_url
    assert _search(controlled, "cat").status_code == 200
    # Switching on keeps what was recorded before.
    assert len(httpx.get(f"{controlled.control_url}/requests", timeout=5).json()) == 2


def test_control_reset_clears_requests_and_failures(controlled: FakeGiphy) -> None:
    _search(controlled, "cat")
    controlled.fail_with(500)
    assert httpx.post(f"{controlled.control_url}/reset", timeout=5).status_code == 204
    assert httpx.get(f"{controlled.control_url}/requests", timeout=5).json() == []
    assert _search(controlled, "cat").status_code == 200


def test_control_unknown_path_is_404(controlled: FakeGiphy) -> None:
    assert httpx.post(f"{controlled.control_url}/explode", timeout=5).status_code == 404


def test_no_control_server_by_default(fake_giphy: FakeGiphy) -> None:
    with pytest.raises(RuntimeError):
        _ = fake_giphy.control_url
