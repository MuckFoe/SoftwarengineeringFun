"""Rock Paper Siege service (spec 021 plan.md "Service flow", Decision 1): sessions, joining,
seats, Start, setup (place, re-deal, Ready), play (move, duel picks), draws, resign, the away
claim, deletion and the unfiltered snapshot. FR-2, FR-4..FR-6, FR-8, FR-11..FR-19, NFR-1, NFR-4.

The lifecycle is `app.games.chess.service` copied and adapted to seats `a`/`b`. Every changing
call takes `lock(session_id)`, opens a transaction, reads the session `for update`, checks,
writes and returns the full stored state (`views.FullState`); `move` and `duel_pick` also
return the raw event. Nothing here filters or broadcasts: the caller encodes per recipient
through `app.games.rps.views` after the commit.
"""

import asyncio
import hashlib
import secrets
import uuid
from dataclasses import dataclass
from typing import Literal, cast

import asyncpg

from app import clock
from app.accounts.identity import Identity
from app.games.chess.hub import ChessHub
from app.games.rps import repo, rules
from app.games.rps.rules import Side, Weapon
from app.games.rps.views import (
    DuelEvent,
    DuelRoundEvent,
    DuelState,
    FightEvent,
    FlagEvent,
    FullState,
    GameState,
    MovedEvent,
    Person,
    RawEvent,
    Seat,
    TrappedEvent,
)
from app.present.service import valid_name

# NFR-1: deals and the first mover come from the OS's unpredictable source, never a seed.
_rng = secrets.SystemRandom()


