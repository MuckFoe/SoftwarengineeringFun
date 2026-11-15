"""Spec 021 test helper: a Rock Paper Siege game on a fixed board, written through `repo`.

Integration tests that need a known position call `fixed_game` instead of stubbing the random
source (plan.md "Test strategy"). Everything goes into the real database through
`app.games.rps.repo`, so a test reads back exactly what the service would.
"""

import hashlib
import secrets
from collections.abc import Mapping
from dataclasses import dataclass

import asyncpg

from app.games.rps import repo
from app.games.rps.rules import Board, Piece, Side


@dataclass(frozen=True)
class FixedGame:
    session: repo.RpsSession
    a: repo.Participant
    b: repo.Participant
    game: repo.Game
    token_a: str  # rejoin tokens, for tests that connect sockets as these players
    token_b: str


def _token() -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    return token, hashlib.sha256(token.encode()).hexdigest()


def pieces(spec: Mapping[int, str]) -> dict[int, Piece]:
    """Shorthand: `{3: "a rock", 38: "b flag", 10: "a paper*"}`; a trailing `*` marks the
    piece revealed."""
    out: dict[int, Piece] = {}
    for square, text in spec.items():
        side, kind = text.split()
        out[square] = Piece(side, kind.rstrip("*"), kind.endswith("*"))  # type: ignore[arg-type]
    return out


async def fixed_game(
    conn: asyncpg.Connection,
    board: Board,
    *,
    turn: Side | None = "a",
    first_side: Side = "a",
    ready: bool = True,
    names: tuple[str, str] = ("Ana", "Bo"),
) -> FixedGame:
    """A session with two seated guests and one game holding exactly `board`.

    `ready=True` (default) is a game in play with `turn` to move; `ready=False` is a game in
    setup (both unready, `turn` forced to None)."""
    session = await repo.create_session(conn)
    token_a, hash_a = _token()
    token_b, hash_b = _token()
    a = await repo.add_participant(conn, session.id, names[0], hash_a)
    b = await repo.add_participant(conn, session.id, names[1], hash_b)
    await repo.set_starter(conn, session.id, a.id)
    await repo.set_seats(conn, session.id, a=a.id, b=b.id)
    game = await repo.insert_game(conn, session.id, a.id, b.id, first_side)
    await repo.set_current_game(conn, session.id, game.id)
    for side in ("a", "b"):
        await repo.write_side(conn, game.id, side, board)
    if ready:
        await repo.set_ready(conn, game.id, "a")
        await repo.set_ready(conn, game.id, "b")
        await repo.set_turn(conn, game.id, turn)
    read = await repo.get_session(conn, session.id)
    got = await repo.get_game(conn, game.id)
    assert read is not None and got is not None
    return FixedGame(read, a, b, got, token_a, token_b)
