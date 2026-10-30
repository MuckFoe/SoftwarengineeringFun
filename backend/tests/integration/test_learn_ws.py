"""Spec 006 task 25: the learning-session WebSocket `/api/learn/sessions/{invite}/ws`.

FR-7–FR-14a, FR-18–FR-21, FR-24, FR-26, NFR-2, NFR-4; AC-7–AC-13a, AC-17, AC-25, AC-28.
A real database and the real app; nothing mocked. The lesson is stored the way the loader
stores it. Its accepted answers are sentinel strings, so a leak shows up in a raw frame.
"""

import dataclasses
import json
import secrets
import uuid
from collections.abc import AsyncIterator, Iterator
from contextlib import ExitStack, contextmanager
from urllib.parse import quote

import asyncpg
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import db as app_db
from app.config import Settings
from app.learn import repo, service
from app.learn.lesson_file import (
    ChoiceCheck,
    CommandOutput,
    Lesson,
    Step,
    TerminalCheck,
    TextCheck,
)
from app.main import create_app

SECRET_TEXT = "zebra-secret-text"
SECRET_CMD = "zebra-secret-command"
SECRET_OUT = "zebra-secret-output"
SECRET_RESPONSE_CMD = "zebra-response-command"
SECRET_RESPONSE_OUT = "zebra-response-output"
SECRETS = (SECRET_TEXT, SECRET_CMD, SECRET_OUT, SECRET_RESPONSE_CMD, SECRET_RESPONSE_OUT)

LESSON = Lesson(
    title="Basics",
    summary="Images and containers.",
    minutes=10,
    images=(),
    steps=(
        Step(kind="explanation", title="Intro", body="Read this.", hint=None, check=None),
        Step(
            kind="quiz",
            title="Which run?",
            body="Pick the running ones.",
            hint="Think *processes*.",
            check=ChoiceCheck(
                options=("An image", "A container", "A Dockerfile", "A -d container"),
                correct=(2, 4),
                multiple=True,
            ),
        ),
        Step(
            kind="quiz",
            title="Name it",
            body="A running image is a …",
            hint=None,
            check=TextCheck(accept=(SECRET_TEXT,)),
        ),
        Step(
            kind="terminal",
            title="List",
            body="List the running containers.",
            hint=None,
            check=TerminalCheck(
                prompt="$ ",
                accept=(CommandOutput(command=SECRET_CMD, output=SECRET_OUT),),
                responses=(CommandOutput(command=SECRET_RESPONSE_CMD, output=SECRET_RESPONSE_OUT),),
            ),
        ),
    ),
)
LAST = len(LESSON.steps) - 1

# What passes each step, as the client sends it (`selected` is 0-based on the wire).
CORRECT = {
    0: {"type": "continue"},
    1: {"type": "submit_choice", "selected": [1, 3]},
    2: {"type": "submit_text", "text": SECRET_TEXT},
    3: {"type": "submit_command", "command": SECRET_CMD},
}


def _settings(database_url: str) -> Settings:
    return Settings(
        oidc_issuer="http://unused",
        oidc_client_id="unused",
        oidc_client_secret="unused",
        session_cookie_key="unused-session-cookie-key",
        database_url=database_url,
        runner_url="http://unused",
    )