class Refused(Exception):
    """A refused call; `code` is the `error` code sent to whoever asked."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


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


async def _locked_session(conn: asyncpg.Connection, session_id: uuid.UUID) -> repo.RpsSession:
    """Inside a transaction: the session `for update`, refused when it does not exist or is
    stale. Every changing call starts here."""
    session = await repo.lock_session(conn, session_id)
    if session is None or session.deleted_at is not None:
        raise Refused("not_found")
    if session.stale_at is not None:
        raise Refused("session_stale")
    return session


async def _current_game(conn: asyncpg.Connection, session: repo.RpsSession) -> repo.Game | None:
    if session.current_game_id is None:
        return None
    return await repo.get_game(conn, session.current_game_id)


async def _game_in_progress(conn: asyncpg.Connection, session: repo.RpsSession) -> bool:
    game = await _current_game(conn, session)
    return game is not None and game.ended_at is None


# --- sessions and joining --------------------------------------------------------------------


async def create_session(conn: asyncpg.Connection) -> repo.RpsSession:
    """FR-2: a session with an invite id and nobody in it."""
    return await repo.create_session(conn)


async def join(
    conn: asyncpg.Connection,
    session: repo.RpsSession,
    *,
    name: str | None,
    account: Identity | None,
    rejoin: str | None,
    hub: ChessHub,
) -> tuple[repo.Participant, str]:
    """FR-2 (as chess): a signed-in account gets its one participant (rotated token); a valid
    rejoin token reuses its participant and its seat; otherwise a new participant under a valid
    name. A new participant is the starter and side a if first, then side b, else a viewer
    (also while a game is in progress or the session is stale)."""
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
    session: repo.RpsSession,
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
    session: repo.RpsSession,
    participant: repo.Participant,
    hub: ChessHub,
) -> None:
    a, b = session.a_participant_id, session.b_participant_id
    if session.starter_participant_id is None:
        await repo.set_starter(conn, session.id, participant.id)
        a = participant.id
    elif session.stale_at is not None or await _game_in_progress(conn, session):
        return
    elif b is None:
        b = participant.id
    elif a is None:
        a = participant.id
    else:
        return
    await repo.set_seats(conn, session.id, a=a, b=b)
    hub.seated = {p for p in (a, b) if p is not None}


async def _require_participant(
    conn: asyncpg.Connection, session_id: uuid.UUID, participant_id: uuid.UUID
) -> None:
    known = await repo.list_participants(conn, session_id)
    if participant_id not in {p.id for p in known}:
        raise Refused("not_a_player")


# --- seats -----------------------------------------------------------------------------------


async def take_seat(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    side: str,
    *,
    hub: ChessHub,
) -> FullState:
    """FR-2: a free seat, also used to switch seats. Refused during a game."""
    if side not in ("a", "b"):
        raise Refused("seat_taken")
    async with lock(session_id), conn.transaction():
        session = await _locked_session(conn, session_id)
        if await _game_in_progress(conn, session):
            raise Refused("game_in_progress")
        await _require_participant(conn, session_id, participant_id)
        a, b = session.a_participant_id, session.b_participant_id
        target = a if side == "a" else b
        if target is not None and target != participant_id:
            raise Refused("seat_taken")
        a = None if a == participant_id else a
        b = None if b == participant_id else b
        if side == "a":
            a = participant_id
        else:
            b = participant_id
        await repo.set_seats(conn, session_id, a=a, b=b)
        await repo.touch_activity(conn, session_id)
        hub.seated = {p for p in (a, b) if p is not None}
        return await snapshot(conn, session_id, hub)


async def leave_seat(
    conn: asyncpg.Connection, session_id: uuid.UUID, participant_id: uuid.UUID, *, hub: ChessHub
) -> FullState:
    """FR-2: back to being a viewer, the seat free. Refused during a game."""
    async with lock(session_id), conn.transaction():
        session = await _locked_session(conn, session_id)
        if await _game_in_progress(conn, session):
            raise Refused("game_in_progress")
        a, b = session.a_participant_id, session.b_participant_id
        if participant_id not in (a, b):
            raise Refused("not_seated")
        await repo.set_seats(
            conn,
            session_id,
            a=None if a == participant_id else a,
            b=None if b == participant_id else b,
        )
        await repo.touch_activity(conn, session_id)
        hub.seated = {p for p in (a, b) if p is not None and p != participant_id}
        return await snapshot(conn, session_id, hub)


# --- Start (FR-2, FR-4, FR-8) ------------------------------------------------------------------


async def start(
    conn: asyncpg.Connection, session_id: uuid.UUID, participant_id: uuid.UUID, *, hub: ChessHub
) -> FullState:
    """A new game in setup for the seated pair, which becomes the current one: the first mover
    by FR-8, and both sides dealt with a random flag and trap square (FR-4). Either seated
    player may start; refused while a game is running, allowed again after it ended."""
    async with lock(session_id), conn.transaction():
        session = await _locked_session(conn, session_id)
        a, b = session.a_participant_id, session.b_participant_id
        if participant_id not in (a, b):
            raise Refused("not_a_player")
        if a is None or b is None:
            raise Refused("seats_incomplete")
        previous = await _current_game(conn, session)
        if previous is not None and previous.ended_at is None:
            raise Refused("game_in_progress")
        prev = (
            None
            if previous is None
            else rules.PrevGame(
                previous.first_side, previous.a_participant_id, previous.b_participant_id
            )
        )
        first = rules.first_side(prev, a, b, _rng)
        game = await repo.insert_game(conn, session_id, a, b, first)
        for side in ("a", "b"):
            flag, trap = _rng.sample(rules.home_squares(side), 2)
            await repo.write_side(conn, game.id, side, rules.deal(side, flag, trap, _rng))
        await repo.set_current_game(conn, session_id, game.id)
        await repo.touch_activity(conn, session_id)
        hub.set_game_in_progress(True)
        return await snapshot(conn, session_id, hub)


# --- setup (FR-5, FR-6, FR-18) -----------------------------------------------------------------


async def _setup_side(
    conn: asyncpg.Connection, session: repo.RpsSession, participant_id: uuid.UUID
) -> tuple[repo.Game, Side]:
    """The game in setup and the side `participant_id` plays, refused when there is no game
    running, the caller does not play in it, or their side is already locked by Ready."""
    game = await _current_game(conn, session)
    if game is None or game.ended_at is not None:
        raise Refused("no_game")
    if participant_id == game.a_participant_id:
        side: Side = "a"
    elif participant_id == game.b_participant_id:
        side = "b"
    else:
        raise Refused("not_a_player")
    if game.a_ready if side == "a" else game.b_ready:
        raise Refused("already_ready")
    return game, side


async def place(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    what: Literal["flag", "trap"],
    square: int,
    *,
    hub: ChessHub,
) -> FullState:
    """FR-4, FR-5: moves the caller's flag or trap to an own home square; whatever stood
    there swaps into the vacated square."""
    if what not in ("flag", "trap"):
        raise Refused("not_home_square")
    async with lock(session_id), conn.transaction():
        session = await _locked_session(conn, session_id)
        game, side = await _setup_side(conn, session, participant_id)
        board = await repo.list_pieces(conn, game.id)
        try:
            placed = rules.place(board, side, what, square)
        except rules.Illegal as illegal:
            raise Refused(illegal.code) from None
        await repo.write_side(conn, game.id, side, placed)
        await repo.touch_activity(conn, session_id)
        return await snapshot(conn, session_id, hub)


async def redeal(
    conn: asyncpg.Connection, session_id: uuid.UUID, participant_id: uuid.UUID, *, hub: ChessHub
) -> FullState:
    """FR-5: the caller's 12 fighters dealt again; flag and trap stay."""
    async with lock(session_id), conn.transaction():
        session = await _locked_session(conn, session_id)
        game, side = await _setup_side(conn, session, participant_id)
        board = await repo.list_pieces(conn, game.id)
        await repo.write_side(conn, game.id, side, rules.redeal(board, side, _rng))
        await repo.touch_activity(conn, session_id)
        return await snapshot(conn, session_id, hub)


