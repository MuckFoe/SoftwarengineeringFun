"""Spec 006 task 28: the starter set under `lessons/` (AC-3, FR-3).

Against the real `lessons/` folder, loaded the way startup loads it: the topics and lessons
listed by `GET /api/learn/topics` are exactly the FR-3 set in FR-3's order; each of the eight
lessons is completed over the WebSocket from first to last step with answers taken from the
stored snapshot; and each lesson's snapshot covers the subjects FR-3 names for it (the table
from tasks 14-17).
"""

import json
import re
from collections.abc import AsyncIterator, Iterator
from typing import Any
from urllib.parse import quote

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app import asgi
from app.config import Settings
from app.learn import repo
from app.main import create_app

EXPECTED = [
    (
        "Docker",
        [
            ("01-docker/01-basics", "Basics"),
            ("01-docker/02-ports-volumes-networks", "Ports, volumes and networks"),
            ("01-docker/03-building-images", "Building images"),
            ("01-docker/04-compose", "Docker Compose"),
        ],
    ),
    (
        "Tailscale",
        [
            ("02-tailscale/01-basics", "Basics"),
            ("02-tailscale/02-magicdns-sharing", "MagicDNS and sharing"),
            ("02-tailscale/03-acls-tags", "ACLs and tags"),
            ("02-tailscale/04-exit-nodes", "Exit nodes and subnet routers"),
        ],
    ),
]
LESSON_KEYS = [key for _, lessons in EXPECTED for key, _ in lessons]

