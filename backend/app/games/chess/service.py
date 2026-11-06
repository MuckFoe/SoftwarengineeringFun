"""Chess service (spec 014 plan.md "Authority and flow", "Service signatures"): sessions,
joining, seats and the snapshot everyone sees. FR-3..FR-9, NFR-2, NFR-3.

Every changing call takes `lock(session_id)`, opens a transaction, reads the session
`for update`, checks, writes, commits and returns a `Snapshot`. Nothing here broadcasts;
the caller sends the returned snapshot to the hub after the commit.

Deviation from plan.md: `take_seat` and `leave_seat` take a keyword `hub`, because the
snapshot they return lists who is connected and who is away.
"""

import asyncio
import dataclasses
import hashlib
import secrets
import uuid
from dataclasses import dataclass

import asyncpg

from app import clock
from app.accounts.identity import Identity
from app.games.chess import repo, rules
from app.games.chess.hub import ChessHub
from app.present.service import valid_name

Color = str  # "white" | "black"


class Refused(Exception):
    """A refused call; `code` is the `error` code sent to whoever asked."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class Person:
    participant_id: str
    name: str
    signed_in: bool


@dataclass(frozen=True)
class Seat(Person):
    away: bool


@dataclass(frozen=True)
class Seats:
    white: Seat | None
    black: Seat | None


@dataclass(frozen=True)
class MoveView:
    san: str
    # `from` is a keyword, so the wire name is produced by `snapshot_dict`.
    from_: str
    to: str


@dataclass(frozen=True)
class GameView:
    status: str
    fen: str
    turn: str
    ply: int
    moves: list[MoveView]
    last_move: MoveView | None
    check_square: str | None
    legal: dict[str, list[str]]
    promotions: list[str]
    draw_offer_by: str | None
    claim_available_to: str | None
    result: str | None
    reason: str | None


@dataclass(frozen=True)
class Snapshot:
    invite_id: str
    stale: bool
    seats: Seats
    viewers: list[Person]
    game: GameView | None


# --- locking ---------------------------------------------------------------------------------

_locks: dict[uuid.UUID, asyncio.Lock] = {}


def lock(session_id: uuid.UUID) -> asyncio.Lock:
    """The per-session lock; valid because there is one `api` process."""
    found = _locks.get(session_id)
    if found is None:
        found = _locks[session_id] = asyncio.Lock()
    return found


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def _locked_session(conn: asyncpg.Connection, session_id: uuid.UUID) -> repo.ChessSession:
    """Inside a transaction: the session `for update`, refused when it does not exist or is
    stale. Every changing call starts here."""
    session = await repo.lock_session(conn, session_id)
    if session is None or session.deleted_at is not None:
        raise Refused("not_found")
    if session.stale_at is not None:
        raise Refused("session_stale")
    return session


async def _game_in_progress(conn: asyncpg.Connection, session: repo.ChessSession) -> bool:
    if session.current_game_id is None:
        return False
    game = await repo.get_game(conn, session.current_game_id)
    return game is not None and game.ended_at is None


# --- sessions and joining --------------------------------------------------------------------


async def create_session(conn: asyncpg.Connection) -> repo.ChessSession:
    """FR-3: a session with an invite id and nobody in it."""
    return await repo.create_session(conn)


async def join(
    conn: asyncpg.Connection,
    session: repo.ChessSession,
    *,
    name: str | None,
    account: Identity | None,
    rejoin: str | None,
    hub: ChessHub,
) -> tuple[repo.Participant, str]:
    """FR-4..FR-6, FR-9. A signed-in account gets its one participant (rotated token); a
    valid rejoin token reuses its participant and its seat; otherwise a new participant under
    a valid name. A new participant is the starter and White if first, then Black, else a
    viewer (also while a game is in progress or the session is stale)."""
    async with lock(session.id), conn.transaction():
        current = await repo.lock_session(conn, session.id)
        if current is None or current.deleted_at is not None:
            raise Refused("not_found")
        participant, token, is_new = await _participant_for(conn, current, name, account, rejoin)
        if is_new:
            await _seat_newcomer(conn, current, participant, hub)
        await repo.touch_activity(conn, current.id)
        return participant, token


async def _participant_for(
    conn: asyncpg.Connection,
    session: repo.ChessSession,
    name: str | None,
    account: Identity | None,
    rejoin: str | None,
) -> tuple[repo.Participant, str, bool]:
    if account is not None and account.account_sub is not None:
        token = secrets.token_urlsafe(32)
        participant, reused = await repo.join_as_account(
            conn, session.id, account.account_sub, account.name, _hash(token)
        )
        return participant, token, not reused
    if rejoin:
        found = await repo.get_participant_by_token_hash(conn, session.id, _hash(rejoin))
        if found is not None:
            return found, rejoin, False
    clean = valid_name(name or "")
    if clean is None:
        raise Refused("invalid_name")
    token = secrets.token_urlsafe(32)
    return await repo.add_participant(conn, session.id, clean, _hash(token)), token, True


async def _seat_newcomer(
    conn: asyncpg.Connection,
    session: repo.ChessSession,
    participant: repo.Participant,
    hub: ChessHub,
) -> None:
    white, black = session.white_participant_id, session.black_participant_id
    if session.starter_participant_id is None:
        await repo.set_starter(conn, session.id, participant.id)
        white = participant.id
    elif session.stale_at is not None or await _game_in_progress(conn, session):
        return
    elif black is None:
        black = participant.id
    elif white is None:
        white = participant.id
    else:
        return
    await repo.set_seats(conn, session.id, white=white, black=black)
    hub.seated = {p for p in (white, black) if p is not None}


# --- seats -----------------------------------------------------------------------------------


async def take_seat(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    color: Color,
    *,
    hub: ChessHub,
) -> Snapshot:
    """FR-7: a free seat, also used to switch seats. Refused during a game (FR-8)."""
    if color not in ("white", "black"):
        raise Refused("seat_taken")
    async with lock(session_id), conn.transaction():
        session = await _locked_session(conn, session_id)
        if await _game_in_progress(conn, session):
            raise Refused("game_in_progress")
        await _require_participant(conn, session_id, participant_id)
        white, black = session.white_participant_id, session.black_participant_id
        target = white if color == "white" else black
        if target is not None and target != participant_id:
            raise Refused("seat_taken")
        white = None if white == participant_id else white
        black = None if black == participant_id else black
        if color == "white":
            white = participant_id
        else:
            black = participant_id
        await repo.set_seats(conn, session_id, white=white, black=black)
        await repo.touch_activity(conn, session_id)
        hub.seated = {p for p in (white, black) if p is not None}
        return await snapshot(conn, session_id, hub)


async def leave_seat(
    conn: asyncpg.Connection, session_id: uuid.UUID, participant_id: uuid.UUID, *, hub: ChessHub
) -> Snapshot:
    """FR-7: back to being a viewer, the seat free. Refused during a game (FR-8)."""
    async with lock(session_id), conn.transaction():
        session = await _locked_session(conn, session_id)
        if await _game_in_progress(conn, session):
            raise Refused("game_in_progress")
        white, black = session.white_participant_id, session.black_participant_id
        if participant_id not in (white, black):
            raise Refused("not_seated")
        await repo.set_seats(
            conn,
            session_id,
            white=None if white == participant_id else white,
            black=None if black == participant_id else black,
        )
        await repo.touch_activity(conn, session_id)
        hub.seated = {p for p in (white, black) if p is not None and p != participant_id}
        return await snapshot(conn, session_id, hub)


async def start(
    conn: asyncpg.Connection, session_id: uuid.UUID, participant_id: uuid.UUID, *, hub: ChessHub
) -> Snapshot:
    """FR-10..FR-12: a new game for the seated pair, which becomes the current one. Either
    seated player may start; refused while a game is running."""
    async with lock(session_id), conn.transaction():
        session = await _locked_session(conn, session_id)
        white, black = session.white_participant_id, session.black_participant_id
        if participant_id not in (white, black):
            raise Refused("not_a_player")
        if white is None or black is None:
            raise Refused("seats_incomplete")
        if await _game_in_progress(conn, session):
            raise Refused("game_in_progress")
        game = await repo.insert_game(conn, session_id, white, black)
        await repo.set_current_game(conn, session_id, game.id)
        await repo.touch_activity(conn, session_id)
        hub.board = None
        hub.set_game_in_progress(True)
        return await snapshot(conn, session_id, hub)


async def move(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    frm: str,
    to: str,
    promotion: str | None,
    ply: int,
    *,
    hub: ChessHub,
) -> Snapshot:
    """FR-13, FR-14, FR-16..FR-19, FR-22, FR-23: validates in the plan's order (not stale, game
    in progress, the sender plays the side to move, `ply` current, legal), stores the move,
    clears any draw offer and, when the move ends the game, records the result. One
    transaction; the hub's board cache and game flag follow only after it commits."""
    async with lock(session_id):
        try:
            async with conn.transaction():
                session = await _locked_session(conn, session_id)
                game = (
                    await repo.get_game(conn, session.current_game_id)
                    if session.current_game_id
                    else None
                )
                if game is None or game.ended_at is not None:
                    raise Refused("no_game")
                if participant_id not in (game.white_participant_id, game.black_participant_id):
                    raise Refused("not_a_player")
                board = await _board_for(conn, hub, game.id)
                turn_id = game.white_participant_id if board.turn else game.black_participant_id
                if participant_id != turn_id:
                    raise Refused("not_your_turn")
                if ply != board.ply():
                    raise Refused("out_of_date")
                trial = board.copy()
                applied = rules.apply(trial, frm, to, promotion)
                if isinstance(applied, rules.Illegal):
                    raise Refused(applied.reason)
                await repo.insert_move(
                    conn, game.id, board.ply() + 1, applied.uci, applied.san, participant_id
                )
                await repo.set_draw_offer(conn, game.id, None)
                if applied.outcome is not None:
                    await repo.end_game(
                        conn,
                        game.id,
                        result=applied.outcome.result,
                        reason=applied.outcome.reason,
                    )
                await repo.touch_activity(conn, session_id)
                result = await snapshot(conn, session_id, hub)
        except BaseException:
            hub.board = None  # whatever the cache held, the database is the truth
            raise
        hub.board = trial
        if applied.outcome is not None:
            hub.set_game_in_progress(False)
        return result