async def ready(
    conn: asyncpg.Connection, session_id: uuid.UUID, participant_id: uuid.UUID, *, hub: ChessHub
) -> FullState:
    """FR-6: locks the caller's setup. On the second Ready play begins with `first_side` to
    move; if that side has no legal move, the game ends at once with it as the loser (FR-18)."""
    ended = False
    async with lock(session_id), conn.transaction():
        session = await _locked_session(conn, session_id)
        game, side = await _setup_side(conn, session, participant_id)
        await repo.set_ready(conn, game.id, side)
        other_ready = game.b_ready if side == "a" else game.a_ready
        if other_ready:
            first = game.first_side
            await repo.set_turn(conn, game.id, first)
            board = await repo.list_pieces(conn, game.id)
            if not rules.legal_moves(board, first):
                await repo.end_game(
                    conn, game.id, result="b" if first == "a" else "a", reason="no_moves"
                )
                ended = True
        await repo.touch_activity(conn, session_id)
        result = await snapshot(conn, session_id, hub)
    if ended:
        hub.set_game_in_progress(False)
    return result


# --- play: move and duel (FR-11..FR-18) ---------------------------------------------------------


def _other(side: Side) -> Side:
    return "b" if side == "a" else "a"


async def _game_for_player(
    conn: asyncpg.Connection, session: repo.RpsSession, participant_id: uuid.UUID
) -> tuple[repo.Game, Side]:
    """The game in progress (setup or play) and the side `participant_id` plays in it."""
    game = await _current_game(conn, session)
    if game is None or game.ended_at is not None:
        raise Refused("no_game")
    if participant_id == game.a_participant_id:
        return game, "a"
    if participant_id == game.b_participant_id:
        return game, "b"
    raise Refused("not_a_player")


async def _write_fight(conn: asyncpg.Connection, game_id: uuid.UUID, fought: rules.Fought) -> None:
    """FR-12: the loser's row deleted, the survivor on `to` and revealed."""
    if fought.winner == "attacker":
        await repo.delete_piece(conn, game_id, fought.to)
        await repo.move_piece(conn, game_id, fought.frm, fought.to)
    else:
        await repo.delete_piece(conn, game_id, fought.frm)
    await repo.set_revealed(conn, game_id, fought.to)


async def _end_turn(conn: asyncpg.Connection, game_id: uuid.UUID, mover: Side) -> bool:
    """FR-17, FR-18, FR-19: `ply += 1`, the draw offer cleared, the other side to move; if it
    has no legal move the game ends with it as the loser. Whether the game ended."""
    nxt = _other(mover)
    await repo.end_turn(conn, game_id, nxt)
    if rules.legal_moves(await repo.list_pieces(conn, game_id), nxt):
        return False
    await repo.end_game(conn, game_id, result=mover, reason="no_moves")
    return True