# Per lesson (tasks 14-17, AC-3): `accepts` are patterns that some *accepted* terminal
# command must match (a leading `sudo ` is ignored); `mentions` are patterns the lesson's
# text (step titles, bodies and quiz options) must contain, case-insensitively.
SUBJECTS: dict[str, dict[str, list[str]]] = {
    "01-docker/01-basics": {
        "accepts": [
            r"^docker run\b",
            r"^docker ps\b",
            r"^docker stop\b",
            r"^docker rm\b",
            r"^docker logs\b",
            r"^docker exec\b",
        ],
        "mentions": [r"\bimages?\b", r"\bcontainers?\b"],
    },
    "01-docker/02-ports-volumes-networks": {
        "accepts": [
            r"^docker run\b.*\s(-p|--publish)\s+\d+:\d+",  # port publishing
            r"^docker run\b.*\s(-v\s+\"?(\$\(pwd\)|\.|/)|--mount\s+type=bind)",  # bind mount
            r"^docker run\b.*\s-v\s+[A-Za-z][\w.-]*:/",  # named volume
            r"^docker network create\b",
        ],
        "mentions": [r"\bvolumes?\b", r"\bnetworks?\b"],
    },
    "01-docker/03-building-images": {
        "accepts": [
            r"^docker build\b.*\s(-t|--tag)\s",
            r"^docker (push|tag)\b",
        ],
        "mentions": [r"\bDockerfile\b", r"multi-stage", r"\bcache\b", r"\blayers?\b"],
    },
    "01-docker/04-compose": {
        "accepts": [r"^docker compose up\b", r"^docker compose down\b"],
        "mentions": [r"\bdepends_on\b", r"\benvironment\b", r"\bvolumes\b", r"\bservices\b"],
    },
    "02-tailscale/01-basics": {
        "accepts": [r"^tailscale up\b", r"^tailscale status\b", r"^tailscale ping\b"],
        "mentions": [r"\b100\.\d", r"\btailnet\b", r"\binstall"],
    },
    "02-tailscale/02-magicdns-sharing": {
        "accepts": [r"^tailscale serve\b", r"^tailscale funnel\b"],
        "mentions": [r"\bMagicDNS\b", r"\bshar(e|ed|es|ing)\b"],
    },
    "02-tailscale/03-acls-tags": {
        "accepts": [],
        "mentions": [r"\bgroups?\b", r"\bgroup:", r"\btag:", r"\btests\b", r"\bpolicy\b"],
    },
    "02-tailscale/04-exit-nodes": {
        "accepts": [
            r"^tailscale up\b.*--advertise-routes=\S",
            r"^tailscale up\b.*--advertise-exit-node\b",
            r"^tailscale (up|set)\b.*--exit-node=\S",
        ],
        "mentions": [r"\badmin console\b", r"\bapprov"],
    },
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
async def loaded(database_url: str, db: asyncpg.Connection) -> AsyncIterator[asyncpg.Connection]:
    """The database after startup with the real `lessons/` folder (idempotent per module)."""
    await asgi._migrate_and_seed(_settings(database_url))
    yield db


@pytest.fixture
async def client(database_url: str, loaded: asyncpg.Connection) -> AsyncIterator[TestClient]:
    with TestClient(create_app(_settings(database_url))) as test_client:
        yield test_client


async def _snapshots(conn: asyncpg.Connection) -> dict[str, dict[str, Any]]:
    return {lesson.key: lesson.content for lesson in await repo.list_current_lessons(conn)}


def _strip_sudo(command: str) -> str:
    command = " ".join(command.split())
    return command.removeprefix("sudo ")


def _accepted_commands(content: dict[str, Any]) -> list[str]:
    return [
        _strip_sudo(entry["command"])
        for step in content["steps"]
        if step["check"] is not None and step["check"]["type"] == "terminal"
        for entry in step["check"]["accept"]
    ]


def _text(content: dict[str, Any]) -> str:
    parts = []
    for step in content["steps"]:
        parts += [step["title"], step["body"]]
        check = step["check"]
        if check is not None and check["type"] == "choice":
            parts += check["options"]
    return "\n".join(parts)


def _answer(step: dict[str, Any]) -> dict[str, Any]:
    """The client message that passes `step`, from the snapshot alone."""
    check = step["check"]
    if check is None:
        return {"type": "continue"}
    if check["type"] == "choice":
        # Lesson files number options from 1; the wire counts from 0.
        return {"type": "submit_choice", "selected": [n - 1 for n in check["correct"]]}
    if check["type"] == "text":
        return {"type": "submit_text", "text": check["accept"][0]}
    if check["type"] == "terminal":
        return {"type": "submit_command", "command": check["accept"][0]["command"]}
    raise AssertionError(f"unknown check type {check['type']!r}")


def _url(invite: str, name: str) -> str:
    return f"/api/learn/sessions/{invite}/ws?name={quote(name)}"


def _until_passed(ws, key: str, position: int, title: str) -> dict:
    """Reads frames until `step_passed` for `position`; a refusal or a wrong attempt fails."""
    while True:
        event = ws.receive_json()
        where = f"{key} step {position + 1} ({title!r})"
        assert event["type"] != "error", f"{where}: refused with {event['code']!r}"
        if event["type"] == "attempt":
            assert event["attempt"]["correct"] is True, f"{where}: the snapshot answer is wrong"
        if event["type"] == "step_passed":
            assert event["step"] == position, f"{where}: passed {event['step']} instead"
            return event


def _run_through(client: TestClient, key: str, content: dict[str, Any]) -> Iterator[str]:
    """Starts a session on `key` and passes every step in order; yields each step's title."""
    started = client.post("/api/learn/sessions", json={"lesson_key": key})
    assert started.status_code == 201, started.text
    invite = started.json()["invite_id"]
    steps = content["steps"]
    with client.websocket_connect(_url(invite, "Learner")) as ws:
        welcome = ws.receive_json()
        assert welcome["type"] == "welcome"
        assert ws.receive_json()["type"] == "presence"
        for position, step in enumerate(steps):
            ws.send_text(json.dumps({**_answer(step), "step": position}))
            passed = _until_passed(ws, key, position, step["title"])
            if position < len(steps) - 1:
                assert passed["next"]["position"] == position + 1
            yield step["title"]
        assert ws.receive_json()["type"] == "completed", f"{key}: no `completed` after last step"


async def test_ac3_topics_and_lessons_are_the_starter_set_in_order(client: TestClient) -> None:
    """AC-3: Docker then Tailscale, each with its four lessons in FR-3's order, nothing else."""
    topics = client.get("/api/learn/topics")
    assert topics.status_code == 200
    listed = [
        (topic["title"], [(lesson["key"], lesson["title"]) for lesson in topic["lessons"]])
        for topic in topics.json()
    ]
    assert listed == EXPECTED


@pytest.mark.parametrize("key", LESSON_KEYS)
async def test_ac3_each_lesson_can_be_completed_first_to_last(
    client: TestClient, loaded: asyncpg.Connection, key: str
) -> None:
    """AC-3: a scripted WebSocket run with the snapshot's answers reaches `completed`."""
    content = (await _snapshots(loaded))[key]
    passed = list(_run_through(client, key, content))
    assert passed == [step["title"] for step in content["steps"]]

    session = await loaded.fetchrow(
        """select s.completed_at from learning_session s
           join lesson_version v on v.id = s.lesson_version_id
           where v.lesson_key = $1 order by s.created_at desc limit 1""",
        key,
    )
    assert session["completed_at"] is not None


@pytest.mark.parametrize("key", LESSON_KEYS)
async def test_ac3_each_lesson_covers_its_fr3_subjects(
    loaded: asyncpg.Connection, key: str
) -> None:
    """AC-3: the lesson's accepted commands and text cover the subjects FR-3 names for it."""
    content = (await _snapshots(loaded))[key]
    commands = _accepted_commands(content)
    text = _text(content)
    subjects = SUBJECTS[key]
    missing_commands = [
        p for p in subjects["accepts"] if not any(re.search(p, c) for c in commands)
    ]
    missing_mentions = [p for p in subjects["mentions"] if not re.search(p, text, re.IGNORECASE)]
    assert missing_commands == [], f"{key}: no accepted command matches {missing_commands}"
    assert missing_mentions == [], f"{key}: the lesson never mentions {missing_mentions}"


def test_every_listed_lesson_has_a_subjects_row() -> None:
    assert sorted(SUBJECTS) == sorted(LESSON_KEYS)