async def _current_game_for_player(
    conn: asyncpg.Connection, session: repo.ChessSession, participant_id: uuid.UUID
) -> tuple[repo.Game, str]:
    """The game in progress and the colour `participant_id` plays in it, or a refusal."""
    game = await repo.get_game(conn, session.current_game_id) if session.current_game_id else None
    if game is None or game.ended_at is not None:
        raise Refused("no_game")
    if participant_id == game.white_participant_id:
        return game, "white"
    if participant_id == game.black_participant_id:
        return game, "black"
    raise Refused("not_a_player")


async def offer_draw(
    conn: asyncpg.Connection, session_id: uuid.UUID, participant_id: uuid.UUID, *, hub: ChessHub
) -> Snapshot:
    """FR-25: a player offers a draw; one offer stands at a time."""
    async with lock(session_id), conn.transaction():
        session = await _locked_session(conn, session_id)
        game, color = await _current_game_for_player(conn, session, participant_id)
        if game.draw_offer_by == color:
            raise Refused("own_draw_offer")
        await repo.set_draw_offer(conn, game.id, color)
        await repo.touch_activity(conn, session_id)
        return await snapshot(conn, session_id, hub)


async def answer_draw(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    accept: bool,
    *,
    hub: ChessHub,
) -> Snapshot:
    """FR-25, FR-26: the opponent of the offerer accepts (draw by agreement) or declines
    (the offer is cleared and play goes on)."""
    async with lock(session_id), conn.transaction():
        session = await _locked_session(conn, session_id)
        game, color = await _current_game_for_player(conn, session, participant_id)
        if game.draw_offer_by is None:
            raise Refused("no_draw_offer")
        if game.draw_offer_by == color:
            raise Refused("own_draw_offer")
        if accept:
            await repo.end_game(conn, game.id, result="draw", reason="agreement")
        else:
            await repo.set_draw_offer(conn, game.id, None)
        await repo.touch_activity(conn, session_id)
        result = await snapshot(conn, session_id, hub)
    if accept:
        hub.set_game_in_progress(False)
    return result