async def move(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    frm: int,
    to: int,
    *,
    hub: ChessHub,
) -> tuple[FullState, RawEvent]:
    """FR-9..FR-18: refused for a non-player, during a duel, out of turn (including setup,
    where nobody's turn has begun) or when `to` is not legal for `frm`. Otherwise the outcome
    is stored and returned with its raw event: a step, fight or trap ends the turn; equal
    weapons reveal both and start a duel (`turn = null`); the flag ends the game."""
    async with lock(session_id), conn.transaction():
        session = await _locked_session(conn, session_id)
        game, side = await _game_for_player(conn, session, participant_id)
        if await repo.get_duel(conn, game.id) is not None:
            raise Refused("duel_pending")
        if game.phase != "play" or game.turn != side:
            raise Refused("not_your_turn")
        board = await repo.list_pieces(conn, game.id)
        outcome = rules.resolve_move(board, side, frm, to)
        if isinstance(outcome, rules.Illegal):
            raise Refused("illegal_move")
        attacker = cast(Weapon, board[frm].kind)
        ended = False
        event: RawEvent
        if isinstance(outcome, rules.Moved):
            await repo.move_piece(conn, game.id, frm, to)
            event = MovedEvent(frm, to)
        elif isinstance(outcome, rules.Fought):
            await _write_fight(conn, game.id, outcome)
            defender = cast(Weapon, board[to].kind)
            event = FightEvent(frm, to, attacker, defender, outcome.winner)
        elif isinstance(outcome, rules.Trapped):
            await repo.delete_piece(conn, game.id, frm)
            event = TrappedEvent(frm, to, attacker, side=side)
        elif isinstance(outcome, rules.DuelStarted):
            await repo.set_revealed(conn, game.id, frm)
            await repo.set_revealed(conn, game.id, to)
            await repo.insert_duel(conn, game.id, from_square=frm, to_square=to, attacker=side)
            await repo.set_turn(conn, game.id, None)
            await repo.set_draw_offer(conn, game.id, None)  # FR-19: a move lapses the offer
            event = DuelEvent(frm, to, attacker)
        else:  # FlagTaken (FR-16)
            await repo.end_game(conn, game.id, result=side, reason="flag")
            ended = True
            event = FlagEvent(frm, to)
        if isinstance(outcome, rules.Moved | rules.Fought | rules.Trapped):
            ended = await _end_turn(conn, game.id, side)
        await repo.touch_activity(conn, session_id)
        result = await snapshot(conn, session_id, hub)
    if ended:
        hub.set_game_in_progress(False)
    return result, event


async def duel_pick(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    weapon: str,
    *,
    hub: ChessHub,
) -> tuple[FullState, RawEvent | None]:
    """FR-13, FR-14, FR-17: stores a player's secret pick (no event while the other is
    missing). With both in, a tie starts the next round with the picks kept as `last_*`; a
    decided round resolves the fight as `Fought` (the fighters keep their weapons), removes the
    duel and ends the attacker's turn as `move` does."""
    if weapon not in rules.WEAPONS:
        raise Refused("illegal_move")
    pick = cast(Weapon, weapon)
    async with lock(session_id), conn.transaction():
        session = await _locked_session(conn, session_id)
        game, side = await _game_for_player(conn, session, participant_id)
        duel = await repo.get_duel(conn, game.id)
        if duel is None:
            raise Refused("no_duel")
        if (duel.a_pick if side == "a" else duel.b_pick) is not None:
            raise Refused("already_picked")
        await repo.set_pick(conn, game.id, side, pick)
        a_pick = pick if side == "a" else duel.a_pick
        b_pick = pick if side == "b" else duel.b_pick
        ended = False
        event: RawEvent | None = None
        if a_pick is not None and b_pick is not None:
            winner = rules.resolve_duel(a_pick, b_pick, duel.attacker)
            if winner is None:
                await repo.next_round(conn, game.id)
                event = DuelRoundEvent(a_pick, b_pick, "again")
            else:
                fought = rules.Fought(duel.from_square, duel.to_square, winner)
                await repo.delete_duel(conn, game.id)
                await _write_fight(conn, game.id, fought)
                ended = await _end_turn(conn, game.id, duel.attacker)
                event = DuelRoundEvent(a_pick, b_pick, winner)
        await repo.touch_activity(conn, session_id)
        result = await snapshot(conn, session_id, hub)
    if ended:
        hub.set_game_in_progress(False)
    return result, event


