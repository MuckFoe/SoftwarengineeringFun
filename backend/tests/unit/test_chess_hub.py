"""Task 10: chess hub — connections, away tracking, abandon timers, cap
(FR-28, FR-32, FR-33, NFR-6)."""

import asyncio
import uuid
from datetime import UTC, datetime

import chess

from app.config import load_settings
from app.games.chess.hub import ChessHub
from app.sessions.hub import MAX_PARTICIPANTS
from tests.unit.test_config import REQUIRED

T0 = datetime(2026, 11, 3, 12, 0, tzinfo=UTC)


class FakeSocket:
    async def send_json(self, data: object) -> None:
        pass


def join(hub: ChessHub, seated: bool = False) -> tuple[uuid.UUID, FakeSocket]:
    pid, ws = uuid.uuid4(), FakeSocket()
    if seated:
        hub.seated.add(pid)
    assert hub.try_reserve(pid)
    hub.add(pid, ws, "P")
    return pid, ws


def make_hub(fired: list[uuid.UUID], seconds: float = 0.05) -> ChessHub:
    async def on_elapsed(pid: uuid.UUID) -> None:
        fired.append(pid)

    return ChessHub(abandon_seconds=seconds, on_abandon_elapsed=on_elapsed)


# --- FR-28 ----------------------------------------------------------------------------


async def test_fr28_seated_last_socket_close_sets_away_and_reconnect_clears() -> None:
    hub = make_hub([])
    pid, ws = join(hub, seated=True)
    assert hub.remove(pid, ws)
    assert pid in hub.away_since
    assert hub.try_reserve(pid)
    hub.add(pid, FakeSocket(), "P")
    assert pid not in hub.away_since


async def test_fr28_non_seated_close_is_not_away() -> None:
    hub = make_hub([])
    pid, ws = join(hub)
    hub.remove(pid, ws)
    assert hub.away_since == {}


async def test_fr28_replaced_socket_removal_is_not_away() -> None:
    hub = make_hub([])
    pid, ws = join(hub, seated=True)
    hub.replace(pid, FakeSocket())
    assert not hub.remove(pid, ws)
    assert hub.away_since == {}


async def test_fr28_mark_all_seated_away_uses_given_time() -> None:
    hub = make_hub([])
    a, b = uuid.uuid4(), uuid.uuid4()
    hub.seated.update({a, b})
    hub.mark_all_seated_away(T0)
    assert hub.away_since == {a: T0, b: T0}


async def test_fr28_away_since_uses_app_clock() -> None:
    from app import clock

    hub = make_hub([])
    pid, ws = join(hub, seated=True)
    with clock.frozen(T0):
        hub.remove(pid, ws)
    assert hub.away_since[pid] == T0


# --- FR-33 / NFR-6 --------------------------------------------------------------------


async def test_fr33_timer_fires_after_interval_during_game() -> None:
    fired: list[uuid.UUID] = []
    hub = make_hub(fired)
    pid, ws = join(hub, seated=True)
    hub.set_game_in_progress(True)
    hub.remove(pid, ws)
    await asyncio.sleep(0.15)
    assert fired == [pid]


async def test_fr33_reconnect_cancels_and_next_disconnect_starts_fresh() -> None:
    fired: list[uuid.UUID] = []
    hub = make_hub(fired, seconds=0.2)
    pid, ws = join(hub, seated=True)
    hub.set_game_in_progress(True)
    hub.remove(pid, ws)
    await asyncio.sleep(0.12)
    assert hub.try_reserve(pid)
    _, ws2 = pid, FakeSocket()
    hub.add(pid, ws2, "P")
    assert hub.timers == {}
    await asyncio.sleep(0.2)
    assert fired == []
    hub.remove(pid, ws2)
    await asyncio.sleep(0.12)
    assert fired == []  # a fresh full interval, not the remainder
    await asyncio.sleep(0.15)
    assert fired == [pid]


async def test_nfr6_no_timer_without_a_game() -> None:
    hub = make_hub([])
    pid, ws = join(hub, seated=True)
    hub.remove(pid, ws)
    assert hub.timers == {}


async def test_nfr6_no_timer_while_seated_players_are_connected() -> None:
    hub = make_hub([])
    join(hub, seated=True)
    hub.set_game_in_progress(True)
    assert hub.timers == {}


async def test_nfr6_game_start_with_away_player_starts_timer_and_end_stops_it() -> None:
    hub = make_hub([], seconds=10)
    pid, ws = join(hub, seated=True)
    hub.remove(pid, ws)
    hub.set_game_in_progress(True)
    assert set(hub.timers) == {pid}
    hub.set_game_in_progress(False)
    assert hub.timers == {}


# --- FR-32 ----------------------------------------------------------------------------


async def test_fr32_cap_counts_away_seated_and_refuses_sixth() -> None:
    hub = make_hub([])
    seated = [join(hub, seated=True) for _ in range(2)]
    for pid, ws in seated:
        hub.remove(pid, ws)  # away, still hold seats
    for _ in range(MAX_PARTICIPANTS - 2):
        join(hub)
    assert not hub.try_reserve(uuid.uuid4())


async def test_fr32_rejoining_seated_always_admitted_when_full() -> None:
    hub = make_hub([])
    pid, ws = join(hub, seated=True)
    hub.remove(pid, ws)
    for _ in range(MAX_PARTICIPANTS - 1):
        join(hub)
    assert not hub.try_reserve(uuid.uuid4())
    assert hub.try_reserve(pid)
    hub.add(pid, FakeSocket(), "P")
    assert pid in hub.connections


async def test_fr32_reservation_can_be_released() -> None:
    hub = make_hub([])
    for _ in range(MAX_PARTICIPANTS - 1):
        join(hub)
    pid = uuid.uuid4()
    assert hub.try_reserve(pid)
    other = uuid.uuid4()
    assert not hub.try_reserve(other)
    hub.release_reservation(pid)
    assert hub.try_reserve(other)


async def test_replace_returns_old_connection_for_4409() -> None:
    hub = make_hub([])
    pid, ws = join(hub)
    new = FakeSocket()
    old = hub.replace(pid, new)
    assert old.websocket is ws
    assert hub.connections[pid].websocket is new


def test_board_cache_holds_a_board() -> None:
    hub = ChessHub(abandon_seconds=1, on_abandon_elapsed=None)
    assert hub.board is None
    hub.board = chess.Board()
    assert hub.board.turn is chess.WHITE


# --- config ---------------------------------------------------------------------------


def test_chess_abandon_seconds_default_and_env() -> None:
    assert load_settings(REQUIRED).chess_abandon_seconds == 120.0
    assert load_settings({**REQUIRED, "CHESS_ABANDON_SECONDS": "0.5"}).chess_abandon_seconds == 0.5