async def _board_for(conn: asyncpg.Connection, hub: ChessHub, game_id: uuid.UUID):
    """The hub's cached board, rebuilt from the stored moves on a miss."""
    if hub.board is None:
        hub.board = rules.replay([m.uci for m in await repo.list_moves(conn, game_id)])
    return hub.board


async def _require_participant(
    conn: asyncpg.Connection, session_id: uuid.UUID, participant_id: uuid.UUID
) -> None:
    known = await repo.list_participants(conn, session_id)
    if participant_id not in {p.id for p in known}:
        raise Refused("not_a_player")


# --- resign and delete (plan.md "Closing and deleting a session") -----------------------------


@dataclass(frozen=True)
class Closed:
    """What `session_closed` carries: the game's result (None when no game was ended) and why
    the session closed (`resignation`, `abandonment`, `starter` or `admin`)."""

    result: str | None
    reason: str


async def resign(
    conn: asyncpg.Connection, session_id: uuid.UUID, participant_id: uuid.UUID
) -> Closed:
    """FR-24: the resigning player's opponent wins, then the session is deleted (FR-34)."""
    async with lock(session_id), conn.transaction():
        session = await _locked_session(conn, session_id)
        game = (
            await repo.get_game(conn, session.current_game_id) if session.current_game_id else None
        )
        if game is None or game.ended_at is not None:
            raise Refused("no_game")
        if participant_id == game.white_participant_id:
            winner = "black"
        elif participant_id == game.black_participant_id:
            winner = "white"
        else:
            raise Refused("not_a_player")
        return await delete_session_locked(
            conn,
            session,
            reason="resignation",
            by_participant=participant_id,
            by_sub=None,
            result=winner,
        )


