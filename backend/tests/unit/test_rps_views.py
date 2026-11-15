"""The secrecy filter (spec 021 plan Decision 2): every recipient x phase (setup, play, duel,
ended). AC-7, AC-11, AC-12, AC-13, AC-15, AC-20, AC-21, AC-24; FR-9, FR-22, NFR-1."""

# Seeded random.Random makes the dealt boards deterministic here.
# ruff: noqa: S311

import json
import random
from dataclasses import replace

import pytest

from app.games.rps import rules, views
from app.games.rps.rules import Piece
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
    Seat,
    TrappedEvent,
)

RECIPIENTS = ["a", "b", "viewer"]
A_FLAG, A_TRAP, B_FLAG, B_TRAP = 0, 1, 41, 40


def dealt(seed=1):
    rng = random.Random(seed)
    return {**rules.deal("a", A_FLAG, A_TRAP, rng), **rules.deal("b", B_FLAG, B_TRAP, rng)}


def game(board, **kw):
    base = {
        "status": "play",
        "a_ready": True,
        "b_ready": True,
        "first": "a",
        "turn": "a",
        "ply": 0,
        "board": board,
        "duel": None,
        "draw_offer_by": None,
        "claim_available_to": None,
        "result": None,
        "reason": None,
    }
    return GameState(**{**base, **kw})


def full(g):
    return FullState(
        invite_id="inv",
        stale=False,
        seat_a=Seat("pa", "Ann", True, False),
        seat_b=Seat("pb", "Bob", False, True),
        viewers=(Person("pv", "Vic", False),),
        game=g,
    )


def setup_state(seed=1):
    return full(game(dealt(seed), status="setup", a_ready=True, b_ready=False, turn=None))


def pieces_by_square(state):
    return {p["square"]: p for p in state["game"]["pieces"]}


def opponent(recipient):
    return {"a": "b", "b": "a"}[recipient]


# --- the envelope -----------------------------------------------------------------------------


def test_state_carries_session_fields_and_is_json():
    out = views.state_for(setup_state(), "viewer")
    json.dumps(out)
    assert out["invite_id"] == "inv"
    assert out["stale"] is False
    assert out["you"] == "viewer"
    assert out["seats"]["a"] == {
        "participant_id": "pa",
        "name": "Ann",
        "signed_in": True,
        "away": False,
    }
    assert out["seats"]["b"]["away"] is True
    assert out["viewers"] == [{"participant_id": "pv", "name": "Vic", "signed_in": False}]
    g = out["game"]
    assert g["status"] == "setup"
    assert g["ready"] == {"a": True, "b": False}
    assert set(g) == {
        "status",
        "ready",
        "first",
        "turn",
        "ply",
        "pieces",
        "legal",
        "duel",
        "draw_offer_by",
        "claim_available_to",
        "result",
        "reason",
    }


def test_no_game_is_null():
    state = replace(full(None), seat_b=None)
    out = views.state_for(state, "a")
    assert out["game"] is None
    assert out["seats"]["b"] is None


# --- AC-7 (FR-7, FR-22): setup ----------------------------------------------------------------


@pytest.mark.parametrize("me", ["a", "b"])
@pytest.mark.parametrize("seed", range(5))
def test_setup_shows_opponent_only_fourteen_hidden_pieces(me, seed):
    them = opponent(me)
    out = views.state_for(setup_state(seed), me)
    theirs = [p for p in out["game"]["pieces"] if p["side"] == them]
    assert sorted(p["square"] for p in theirs) == rules.home_squares(them)
    # Nothing distinguishes flag, trap or fighters: every entry is identical but for the square.
    assert {json.dumps({k: v for k, v in p.items() if k != "square"}) for p in theirs} == {
        json.dumps({"side": them, "kind": None, "revealed": False})
    }
    # Different deals give the recipient byte-identical opponent data.
    other = views.state_for(setup_state(seed + 100), me)
    assert [p for p in other["game"]["pieces"] if p["side"] == them] == theirs


@pytest.mark.parametrize("me", ["a", "b"])
def test_setup_shows_own_pieces_in_full(me):
    state = setup_state()
    out = pieces_by_square(views.state_for(state, me))
    for sq, piece in state.game.board.items():
        if piece.side == me:
            assert out[sq]["kind"] == piece.kind


def test_setup_viewer_sees_both_setups():
    state = setup_state()
    out = pieces_by_square(views.state_for(state, "viewer"))
    assert {sq: p["kind"] for sq, p in out.items()} == {
        sq: p.kind for sq, p in state.game.board.items()
    }


@pytest.mark.parametrize("who", RECIPIENTS)
def test_setup_has_no_legal_moves(who):
    assert views.state_for(setup_state(), who)["game"]["legal"] == {}


# --- play: AC-11, AC-12, AC-15, FR-9 ----------------------------------------------------------