# --- draws (FR-19, as chess) ------------------------------------------------------------------


async def offer_draw(
    conn: asyncpg.Connection, session_id: uuid.UUID, participant_id: uuid.UUID, *, hub: ChessHub
) -> FullState:
    """A player offers a draw; one offer stands at a time."""
    async with lock(session_id), conn.transaction():
        session = await _locked_session(conn, session_id)
        game, side = await _game_for_player(conn, session, participant_id)
        if game.draw_offer_by == side:
            raise Refused("own_draw_offer")
        await repo.set_draw_offer(conn, game.id, side)
        await repo.touch_activity(conn, session_id)
        return await snapshot(conn, session_id, hub)


async def answer_draw(
    conn: asyncpg.Connection,
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    accept: bool,
    *,
    hub: ChessHub,
) -> FullState:
    """The offerer's opponent accepts (draw by `agreement`) or declines (offer cleared)."""
    async with lock(session_id), conn.transaction():
        session = await _locked_session(conn, session_id)
        game, side = await _game_for_player(conn, session, participant_id)
        if game.draw_offer_by is None:
            raise Refused("no_draw_offer")
        if game.draw_offer_by == side:
            raise Refused("own_draw_offer")
        if accept:
            await repo.delete_duel(conn, game.id)
            await repo.end_game(conn, game.id, result="draw", reason="agreement")
        else:
            await repo.set_draw_offer(conn, game.id, None)
        await repo.touch_activity(conn, session_id)
        result = await snapshot(conn, session_id, hub)
    if accept:
        hub.set_game_in_progress(False)
    return result


# --- resign, claim and delete (FR-2, as chess) -------------------------------------------------


@dataclass(frozen=True)
class Closed:
    """What `session_closed` carries: the game's result (None when no game was ended) and why
    the session closed (`resignation`, `abandonment`, `starter` or `admin`)."""

    result: str | None
    reason: str


async def resign(
    conn: asyncpg.Connection, session_id: uuid.UUID, participant_id: uuid.UUID
) -> Closed:
    """The resigning player's opponent wins, then the session is deleted (as chess)."""
    async with lock(session_id), conn.transaction():
        session = await _locked_session(conn, session_id)
        _game, side = await _game_for_player(conn, session, participant_id)
        return await delete_session_locked(
            conn,
            session,
            reason="resignation",
            by_participant=participant_id,
            by_sub=None,
            result=_other(side),
        )


async def claim_win(
    conn: asyncpg.Connection, session_id: uuid.UUID, participant_id: uuid.UUID, hub: ChessHub
) -> Closed:
    """The present seated player wins by abandonment once the opponent has been away the whole
    interval; the session is then closed. Re-checks everything; trusts neither timer nor
    client."""
    async with lock(session_id), conn.transaction():
        session = await _locked_session(conn, session_id)
        game = await _current_game(conn, session)
        if game is None or game.ended_at is not None:
            raise Refused("claim_not_available")
        side = claim_available_to(hub, game.a_participant_id, game.b_participant_id)
        mine = game.a_participant_id if side == "a" else game.b_participant_id
        if side is None or participant_id != mine:
            raise Refused("claim_not_available")
        return await delete_session_locked(
            conn,
            session,
            reason="abandonment",
            by_participant=participant_id,
            by_sub=None,
            result=side,
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
    """Soft-deletes the session under its lock (as chess). `reason` `starter` needs the
    starter's participant (`not_starter`), `admin` may delete a stale session. Nothing is
    broadcast here: the caller closes the sockets with the returned `Closed` after commit."""
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
    session: repo.RpsSession,
    *,
    reason: str,
    by_participant: uuid.UUID | None,
    by_sub: str | None,
    result: str | None = None,
) -> Closed:
    """`delete_session` for a caller already holding `lock(session.id)` inside a transaction
    with the session read `for update` (`resign`, `claim_win`). With `result`, a running game
    ends first with that result and `reason`; a pending duel goes with it."""
    if reason == "starter" and (
        by_participant is None or by_participant != session.starter_participant_id
    ):
        raise Refused("not_starter")
    ended: str | None = None
    if result is not None and session.current_game_id is not None:
        game = await repo.get_game(conn, session.current_game_id)
        if game is not None and game.ended_at is None:
            await repo.delete_duel(conn, game.id)
            await repo.end_game(conn, game.id, result=result, reason=reason)
            ended = result
    if not await repo.soft_delete(conn, session.id, reason, by_sub=by_sub):
        raise Refused("not_found")
    return Closed(result=ended, reason=reason)