async def delete_session(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    *,
    reason: str,
    by_participant: uuid.UUID | None,
    by_sub: str | None,
    result: str | None = None,
) -> Closed:
    """FR-34, FR-35: soft-deletes the session under its lock, in one transaction. `reason` is
    `starter` (only the starter's participant may; `not_starter` otherwise), `admin`,
    `resignation` or `abandonment`. With `result` set, the game in progress ends first with
    that result and `reason`. Refused `not_found` when absent or already deleted, and
    `session_stale` unless the caller is an admin. Nothing is broadcast here: the caller sends
    `ws.close_session` with the returned `Closed` after the commit."""
    async with lock(session_id), conn.transaction():
        session = await repo.lock_session(conn, session_id)
        if session is None or session.deleted_at is not None:
            raise Refused("not_found")
        if session.stale_at is not None and reason != "admin":
            raise Refused("session_stale")
        return await delete_session_locked(
            conn,
            session,
            reason=reason,
            by_participant=by_participant,
            by_sub=by_sub,
            result=result,
        )


async def delete_session_locked(
    conn: asyncpg.Connection,
    session: repo.ChessSession,
    *,
    reason: str,
    by_participant: uuid.UUID | None,
    by_sub: str | None,
    result: str | None = None,
) -> Closed:
    """`delete_session` for a caller that already holds `lock(session.id)` inside a transaction
    with the session read `for update` (`resign`, `claim_win`)."""
    if reason == "starter" and (
        by_participant is None or by_participant != session.starter_participant_id
    ):
        raise Refused("not_starter")
    ended: str | None = None
    if result is not None and session.current_game_id is not None:
        game = await repo.get_game(conn, session.current_game_id)
        if game is not None and game.ended_at is None:
            await repo.end_game(conn, game.id, result=result, reason=reason)
            ended = result
    if not await repo.soft_delete(conn, session.id, reason, by_sub=by_sub):
        raise Refused("not_found")
    return Closed(result=ended, reason=reason)


# --- snapshot --------------------------------------------------------------------------------


