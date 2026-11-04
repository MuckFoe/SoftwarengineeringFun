"""Spec 007 task 16: `gif_search` over the session WebSocket and the app lifespan's GIPHY
client and limiters (`main.py`, `sessions/ws.py`). Task 19: `chat_send_gif`.

FR-1, FR-2, FR-3, FR-4, FR-8, FR-9, FR-12, NFR-1, NFR-2, NFR-3, NFR-4. TestClient
WebSocket clients, real Postgres, the fake GIPHY on a real local port.
"""

import json
import time
import uuid
from collections.abc import AsyncIterator
from datetime import datetime
from urllib.parse import quote

import asyncpg
import pycrdt
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import clock
from app import db as app_db
from app.config import Settings
from app.main import create_app
from app.problems import repo as problems_repo
from app.problems.signature import TestInput, parse_signature
from app.sessions import repo as sessions_repo
from tests.conftest import FrozenClock
from tests.fakes.fake_giphy import CAT_IDS, GONE_ID, R_RATED_ID, TRENDING_IDS, FakeGiphy

ADD = parse_signature("def add(a: int, b: int) -> int")
API_KEY = "test-giphy-key"


def _settings(database_url: str, base_url: str, api_key: str | None = API_KEY) -> Settings:
    return Settings(
        oidc_issuer="http://unused",
        oidc_client_id="unused",
        oidc_client_secret="unused",
        session_cookie_key="unused-session-cookie-key",
        database_url=database_url,
        runner_url="http://unused",
        giphy_api_key=api_key,
        giphy_base_url=base_url,
    )


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


@pytest.fixture
async def client(
    database_url: str, migrated: asyncpg.Connection, fake_giphy: FakeGiphy
) -> AsyncIterator[TestClient]:
    with TestClient(create_app(_settings(database_url, fake_giphy.base_url))) as test_client:
        yield test_client


async def _session(conn: asyncpg.Connection) -> sessions_repo.Session:
    problem_id = await problems_repo.create(
        conn,
        title=f"p-{uuid.uuid4().hex[:8]}",
        description="d",
        sig=ADD,
        tests=[TestInput(args=[2, 3], expected=5)],
        created_by_sub=None,
        created_by_name=None,
    )
    return await sessions_repo.create(conn, problem_id)


def _ws_url(invite: str, name: str) -> str:
    return f"/api/sessions/{invite}/ws?name={quote(name)}"


def _search(ws, q: str) -> str:
    request_id = uuid.uuid4().hex
    ws.send_text(json.dumps({"type": "gif_search", "request_id": request_id, "q": q}))
    return request_id


def _next(ws) -> dict:
    """The next JSON message that isn't a presence update."""
    while True:
        message = ws.receive_json()
        if message["type"] != "presence":
            return message


def _next_bytes(ws) -> bytes:
    """The next binary message, skipping any JSON (presence) in between."""
    while True:
        message = ws.receive()
        if message.get("bytes") is not None:
            return message["bytes"]


def _searches(fake: FakeGiphy) -> list:
    return [r for r in fake.requests if r.path.startswith("/v1/gifs/")]


async def test_fr1_search_cat_returns_the_cat_fixtures_and_asks_for_pg13(
    client: TestClient, migrated: asyncpg.Connection, fake_giphy: FakeGiphy
) -> None:
    session = await _session(migrated)
    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada:
        assert _next(ada)["type"] == "welcome"
        request_id = _search(ada, "cat")
        reply = _next(ada)

    assert reply["type"] == "gif_results"
    assert reply["request_id"] == request_id
    assert reply["trending"] is False
    ids = [r["id"] for r in reply["results"]]
    assert set(ids) <= set(CAT_IDS)
    assert "cat-1" in ids
    first = next(r for r in reply["results"] if r["id"] == "cat-1")
    assert set(first) == {"id", "title", "url", "still_url", "width", "height"}
    assert first["title"] == "Happy cat"
    assert first["width"] == 200 and first["height"] == 150
    (recorded,) = _searches(fake_giphy)
    assert recorded.path == "/v1/gifs/search"
    assert recorded.query["q"] == "cat"
    assert recorded.query["rating"] == "pg-13"