@pytest.fixture
async def migrated(db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    await app_db.migrate(db)
    yield db


@pytest.fixture
async def client(database_url: str, migrated: asyncpg.Connection) -> AsyncIterator[TestClient]:
    with TestClient(create_app(_settings(database_url))) as test_client:
        yield test_client


async def _session(conn: asyncpg.Connection) -> repo.LearningSession:
    key = f"zz-docker/{secrets.token_hex(4)}"
    content = {**dataclasses.asdict(LESSON), "images": {}}
    version_id = await conn.fetchval(
        """insert into lesson_version (lesson_key, content_hash, content)
           values ($1, $2, $3::jsonb) returning id""",
        key,
        secrets.token_hex(16),
        json.dumps(content),
    )
    await conn.execute(
        """insert into lesson (key, topic_key, topic_title, current_version_id)
           values ($1, 'zz-docker', 'Docker', $2)""",
        key,
        version_id,
    )
    return await service.create_session(conn, key)


async def _advance(conn: asyncpg.Connection, session: repo.LearningSession, to: int) -> None:
    """Passes steps 0..to-1 through the service, as a participant who then leaves."""
    person = await service.join(conn, session.id, "Setup")
    actions = {
        0: lambda: service.continue_(conn, session.id, person.id, "Setup", 0),
        1: lambda: service.submit_choice(conn, session.id, person.id, "Setup", 1, [1, 3]),
        2: lambda: service.submit_text(conn, session.id, person.id, "Setup", 2, SECRET_TEXT),
        3: lambda: service.submit_command(conn, session.id, person.id, "Setup", 3, SECRET_CMD),
    }
    for n in range(to):
        await actions[n]()
    await repo.leave_participant(conn, person.id)


def _url(invite: str, name: str) -> str:
    return f"/api/learn/sessions/{invite}/ws?name={quote(name)}"


def _send(ws, step: int, message: dict) -> None:
    ws.send_text(json.dumps({**message, "step": step}))


class _Raw:
    """A socket that keeps the raw text of every frame it received."""

    def __init__(self, ws) -> None:
        self.ws = ws
        self.frames: list[str] = []

    def json(self) -> dict:
        text = self.ws.receive_text()
        self.frames.append(text)
        return json.loads(text)

    def send(self, step: int, message: dict) -> None:
        _send(self.ws, step, message)


@contextmanager
def _joined(client: TestClient, invite: str, name: str) -> Iterator[tuple[_Raw, dict]]:
    """Joins and consumes the joiner's own `welcome` and `presence`."""
    with client.websocket_connect(_url(invite, name)) as ws:
        raw = _Raw(ws)
        welcome = raw.json()
        assert welcome["type"] == "welcome"
        presence = raw.json()
        assert presence["type"] == "presence"
        yield raw, welcome


def _close_code(client: TestClient, invite: str, name: str) -> int:
    with client.websocket_connect(_url(invite, name)) as ws:
        with pytest.raises(WebSocketDisconnect) as info:
            ws.receive_json()
    return info.value.code


async def _participants(conn: asyncpg.Connection, session_id: uuid.UUID) -> list[str]:
    return [p.display_name for p in await repo.list_participants(conn, session_id)]


# --- join -----------------------------------------------------------------------------------


async def test_ac7_a_30_character_name_joins_and_31_closes_4422(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)

    with _joined(client, session.invite_id, "  " + "a" * 30 + " ") as (_, welcome):
        assert welcome["record"]["current_step"] == 0
    assert _close_code(client, session.invite_id, "a" * 31) == 4422
    assert _close_code(client, session.invite_id, "   ") == 4422

    assert await _participants(migrated, session.id) == ["a" * 30]


async def test_unknown_invite_closes_4404_and_stale_closes_4410(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    await migrated.execute("update learning_session set stale_at = now() where id = $1", session.id)

    assert _close_code(client, "no-such-invite", "Ada") == 4404
    assert _close_code(client, session.invite_id, "Ada") == 4410
    assert await _participants(migrated, session.id) == []


async def test_ac8_five_join_and_the_sixth_closes_4403(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    with ExitStack() as stack:
        sockets = [
            stack.enter_context(_joined(client, session.invite_id, f"user{i}"))[0] for i in range(5)
        ]
        assert _close_code(client, session.invite_id, "user5") == 4403

        # user0 got one presence per later join, the last listing all five.
        presence = [sockets[0].json() for _ in range(4)][-1]
        assert presence["type"] == "presence"
        assert sorted(p["name"] for p in presence["participants"]) == [f"user{i}" for i in range(5)]


async def test_ac30_three_full_sessions_hold_fifteen_sockets_beyond_the_pool_size(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    # NFR-3: 3 sessions x 5 learners at once. A socket must not hold a pooled database
    # connection while idle, or joins past the pool's size (10 by default) wait forever.
    sessions = [await _session(migrated) for _ in range(3)]
    with ExitStack() as stack:
        sockets = [
            stack.enter_context(_joined(client, s.invite_id, f"user{i}"))[0]
            for s in sessions
            for i in range(5)
        ]
        assert len(sockets) == 15
        # Every socket still acts: the last joiner of the first session passes step 0.
        sockets[4].send(0, CORRECT[0])
        while (event := sockets[4].json())["type"] != "step_passed":
            pass
        assert event["step"] == 0


async def test_ac9_a_late_joiner_gets_the_record_and_presence_lists_everyone(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    await _advance(migrated, session, 3)

    with _joined(client, session.invite_id, "Ada") as (ada, _):
        with client.websocket_connect(_url(session.invite_id, "Linus")) as raw:
            linus = _Raw(raw)
            welcome = linus.json()
            presence = linus.json()
            to_ada = ada.json()

    assert welcome["type"] == "welcome"
    record = welcome["record"]
    assert record["current_step"] == 3
    assert [s["position"] for s in record["steps"]] == [0, 1, 2, 3]
    assert all(s["passed"] is not None for s in record["steps"][:3])
    assert record["steps"][3]["passed"] is None
    assert welcome["chat"] == []

    # Ids are strings, as in the coding-session presence; `you` is one of them.
    for message in (presence, to_ada):
        assert message["type"] == "presence"
        assert sorted(p["name"] for p in message["participants"]) == ["Ada", "Linus"]
        assert all(isinstance(p["id"], str) for p in message["participants"])
    linus_id = next(p["id"] for p in presence["participants"] if p["name"] == "Linus")
    assert welcome["you"] == {"participant_id": linus_id}


async def test_leaving_marks_the_participant_left_and_updates_presence(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)

    with _joined(client, session.invite_id, "Ada") as (ada, _):
        with _joined(client, session.invite_id, "Linus"):
            assert ada.json()["type"] == "presence"
        after = ada.json()

    assert after == {"type": "presence", "participants": [after["participants"][0]]}
    assert after["participants"][0]["name"] == "Ada"
    still_present = await migrated.fetch(
        "select display_name from learning_participant where session_id = $1 and left_at is null",
        session.id,
    )
    assert still_present == []


# --- step actions ---------------------------------------------------------------------------


async def test_ac10_a_pass_reaches_both_as_step_passed(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    await _advance(migrated, session, 2)

    with _joined(client, session.invite_id, "A") as (a, _):
        with _joined(client, session.invite_id, "B") as (b, _):
            a.json()  # presence for B's join
            a.send(2, CORRECT[2])
            for ws in (a, b):
                attempt = ws.json()
                assert attempt["type"] == "attempt"
                assert attempt["attempt"]["correct"] is True
                passed = ws.json()
                assert passed["type"] == "step_passed"
                assert passed["step"] == 2
                assert passed["passed"]["by"] == "A"
                assert passed["next"]["position"] == 3


async def test_ac11_a_wrong_answer_reaches_b_as_an_attempt(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    await _advance(migrated, session, 1)

    with _joined(client, session.invite_id, "A") as (a, _):
        with _joined(client, session.invite_id, "B") as (b, _):
            a.json()
            a.send(1, {"type": "submit_choice", "selected": [0]})
            to_b = b.json()
            assert a.json() == to_b

    assert to_b["type"] == "attempt"
    assert to_b["step"] == 1
    assert to_b["attempt"]["by"] == "A"
    assert to_b["attempt"]["submitted"] == [0]
    assert to_b["attempt"]["correct"] is False
    assert to_b["show_answer_available"] is False


async def test_ac12_b_reveals_the_hint_and_a_receives_it(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    await _advance(migrated, session, 1)

    with _joined(client, session.invite_id, "A") as (a, _):
        with _joined(client, session.invite_id, "B") as (b, _):
            a.json()
            b.send(1, {"type": "reveal_hint"})
            to_a = a.json()
            assert b.json() == to_a

    assert to_a["type"] == "hint_revealed"
    assert to_a["step"] == 1
    assert "processes" in to_a["hint_html"]


async def test_ac13_raw_frames_for_an_unpassed_step_hold_no_accepted_answer(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    await _advance(migrated, session, 2)

    with _joined(client, session.invite_id, "A") as (a, welcome):
        assert welcome["record"]["steps"][2]["answer"] is None
        a.send(2, {"type": "submit_text", "text": "a box"})
        assert a.json()["type"] == "attempt"
        frames = list(a.frames)

    for frame in frames:
        for secret in SECRETS:
            assert secret not in frame


async def test_ac13a_after_three_wrong_both_may_show_the_answer(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    await _advance(migrated, session, 2)

    with _joined(client, session.invite_id, "A") as (a, _):
        with _joined(client, session.invite_id, "B") as (b, _):
            a.json()
            for n in range(3):
                a.send(2, {"type": "submit_text", "text": f"wrong {n}"})
                attempts = [a.json(), b.json()]
                expected = n == 2
                assert [m["show_answer_available"] for m in attempts] == [expected] * 2
            b.send(2, {"type": "show_answer"})
            for ws in (a, b):
                revealed = ws.json()
                assert revealed["type"] == "answer_revealed"
                assert revealed["answer"] == {"type": "text", "accept": [SECRET_TEXT]}


async def test_show_answer_before_three_wrong_is_refused_to_the_sender_only(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    await _advance(migrated, session, 2)

    with _joined(client, session.invite_id, "A") as (a, _):
        with _joined(client, session.invite_id, "B") as (b, _):
            a.json()
            b.send(2, {"type": "show_answer"})
            assert b.json() == {"type": "error", "code": "show_answer_unavailable"}
            b.send(1, {"type": "reveal_hint"})
            assert b.json() == {"type": "error", "code": "not_current_step"}
            # A got neither; its next frame is the result of its own action.
            a.send(2, {"type": "submit_text", "text": "nope"})
            assert a.json()["type"] == "attempt"
            assert b.json()["type"] == "attempt"


async def test_ac17_a_command_reaches_both_with_name_and_output(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    await _advance(migrated, session, 3)

    with _joined(client, session.invite_id, "A") as (a, _):
        with _joined(client, session.invite_id, "B") as (b, _):
            a.json()
            a.send(3, {"type": "submit_command", "command": SECRET_RESPONSE_CMD})
            for ws in (a, b):
                attempt = ws.json()
                assert attempt["type"] == "attempt"
                assert attempt["attempt"]["by"] == "A"
                assert attempt["attempt"]["kind"] == "command"
                assert attempt["attempt"]["submitted"] == SECRET_RESPONSE_CMD
                assert attempt["attempt"]["output"] == SECRET_RESPONSE_OUT
                assert attempt["attempt"]["correct"] is False


async def test_the_last_pass_broadcasts_completed(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    await _advance(migrated, session, LAST)

    with _joined(client, session.invite_id, "A") as (a, _):
        with _joined(client, session.invite_id, "B") as (b, _):
            a.json()
            a.send(LAST, CORRECT[LAST])
            for ws in (a, b):
                assert [ws.json()["type"] for _ in range(3)] == [
                    "attempt",
                    "step_passed",
                    "completed",
                ]


async def test_ac25_a_completed_session_can_be_joined_but_refuses_submits(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    await _advance(migrated, session, LAST + 1)

    with _joined(client, session.invite_id, "Ada") as (ada, welcome):
        record = welcome["record"]
        assert record["completed"] is True
        assert all(s["passed"] is not None for s in record["steps"])
        assert len(record["steps"]) == len(LESSON.steps)
        ada.send(LAST, CORRECT[LAST])
        assert ada.json() == {"type": "error", "code": "session_completed"}


async def test_ac28_markup_in_a_submission_is_stored_and_sent_verbatim(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    await _advance(migrated, session, 2)

    with _joined(client, session.invite_id, "A") as (a, _):
        a.send(2, {"type": "submit_text", "text": "<b>hi</b>"})
        attempt = a.json()

    assert attempt["attempt"]["submitted"] == "<b>hi</b>"
    stored = await migrated.fetchval(
        "select submitted from learning_attempt where session_id = $1 and position = 2",
        session.id,
    )
    assert json.loads(stored) == "<b>hi</b>"


async def test_malformed_frames_are_ignored_and_the_socket_stays_usable(
    client: TestClient, migrated: asyncpg.Connection
) -> None:
    session = await _session(migrated)
    await _advance(migrated, session, 1)

    with _joined(client, session.invite_id, "A") as (a, _):
        for bad in (
            "not json",
            "[1, 2]",
            json.dumps({"type": "nonsense", "step": 1}),
            json.dumps({"type": "submit_choice", "step": "1", "selected": [1, 3]}),
            json.dumps({"type": "submit_choice", "step": True, "selected": [1, 3]}),
            json.dumps({"type": "submit_choice", "step": 1, "selected": "1"}),
            json.dumps({"type": "submit_choice", "step": 1, "selected": [1, "3"]}),
            json.dumps({"type": "submit_choice", "step": 1, "selected": [True]}),
            json.dumps({"type": "submit_text", "step": 1, "text": 5}),
            json.dumps({"type": "submit_command", "step": 1}),
            json.dumps({"type": "reveal_hint"}),
        ):
            a.ws.send_text(bad)
        a.send(1, CORRECT[1])
        assert a.json()["type"] == "attempt"

    assert (
        await migrated.fetchval(
            "select count(*) from learning_attempt where session_id = $1 and position = 1",
            session.id,
        )
        == 1
    )