async def snapshot(conn: asyncpg.Connection, session_id: uuid.UUID, hub: ChessHub) -> Snapshot:
    """FR-9, NFR-3: the one view every participant gets."""
    session = await repo.get_session(conn, session_id)
    if session is None:
        raise Refused("not_found")
    people = {p.id: p for p in await repo.list_participants(conn, session_id)}

    def seat(pid: uuid.UUID | None) -> Seat | None:
        person = people.get(pid) if pid else None
        if person is None:
            return None
        return Seat(str(person.id), person.display_name, person.signed_in, pid in hub.away_since)

    seated = {session.white_participant_id, session.black_participant_id}
    viewers = [
        Person(str(c.participant_id), c.name, c.signed_in)
        for c in hub.connections.values()
        if c.participant_id not in seated
    ]
    game_view = await _game_view(conn, session)
    if game_view is not None and game_view.status == "in_progress":
        game_view = dataclasses.replace(
            game_view,
            claim_available_to=_claim_available_to(
                hub, session.white_participant_id, session.black_participant_id
            ),
        )
    return Snapshot(
        invite_id=session.invite_id,
        stale=session.stale_at is not None,
        seats=Seats(seat(session.white_participant_id), seat(session.black_participant_id)),
        viewers=viewers,
        game=game_view,
    )


# --- claiming the win after abandonment (FR-28, FR-33) ---------------------------------------

_CLAIM_SLACK = (
    0.05  # seconds: the hub's timer sleeps on the loop's clock, `away_since` is wall time
)


def _claim_available_to(
    hub: ChessHub, white: uuid.UUID | None, black: uuid.UUID | None
) -> str | None:
    """The colour that may claim the win, if any: it is connected, its opponent has been away
    for the whole interval without interruption. Both away means nobody can claim."""
    if white is None or black is None:
        return None
    now = clock.now()
    for color, mine, theirs in (("white", white, black), ("black", black, white)):
        since = hub.away_since.get(theirs)
        if (
            since is not None
            and mine in hub.connections
            and mine not in hub.away_since
            and (now - since).total_seconds() + _CLAIM_SLACK >= hub.abandon_seconds
        ):
            return color
    return None


async def claim_win(
    conn: asyncpg.Connection, session_id: uuid.UUID, participant_id: uuid.UUID, hub: ChessHub
) -> Closed:
    """FR-33: the present seated player wins by abandonment once the opponent has been away the
    whole interval; the session is then closed (FR-34). Re-checks everything itself; neither the
    hub timer nor the client is trusted."""
    async with lock(session_id), conn.transaction():
        session = await _locked_session(conn, session_id)
        game = (
            await repo.get_game(conn, session.current_game_id) if session.current_game_id else None
        )
        if game is None or game.ended_at is not None:
            raise Refused("claim_not_available")
        color = _claim_available_to(hub, game.white_participant_id, game.black_participant_id)
        mine = game.white_participant_id if color == "white" else game.black_participant_id
        if color is None or participant_id != mine:
            raise Refused("claim_not_available")
        return await delete_session_locked(
            conn,
            session,
            reason="abandonment",
            by_participant=participant_id,
            by_sub=None,
            result=color,
        )


async def _game_view(conn: asyncpg.Connection, session: repo.ChessSession) -> GameView | None:
    if session.current_game_id is None:
        return None
    game = await repo.get_game(conn, session.current_game_id)
    if game is None:
        return None
    stored = await repo.list_moves(conn, game.id)
    board = rules.replay([m.uci for m in stored])
    moves = [MoveView(m.san, m.uci[:2], m.uci[2:4]) for m in stored]
    ended = game.ended_at is not None
    board_view = rules.view(board)
    return GameView(
        status="ended" if ended else "in_progress",
        fen=board_view.fen,
        turn=board_view.turn,
        ply=len(stored),
        moves=moves,
        last_move=moves[-1] if moves else None,
        check_square=board_view.check_square,
        legal={} if ended else board_view.legal,
        promotions=[] if ended else board_view.promotions,
        draw_offer_by=game.draw_offer_by,
        claim_available_to=None,
        result=game.result,
        reason=game.reason,
    )