def test_moved_hidden_fighter_stays_hidden_to_opponent():
    board = dealt()
    frm = 7  # side a's second home row, a fighter
    assert board[frm].kind in rules.WEAPONS
    moved = rules.apply(board, rules.Moved(frm, 14))
    state = full(game(moved, turn="b", ply=1))
    assert pieces_by_square(views.state_for(state, "b"))[14]["kind"] is None
    assert pieces_by_square(views.state_for(state, "a"))[14]["kind"] == board[frm].kind
    assert pieces_by_square(views.state_for(state, "viewer"))[14]["kind"] == board[frm].kind


@pytest.mark.parametrize("who", RECIPIENTS)
def test_revealed_fighters_show_to_everyone(who):
    board = {8: Piece("a", "rock", True), 15: Piece("b", "paper", True), 22: Piece("b", "rock")}
    out = pieces_by_square(views.state_for(full(game(board)), who))
    assert out[8] == {"square": 8, "side": "a", "kind": "rock", "revealed": True}
    assert out[15] == {"square": 15, "side": "b", "kind": "paper", "revealed": True}


@pytest.mark.parametrize("me", ["a", "b"])
def test_opponent_flag_and_trap_are_always_hidden(me):
    them = opponent(me)
    # Even a (never expected) revealed flag or trap stays hidden to the opponent.
    board = {
        20: Piece(them, "flag", True),
        21: Piece(them, "trap", True),
        22: Piece(them, "trap", False),
        23: Piece(me, "trap", False),
    }
    out = pieces_by_square(views.state_for(full(game(board)), me))
    assert out[20]["kind"] is None
    assert out[21]["kind"] is None
    assert out[22]["kind"] is None
    assert out[23]["kind"] == "trap"


def test_trap_shows_as_ordinary_hidden_piece_after_catching():
    board = {33: Piece("a", "scissors", True), 40: Piece("b", "trap"), 39: Piece("b", "rock")}
    after = rules.apply(board, rules.Trapped(33, 40))
    out = pieces_by_square(views.state_for(full(game(after, turn="b", ply=1)), "a"))
    assert 33 not in out
    assert out[40] == out[39] | {"square": 40}
    assert out[40] == {"square": 40, "side": "b", "kind": None, "revealed": False}


def test_legal_moves_go_only_to_the_side_to_move():
    board = dealt()
    state = full(game(board, turn="a"))
    want = {sq: targets for sq, targets in rules.legal_moves(board, "a").items()}
    assert want
    assert views.state_for(state, "a")["game"]["legal"] == want
    assert views.state_for(state, "b")["game"]["legal"] == {}
    assert views.state_for(state, "viewer")["game"]["legal"] == {}
    state_b = full(game(board, turn="b"))
    assert views.state_for(state_b, "a")["game"]["legal"] == {}
    assert views.state_for(state_b, "b")["game"]["legal"] == rules.legal_moves(board, "b")


def test_legal_is_json_with_string_keys_of_the_same_moves():
    state = full(game(dealt(), turn="a"))
    wire = json.loads(json.dumps(views.state_for(state, "a")))
    assert wire["game"]["legal"] == {
        str(k): v for k, v in rules.legal_moves(state.game.board, "a").items()
    }


# --- duel: AC-13, AC-21 -----------------------------------------------------------------------


def duel_state(*, a_pick=None, b_pick=None, last=(None, None), rnd=1):
    board = {8: Piece("a", "paper", True), 15: Piece("b", "paper", True)}
    duel = DuelState(
        frm=8,
        to=15,
        attacker="a",
        round=rnd,
        a_pick=a_pick,
        b_pick=b_pick,
        last_a_pick=last[0],
        last_b_pick=last[1],
    )
    return full(game(board, turn=None, duel=duel, ply=3))


def test_before_b_picks_a_sees_only_own_pick_and_booleans():
    state = duel_state(a_pick="rock")
    a = views.state_for(state, "a")["game"]["duel"]
    assert a == {
        "from": 8,
        "to": 15,
        "attacker": "a",
        "round": 1,
        "picked": {"a": True, "b": False},
        "your_pick": "rock",
        "last_round": None,
    }
    b = views.state_for(state, "b")["game"]["duel"]
    assert b["your_pick"] is None
    assert b["picked"] == {"a": True, "b": False}
    assert "rock" not in json.dumps(b)


def test_b_sees_own_pick_but_never_a_pick():
    state = duel_state(a_pick="scissors", b_pick="rock")
    assert views.state_for(state, "b")["game"]["duel"]["your_pick"] == "rock"
    assert "scissors" not in json.dumps(views.state_for(state, "b")["game"]["duel"])
    assert views.state_for(state, "a")["game"]["duel"]["your_pick"] == "scissors"


def test_viewer_gets_no_current_round_pick():
    state = duel_state(a_pick="scissors")
    duel = views.state_for(state, "viewer")["game"]["duel"]
    assert duel["your_pick"] is None
    assert duel["picked"] == {"a": True, "b": False}
    assert "scissors" not in json.dumps(duel)