async def test_nfr2_the_r_rated_fixture_is_not_in_the_results(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada:
        _next(ada)  # welcome
        _search(ada, "cat")
        reply = _next(ada)

    ids = [r["id"] for r in reply["results"]]
    assert R_RATED_ID not in ids
    assert set(ids) == set(CAT_IDS) - {R_RATED_ID}


async def test_fr2_empty_search_returns_trending_and_asks_for_pg13(
    client: TestClient, migrated: asyncpg.Connection, fake_giphy: FakeGiphy
) -> None:
    session = await _session(migrated)
    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada:
        _next(ada)  # welcome
        request_id = _search(ada, "")
        reply = _next(ada)

    assert reply["type"] == "gif_results"
    assert reply["request_id"] == request_id
    assert reply["trending"] is True
    assert [r["id"] for r in reply["results"]] == list(TRENDING_IDS)
    (recorded,) = _searches(fake_giphy)
    assert recorded.path == "/v1/gifs/trending"
    assert recorded.query["rating"] == "pg-13"


async def test_nfr1_the_outgoing_request_carries_only_the_term(
    client: TestClient, migrated: asyncpg.Connection, fake_giphy: FakeGiphy
) -> None:
    session = await _session(migrated)
    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada:
        _next(ada)  # welcome
        ada.send_text(json.dumps({"type": "chat_send", "client_id": "c1", "text": "secret words"}))
        assert _next(ada)["type"] == "chat_message"
        _search(ada, "cat")
        assert _next(ada)["type"] == "gif_results"

    (recorded,) = _searches(fake_giphy)
    assert set(recorded.query) == {"api_key", "q", "rating", "limit", "bundle"}
    assert recorded.query["q"] == "cat"
    everything = [recorded.url, *recorded.headers.keys(), *recorded.headers.values()]
    for forbidden in ("Ada", session.invite_id, str(session.id), "secret words", "secret"):
        assert not any(forbidden.lower() in part.lower() for part in everything), forbidden
    for header in ("referer", "cookie", "x-forwarded-for"):
        assert header not in recorded.headers


@pytest.mark.parametrize("failure", ["refused", "500", "slow"])
async def test_fr9_giphy_failing_answers_unavailable_and_text_still_sends(
    client: TestClient, migrated: asyncpg.Connection, fake_giphy: FakeGiphy, failure: str
) -> None:
    session = await _session(migrated)
    if failure == "refused":
        fake_giphy.refuse_connections()
    elif failure == "500":
        fake_giphy.fail_with(500)
    else:
        fake_giphy.delay(2.0)
    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada:
        _next(ada)  # welcome
        request_id = _search(ada, "cat")
        reply = _next(ada)
        ada.send_text(json.dumps({"type": "chat_send", "client_id": "c1", "text": "still here"}))
        sent = _next(ada)

    assert reply == {"type": "error", "code": "gif_unavailable", "request_id": request_id}
    assert sent["type"] == "chat_message"
    assert sent["message"]["text"] == "still here"


async def test_fr9_no_api_key_answers_unavailable_and_reaches_nothing(
    database_url: str, migrated: asyncpg.Connection, fake_giphy: FakeGiphy
) -> None:
    session = await _session(migrated)
    app = create_app(_settings(database_url, fake_giphy.base_url, api_key=None))
    with (
        TestClient(app) as no_key,
        no_key.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada,
    ):
        _next(ada)  # welcome
        request_id = _search(ada, "cat")
        reply = _next(ada)
        ada.send_text(json.dumps({"type": "chat_send", "client_id": "c1", "text": "hi"}))
        sent = _next(ada)

    assert reply == {"type": "error", "code": "gif_unavailable", "request_id": request_id}
    assert sent["type"] == "chat_message"
    assert fake_giphy.requests == []


async def test_nfr4_a_prompt_answer_arrives_within_2s(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada:
        _next(ada)  # welcome
        start = time.monotonic()
        _search(ada, "cat")
        reply = _next(ada)
        elapsed = time.monotonic() - start

    assert reply["type"] == "gif_results"
    assert elapsed < 2


async def test_nfr4_a_3s_delay_answers_unavailable_within_2s(
    client: TestClient, migrated: asyncpg.Connection, fake_giphy: FakeGiphy
) -> None:
    session = await _session(migrated)
    fake_giphy.delay(3.0)
    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada:
        _next(ada)  # welcome
        start = time.monotonic()
        _search(ada, "cat")
        reply = _next(ada)
        elapsed = time.monotonic() - start

    assert reply["code"] == "gif_unavailable"
    assert elapsed < 2


async def test_nfr4_a_slow_search_does_not_block_that_participants_edits(
    client: TestClient, migrated: asyncpg.Connection, fake_giphy: FakeGiphy
) -> None:
    session = await _session(migrated)
    fake_giphy.delay(1.0)
    with (
        client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada,
        client.websocket_connect(_ws_url(session.invite_id, "Ben")) as ben,
    ):
        _next(ada)  # welcome
        _next(ben)  # welcome
        _search(ada, "cat")
        doc = pycrdt.Doc()
        before = doc.get_state()
        doc.get("scratch", type=pycrdt.Text).insert(0, "x")
        start = time.monotonic()
        ada.send_bytes(pycrdt.create_update_message(doc.get_update(before)))
        relayed = _next_bytes(ben)
        edit_elapsed = time.monotonic() - start
        reply = _next(ada)

    assert relayed[0] == pycrdt.YMessageType.SYNC
    assert edit_elapsed < 0.5
    assert reply["type"] == "gif_results"


async def test_nfr3_the_21st_search_in_a_minute_is_refused_others_unaffected(
    client: TestClient, migrated: asyncpg.Connection, fake_giphy: FakeGiphy
) -> None:
    session = await _session(migrated)
    with (
        client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada,
        client.websocket_connect(_ws_url(session.invite_id, "Ben")) as ben,
    ):
        _next(ada)  # welcome
        _next(ben)  # welcome
        for _ in range(20):
            _search(ada, "cat")
            assert _next(ada)["type"] == "gif_results"
        request_id = _search(ada, "cat")
        refused = _next(ada)
        _search(ben, "cat")
        bens = _next(ben)

    assert refused["type"] == "error"
    assert refused["code"] == "gif_rate_limited"
    assert refused["request_id"] == request_id
    assert isinstance(refused["retry_after"], int) and refused["retry_after"] >= 1
    assert bens["type"] == "gif_results"
    assert len(_searches(fake_giphy)) == 21  # Ada's 20 and Ben's 1; no 21st from Ada

    # Reconnecting under the same name does not reset Ada's limit.
    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada_again:
        _next(ada_again)  # welcome
        _search(ada_again, "cat")
        assert _next(ada_again)["code"] == "gif_rate_limited"
    assert len(_searches(fake_giphy)) == 21


async def test_fr8_a_stale_session_refuses_the_connection_so_no_search(
    client: TestClient, migrated: asyncpg.Connection, fake_giphy: FakeGiphy
) -> None:
    session = await _session(migrated)
    await sessions_repo.set_stale(migrated, session.id)

    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ws:
        with pytest.raises(WebSocketDisconnect) as exc_info:
            ws.receive_json()
    assert exc_info.value.code == 4410
    assert fake_giphy.requests == []


# --- Task 19: chat_send_gif -------------------------------------------------------------


def _post(ws, gif_id: str, **extra: object) -> str:
    client_id = uuid.uuid4().hex
    ws.send_text(
        json.dumps({"type": "chat_send_gif", "client_id": client_id, "gif_id": gif_id, **extra})
    )
    return client_id


def _say(ws, text: str) -> str:
    client_id = uuid.uuid4().hex
    ws.send_text(json.dumps({"type": "chat_send", "client_id": client_id, "text": text}))
    return client_id


async def _gif_rows(conn: asyncpg.Connection, session_id: uuid.UUID) -> list[asyncpg.Record]:
    return await conn.fetch(
        "select id, sender_name, gif_id, gif_url from chat_message"
        " where session_id = $1 and kind = 'gif' order by id",
        session_id,
    )


async def test_fr3_adas_post_is_a_gif_message_from_ada_at_server_time(
    client: TestClient, migrated: asyncpg.Connection, frozen_clock: FrozenClock
) -> None:
    session = await _session(migrated)
    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada:
        _next(ada)  # welcome
        client_id = _post(ada, "cat-1")
        reply = _next(ada)

    assert reply["type"] == "chat_message"
    assert reply["client_id"] == client_id
    message = reply["message"]
    assert message["kind"] == "gif"
    assert message["sender_name"] == "Ada"
    sent_at = datetime.fromisoformat(message["sent_at"])
    assert abs((sent_at - clock.now()).total_seconds()) <= 1
    assert message["gif"]["id"] == "cat-1"
    assert message["gif"]["title"] == "Happy cat"


async def test_fr4_the_others_see_the_gif_after_the_earlier_messages(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    with (
        client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada,
        client.websocket_connect(_ws_url(session.invite_id, "Ben")) as ben,
        client.websocket_connect(_ws_url(session.invite_id, "Cy")) as cy,
    ):
        for ws in (ada, ben, cy):
            _next(ws)  # welcome
        _say(ben, "one")
        _say(cy, "two")
        texts = {ws: [_next(ws), _next(ws)] for ws in (ada, ben, cy)}
        _post(ada, "cat-2")
        gif_for = {ws: _next(ws) for ws in (ben, cy)}

    text_ids = [m["message"]["id"] for m in texts[ben]]
    for ws in (ben, cy):
        frame = gif_for[ws]
        assert frame["type"] == "chat_message"
        assert frame["message"]["kind"] == "gif"
        assert frame["message"]["gif"]["id"] == "cat-2"
        assert frame["message"]["sender_name"] == "Ada"
        assert frame["message"]["id"] > max(text_ids)


@pytest.mark.parametrize("gif_id", [R_RATED_ID, GONE_ID])
async def test_nfr2_a_disallowed_or_gone_id_is_not_allowed_and_stores_nothing(
    client: TestClient, migrated: asyncpg.Connection, gif_id: str
) -> None:
    session = await _session(migrated)
    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada:
        _next(ada)  # welcome
        client_id = _post(ada, gif_id)
        reply = _next(ada)

    assert reply == {"type": "error", "code": "gif_not_allowed", "client_id": client_id}
    assert await _gif_rows(migrated, session.id) == []


async def test_nfr2_extra_fields_in_the_frame_are_ignored(
    client: TestClient, migrated: asyncpg.Connection, fake_giphy: FakeGiphy
) -> None:
    session = await _session(migrated)
    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada:
        _next(ada)  # welcome
        _post(
            ada,
            "cat-1",
            url="https://evil.example/x.gif",
            still_url="https://evil.example/s.gif",
            title="Injected",
            sender_name="Mallory",
        )
        reply = _next(ada)

    gif = reply["message"]["gif"]
    assert reply["message"]["sender_name"] == "Ada"
    assert gif["title"] == "Happy cat"
    assert "evil.example" not in gif["url"] and "evil.example" not in gif["still_url"]
    assert gif["url"] == fake_giphy.item("cat-1")["images"]["fixed_width"]["url"]
    (row,) = await _gif_rows(migrated, session.id)
    assert row["gif_url"] == gif["url"]


async def test_nfr3_the_6th_post_in_a_minute_is_refused_others_unaffected(
    client: TestClient, migrated: asyncpg.Connection, frozen_clock: FrozenClock
) -> None:
    session = await _session(migrated)
    with (
        client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada,
        client.websocket_connect(_ws_url(session.invite_id, "Ben")) as ben,
    ):
        _next(ada)  # welcome
        _next(ben)  # welcome
        for _ in range(5):
            _post(ada, "cat-1")
            assert _next(ada)["type"] == "chat_message"
            assert _next(ben)["type"] == "chat_message"
        client_id = _post(ada, "cat-1")
        refused = _next(ada)
        _post(ben, "cat-3")
        bens = _next(ben)

    assert refused["type"] == "error"
    assert refused["code"] == "gif_rate_limited"
    assert refused["client_id"] == client_id
    assert isinstance(refused["retry_after"], int) and refused["retry_after"] >= 1
    assert bens["type"] == "chat_message"
    assert bens["message"]["sender_name"] == "Ben"
    rows = await _gif_rows(migrated, session.id)
    assert [r["sender_name"] for r in rows] == ["Ada"] * 5 + ["Ben"]


async def test_fr9_giphy_down_on_post_answers_unavailable_and_stores_nothing(
    client: TestClient, migrated: asyncpg.Connection, fake_giphy: FakeGiphy
) -> None:
    session = await _session(migrated)
    fake_giphy.fail_with(500)
    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada:
        _next(ada)  # welcome
        client_id = _post(ada, "cat-1")
        reply = _next(ada)

    assert reply == {"type": "error", "code": "gif_unavailable", "client_id": client_id}
    assert await _gif_rows(migrated, session.id) == []


async def test_fr8_a_session_gone_stale_mid_connection_refuses_the_post(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada:
        _next(ada)  # welcome
        await sessions_repo.set_stale(migrated, session.id)
        client_id = _post(ada, "cat-1")
        reply = _next(ada)

    assert reply == {"type": "error", "code": "session_stale", "client_id": client_id}
    assert await _gif_rows(migrated, session.id) == []


async def test_fr12_posting_downloads_no_media(
    client: TestClient, migrated: asyncpg.Connection, fake_giphy: FakeGiphy
) -> None:
    session = await _session(migrated)
    with client.websocket_connect(_ws_url(session.invite_id, "Ada")) as ada:
        _next(ada)  # welcome
        _post(ada, "cat-1")
        assert _next(ada)["type"] == "chat_message"

    paths = [r.path for r in fake_giphy.requests]
    assert paths == ["/v1/gifs/cat-1"]
    assert not any(p.startswith("/media/") for p in paths)