# --- snapshot --------------------------------------------------------------------------------

_CLAIM_SLACK = (
    0.05  # seconds: the hub's timer sleeps on the loop's clock, `away_since` is wall time
)


def claim_available_to(hub: ChessHub, a: uuid.UUID | None, b: uuid.UUID | None) -> Side | None:
    """The side that may claim the win, if any (as chess): it is connected and its opponent has
    been away for the whole interval without interruption. Both away means nobody can."""
    if a is None or b is None:
        return None
    now = clock.now()
    sides: tuple[tuple[Side, uuid.UUID, uuid.UUID], ...] = (("a", a, b), ("b", b, a))
    for side, mine, theirs in sides:
        since = hub.away_since.get(theirs)
        if (
            since is not None
            and mine in hub.connections
            and mine not in hub.away_since
            and (now - since).total_seconds() + _CLAIM_SLACK >= hub.abandon_seconds
        ):
            return side
    return None


async def snapshot(conn: asyncpg.Connection, session_id: uuid.UUID, hub: ChessHub) -> FullState:
    """The full stored state: session, seats, viewers, current game, every piece and the duel.
    Nothing is filtered here; `views` decides what each recipient sees."""
    session = await repo.get_session(conn, session_id)
    if session is None:
        raise Refused("not_found")
    people = {p.id: p for p in await repo.list_participants(conn, session_id)}

    def seat(pid: uuid.UUID | None) -> Seat | None:
        person = people.get(pid) if pid else None
        if person is None:
            return None
        return Seat(str(person.id), person.display_name, person.signed_in, pid in hub.away_since)

    seated = {session.a_participant_id, session.b_participant_id}
    viewers = [
        Person(str(c.participant_id), c.name, c.signed_in)
        for c in hub.connections.values()
        if c.participant_id not in seated
    ]
    game = await _current_game(conn, session)
    return FullState(
        invite_id=session.invite_id,
        stale=session.stale_at is not None,
        seat_a=seat(session.a_participant_id),
        seat_b=seat(session.b_participant_id),
        viewers=tuple(viewers),
        game=None if game is None else await _game_state(conn, session, game, hub),
    )


async def _game_state(
    conn: asyncpg.Connection, session: repo.RpsSession, game: repo.Game, hub: ChessHub
) -> GameState:
    duel = await repo.get_duel(conn, game.id)
    return GameState(
        status=game.phase,
        a_ready=game.a_ready,
        b_ready=game.b_ready,
        first=game.first_side,
        turn=game.turn,
        ply=game.ply,
        board=await repo.list_pieces(conn, game.id),
        duel=None
        if duel is None
        else DuelState(
            frm=duel.from_square,
            to=duel.to_square,
            attacker=duel.attacker,
            round=duel.round,
            a_pick=duel.a_pick,
            b_pick=duel.b_pick,
            last_a_pick=duel.last_a_pick,
            last_b_pick=duel.last_b_pick,
        ),
        draw_offer_by=game.draw_offer_by,
        claim_available_to=None
        if game.ended_at is not None
        else claim_available_to(hub, session.a_participant_id, session.b_participant_id),
        result=game.result,
        reason=game.reason,
    )
