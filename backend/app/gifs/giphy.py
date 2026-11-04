"""Spec 007: the outgoing GIPHY client (FR-1, FR-2, FR-9, NFR-1, NFR-2, NFR-4).

The request is built here from the search term and fixed parameters only. No method
takes a participant name, invite, session id or chat text, so none can be sent (NFR-1).
"""

import asyncio
from collections.abc import Mapping
from urllib.parse import quote

import httpx

from app.gifs.models import GifRef
from app.gifs.rules import REQUEST_RATING, RESULT_LIMIT, normalise_query, parse_result

_HEADERS = {"Accept": "application/json", "User-Agent": "projecthub-gifs"}


class GifServiceError(Exception):
    """GIPHY could not be reached or answered with something unusable."""


class GiphyClient:
    def __init__(
        self,
        base_url: str,
        api_key: str | None,
        *,
        timeout_s: float = 1.5,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._api_key = api_key
        self._timeout_s = timeout_s
        self._http = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers=_HEADERS,
            timeout=httpx.Timeout(timeout_s),
            follow_redirects=False,
            transport=transport,
        )

    async def search(self, q: str) -> list[GifRef]:
        params = {"q": normalise_query(q), **self._list_params()}
        return self._parse_list(await self._get("/v1/gifs/search", params))

    async def trending(self) -> list[GifRef]:
        return self._parse_list(await self._get("/v1/gifs/trending", self._list_params()))

    async def get(self, gif_id: str) -> GifRef | None:
        """The GIF by id; None when it is gone or rated above PG-13."""
        if not gif_id:
            return None
        resp = await self._get(f"/v1/gifs/{quote(gif_id, safe='')}", {}, allow_404=True)
        if resp is None:
            return None
        data = _json(resp).get("data")
        return parse_result(data) if isinstance(data, Mapping) else None

    async def aclose(self) -> None:
        await self._http.aclose()

    def _list_params(self) -> dict[str, str]:
        # No `bundle`: GIPHY's rendition bundles (messaging_non_clips included) omit the
        # fixed_width_still rendition, so every result would fail parse_result.
        return {"rating": REQUEST_RATING, "limit": str(RESULT_LIMIT)}

    async def _get(
        self, path: str, params: dict[str, str], *, allow_404: bool = False
    ) -> httpx.Response | None:
        if not self._api_key:
            raise GifServiceError("no GIPHY API key configured")
        # A deadline on the whole call, not just each phase, keeps a trickling reply in budget.
        try:
            async with asyncio.timeout(self._timeout_s):
                resp = await self._http.get(path, params={"api_key": self._api_key, **params})
        except TimeoutError as exc:
            raise GifServiceError("GIPHY timed out") from exc
        except httpx.HTTPError as exc:
            raise GifServiceError(type(exc).__name__) from exc
        if allow_404 and resp.status_code == 404:
            return None
        if not resp.is_success:
            raise GifServiceError(f"GIPHY answered {resp.status_code}")
        return resp

    @staticmethod
    def _parse_list(resp: httpx.Response | None) -> list[GifRef]:
        data = _json(resp).get("data") if resp is not None else None
        if not isinstance(data, list):
            raise GifServiceError("GIPHY answered without a data list")
        parsed = (parse_result(item) for item in data if isinstance(item, Mapping))
        return [gif for gif in parsed if gif is not None]


def _json(resp: httpx.Response) -> Mapping[str, object]:
    try:
        body = resp.json()
    except ValueError as exc:
        raise GifServiceError("GIPHY answered with a body that is not JSON") from exc
    if not isinstance(body, Mapping):
        raise GifServiceError("GIPHY answered with a body that is not an object")
    return body