@pytest.mark.parametrize("who", RECIPIENTS)
def test_last_round_goes_to_everyone(who):
    state = duel_state(a_pick="paper", last=("rock", "rock"), rnd=2)
    duel = views.state_for(state, who)["game"]["duel"]
    assert duel["last_round"] == {"a": "rock", "b": "rock"}
    assert duel["round"] == 2
    if who != "a":
        assert "paper" not in json.dumps(duel)


@pytest.mark.parametrize("who", RECIPIENTS)
def test_no_legal_moves_while_a_duel_waits(who):
    board = dealt()
    duel = DuelState(8, 15, "a", 1, None, None, None, None)
    state = full(game(board, turn="a", duel=duel))
    assert views.state_for(state, who)["game"]["legal"] == {}


def test_viewer_sees_every_kind_in_play_and_duel():
    board = dealt()
    for state in (full(game(board)), duel_state()):
        out = pieces_by_square(views.state_for(state, "viewer"))
        assert {sq: p["kind"] for sq, p in out.items()} == {
            sq: p.kind for sq, p in state.game.board.items()
        }


# --- ended: AC-20 -----------------------------------------------------------------------------


@pytest.mark.parametrize("who", RECIPIENTS)
def test_ended_shows_every_piece_to_everyone(who):
    board = dealt()
    state = full(game(board, status="ended", turn=None, result="a", reason="flag"))
    out = views.state_for(state, who)["game"]
    assert {p["square"]: p["kind"] for p in out["pieces"]} == {
        sq: p.kind for sq, p in board.items()
    }
    assert out["result"] == "a"
    assert out["reason"] == "flag"
    assert out["legal"] == {}


# --- events: AC-12, AC-13, AC-15 --------------------------------------------------------------

EVENTS = [
    (MovedEvent(7, 14), {"kind": "moved", "from": 7, "to": 14}),
    (
        FightEvent(8, 15, "rock", "scissors", "attacker"),
        {
            "kind": "fight",
            "from": 8,
            "to": 15,
            "attacker": "rock",
            "defender": "scissors",
            "winner": "attacker",
        },
    ),
    (DuelEvent(8, 15, "paper"), {"kind": "duel", "from": 8, "to": 15, "weapon": "paper"}),
    (
        DuelRoundEvent("scissors", "scissors", "again"),
        {"kind": "duel_round", "picks": {"a": "scissors", "b": "scissors"}, "outcome": "again"},
    ),
    (FlagEvent(34, 41), {"kind": "flag", "from": 34, "to": 41}),
]


@pytest.mark.parametrize("who", RECIPIENTS)
@pytest.mark.parametrize(("event", "wire"), EVENTS)
def test_events_go_to_players_and_viewers(event, wire, who):
    assert views.event_for(event, who) == wire


# AC-15 (FR-15, FR-22): the trap's owner learns only that a hidden fighter fell in; the
# attacking side and viewers get the weapon (user decision 2026-11-15).
@pytest.mark.parametrize(
    ("who", "attacker"), [("a", "scissors"), ("viewer", "scissors"), ("b", None)]
)
def test_trapped_event_hides_the_attacker_weapon_from_the_trap_owner(who, attacker):
    event = TrappedEvent(33, 40, "scissors", side="a")
    assert views.event_for(event, who) == {
        "kind": "trapped",
        "from": 33,
        "to": 40,
        "attacker": attacker,
    }


@pytest.mark.parametrize(("who", "attacker"), [("b", "rock"), ("viewer", "rock"), ("a", None)])
def test_trapped_event_for_side_b_attacker(who, attacker):
    event = TrappedEvent(8, 1, "rock", side="b")
    assert views.event_for(event, who)["attacker"] == attacker


# --- tile preview: AC-24 ----------------------------------------------------------------------


def test_tile_board_shows_only_revealed_fighters():
    board = dealt()
    board[8] = Piece("a", "rock", True)
    board[30] = Piece("b", "paper", True)
    tile = views.tile_board(full(game(board)))
    assert len(tile) == rules.SQUARES
    for sq in range(rules.SQUARES):
        piece = board.get(sq)
        if piece is None:
            assert tile[sq] is None
        elif sq in (8, 30):
            assert tile[sq] == {"side": piece.side, "kind": piece.kind}
        else:
            assert tile[sq] == {"side": piece.side, "kind": None}


@pytest.mark.parametrize("status", ["setup", "ended"])
def test_tile_board_hides_flags_traps_and_hidden_fighters_in_any_phase(status):
    board = {0: Piece("a", "flag", True), 1: Piece("a", "trap"), 2: Piece("a", "rock")}
    tile = views.tile_board(full(game(board, status=status)))
    assert tile[:3] == [{"side": "a", "kind": None}] * 3
    assert tile[3:] == [None] * (rules.SQUARES - 3)


def test_tile_board_without_a_game_is_empty():
    assert views.tile_board(full(None)) == [None] * rules.SQUARES
