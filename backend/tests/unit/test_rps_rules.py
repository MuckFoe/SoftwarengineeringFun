"""Pure Rock Paper Siege setup rules: deal, re-deal, place, first mover (AC-4, AC-5, AC-8)."""

# Seeded random.Random makes the pure rules deterministic here; the service uses SystemRandom.
# ruff: noqa: S311

import itertools
import random
import secrets
from collections import Counter

import pytest

from app.games.rps import rules
from app.games.rps.rules import Illegal, Piece, PrevGame


def kinds(board, side):
    return Counter(p.kind for p in board.values() if p.side == side)


def full_board(seed=1):
    rng = random.Random(seed)
    return {**rules.deal("a", 0, 1, rng), **rules.deal("b", 41, 40, rng)}


def test_home_squares_are_the_two_home_rows():
    assert rules.home_squares("a") == list(range(0, 14))
    assert rules.home_squares("b") == list(range(28, 42))


# AC-4 (FR-4): 4 rock, 4 paper, 4 scissors plus a flag and a trap on the home rows.
@pytest.mark.parametrize("side", ["a", "b"])
def test_deal_gives_twelve_fighters_flag_and_trap_on_home_rows(side):
    home = rules.home_squares(side)
    for seed in range(200):
        rng = random.Random(seed)
        flag, trap = rng.sample(home, 2)
        dealt = rules.deal(side, flag, trap, rng)
        assert sorted(dealt) == home
        assert all(p.side == side and not p.revealed for p in dealt.values())
        assert dealt[flag].kind == "flag"
        assert dealt[trap].kind == "trap"
        assert kinds(dealt, side) == {"rock": 4, "paper": 4, "scissors": 4, "flag": 1, "trap": 1}


def test_deal_refuses_flag_or_trap_off_home_rows_or_on_one_square():
    rng = random.Random(0)
    with pytest.raises(Illegal):
        rules.deal("a", 14, 0, rng)
    with pytest.raises(Illegal):
        rules.deal("b", 28, 27, rng)
    with pytest.raises(Illegal):
        rules.deal("a", 3, 3, rng)


# AC-4: the flag and the trap can go on any two of the 14 home-row squares.
@pytest.mark.parametrize("side", ["a", "b"])
def test_place_puts_flag_and_trap_on_any_two_home_squares(side):
    start = full_board()
    other = "b" if side == "a" else "a"
    for flag_sq, trap_sq in itertools.permutations(rules.home_squares(side), 2):
        board = rules.place(start, side, "flag", flag_sq)
        board = rules.place(board, side, "trap", trap_sq)
        assert board[flag_sq] == Piece(side, "flag", False)
        assert board[trap_sq] == Piece(side, "trap", False)
        assert kinds(board, side) == kinds(start, side)
        assert {sq: p for sq, p in board.items() if p.side == other} == {
            sq: p for sq, p in start.items() if p.side == other
        }


def test_place_swaps_what_stood_there_into_the_vacated_square():
    start = full_board()
    target = 5
    moved = start[target]
    board = rules.place(start, "a", "flag", target)
    assert board[target].kind == "flag"
    assert board[0] == moved
    board = rules.place(board, "a", "trap", target)
    assert board[target].kind == "trap"
    assert board[1].kind == "flag"


def test_place_on_its_own_square_changes_nothing():
    start = full_board()
    assert rules.place(start, "a", "flag", 0) == start


@pytest.mark.parametrize(
    ("side", "square"),
    [("a", 14), ("a", 28), ("a", 41), ("b", 0), ("b", 27), ("b", 13), ("a", 42), ("a", -1)],
)
def test_place_outside_own_home_rows_raises(side, square):
    with pytest.raises(Illegal):
        rules.place(full_board(), side, "trap", square)


def test_place_does_not_mutate_its_input():
    start = full_board()
    snapshot = dict(start)
    rules.place(start, "a", "flag", 9)
    assert start == snapshot


# AC-5 (FR-5): re-deal three times keeps flag and trap, 4/4/4 on the other 12 squares.
@pytest.mark.parametrize("side", ["a", "b"])
def test_three_redeals_keep_flag_and_trap_and_shuffle_the_fighters(side):
    rng = random.Random(7)
    board = full_board()
    board = rules.place(board, side, "flag", rules.home_squares(side)[6])
    board = rules.place(board, side, "trap", rules.home_squares(side)[11])
    flag_sq = next(sq for sq, p in board.items() if p.side == side and p.kind == "flag")
    trap_sq = next(sq for sq, p in board.items() if p.side == side and p.kind == "trap")
    other = {sq: p for sq, p in board.items() if p.side != side}
    fighter_squares = set(rules.home_squares(side)) - {flag_sq, trap_sq}

    layouts = []
    for _ in range(3):
        board = rules.redeal(board, side, rng)
        assert board[flag_sq] == Piece(side, "flag", False)
        assert board[trap_sq] == Piece(side, "trap", False)
        fighters = {
            sq: p.kind
            for sq, p in board.items()
            if p.side == side and p.kind not in ("flag", "trap")
        }
        assert set(fighters) == fighter_squares
        assert Counter(fighters.values()) == {"rock": 4, "paper": 4, "scissors": 4}
        assert {sq: p for sq, p in board.items() if p.side != side} == other
        layouts.append(fighters)
    assert layouts[0] != layouts[1] != layouts[2] != layouts[0]


def test_redeal_is_deterministic_for_a_seed():
    board = full_board()
    assert rules.redeal(board, "a", random.Random(3)) == rules.redeal(board, "a", random.Random(3))


# AC-8 (FR-8, NFR-1): first game random, about half each side.
def test_first_side_of_a_first_game_is_fair():
    rng = secrets.SystemRandom()
    draws = Counter(rules.first_side(None, "p1", "p2", rng) for _ in range(2000))
    assert set(draws) == {"a", "b"}
    assert 900 <= draws["a"] <= 1100


def test_first_side_alternates_by_participant():
    rng = random.Random(0)
    # Game 1: p1 in seat a moved first. Game 2, same seats: p2 (seat b) moves first.
    assert rules.first_side(PrevGame("a", "p1", "p2"), "p1", "p2", rng) == "b"
    assert rules.first_side(PrevGame("b", "p1", "p2"), "p1", "p2", rng) == "a"


def test_first_side_follows_the_participant_across_a_seat_swap():
    rng = random.Random(0)
    # p1 (seat a) moved first; now p2 sits in a and p1 in b: p2 still moves first.
    assert rules.first_side(PrevGame("a", "p1", "p2"), "p2", "p1", rng) == "a"
    assert rules.first_side(PrevGame("b", "p1", "p2"), "p2", "p1", rng) == "b"


def test_first_side_when_only_one_previous_player_is_seated():
    rng = random.Random(0)
    # The previous non-first-mover p2 is seated (in b) with a newcomer: p2 goes first.
    assert rules.first_side(PrevGame("a", "p1", "p2"), "p3", "p2", rng) == "b"
    # Only the previous first mover p1 is seated (in b): the other seat goes first.
    assert rules.first_side(PrevGame("a", "p1", "p2"), "p3", "p1", rng) == "a"
    assert rules.first_side(PrevGame("a", "p1", "p2"), "p1", "p3", rng) == "b"


def test_first_side_with_neither_previous_player_seated_is_random():
    rng = secrets.SystemRandom()
    draws = Counter(
        rules.first_side(PrevGame("a", "p1", "p2"), "p3", "p4", rng) for _ in range(2000)
    )
    assert 900 <= draws["a"] <= 1100


# --- Play: legal moves, fights, duels, traps, flag (AC-9 .. AC-19) ---

WINS = [("rock", "scissors"), ("scissors", "paper"), ("paper", "rock")]


def P(side, kind, revealed=False):
    return Piece(side, kind, revealed)


def test_beats_is_the_weapon_order():
    for x, y in WINS:
        assert rules.beats(x, y)
        assert not rules.beats(y, x)
    for w in rules.WEAPONS:
        assert not rules.beats(w, w)


# AC-9 (FR-9): right (empty) and up (enemy) allowed; down (own) refused; diagonal and two refused.
def ac9_board():
    # Fighter at C3 (row 2, col 2 -> 16): right 17 empty, below 9 own, above 23 enemy, left 15 own.
    return {16: P("a", "rock"), 9: P("a", "paper"), 15: P("a", "flag"), 23: P("b", "scissors")}


def test_legal_moves_on_the_ac9_board():
    moves = rules.legal_moves(ac9_board(), "a")
    assert moves[16] == [17, 23]
    assert moves[9] == [2, 8, 10]


@pytest.mark.parametrize(
    ("to", "ok"),
    [
        (17, True),
        (23, True),
        (9, False),
        (24, False),
        (22, False),
        (8, False),
        (18, False),
        (30, False),
        (2, False),
    ],
)
def test_resolve_move_on_the_ac9_board(to, ok):
    out = rules.resolve_move(ac9_board(), "a", 16, to)
    assert isinstance(out, Illegal) is (not ok)


@pytest.mark.parametrize(
    ("square", "targets"),
    [(0, [1, 7]), (6, [5, 13]), (35, [28, 36]), (41, [34, 40]), (7, [0, 8, 14]), (13, [6, 12, 20])],
)
def test_legal_moves_never_leave_the_board_at_edges_and_corners(square, targets):
    assert rules.legal_moves({square: P("a", "rock")}, "a") == {square: targets}


def test_resolve_move_refuses_off_board_and_foreign_pieces():
    board = {6: P("a", "rock"), 20: P("b", "paper")}
    assert isinstance(rules.resolve_move(board, "a", 6, 7), Illegal)  # wraps to next row
    assert isinstance(rules.resolve_move(board, "a", 6, 42), Illegal)
    assert isinstance(rules.resolve_move(board, "a", 6, -1), Illegal)
    assert isinstance(rules.resolve_move(board, "a", 20, 19), Illegal)  # not A's piece
    assert isinstance(rules.resolve_move(board, "a", 5, 4), Illegal)  # empty square
    assert isinstance(rules.resolve_move(board, "b", 6, 5), Illegal)  # out of turn side


# AC-10 (FR-10): flag and trap never move.
def test_flag_and_trap_never_move():
    board = full_board()
    for side in ("a", "b"):
        moves = rules.legal_moves(board, side)
        for sq, p in board.items():
            if p.side == side and p.kind in ("flag", "trap"):
                assert sq not in moves
                for to in range(-1, 43):
                    out = rules.resolve_move(board, side, sq, to)
                    assert isinstance(out, Illegal)


def test_illegal_carries_a_code():
    out = rules.resolve_move(full_board(), "a", 0, 7)
    assert isinstance(out, Illegal)
    assert out.code


# AC-11 (FR-11): a hidden fighter stays hidden when it moves.
def test_quiet_move_keeps_the_fighter_hidden():
    board = {10: P("a", "paper")}
    out = rules.resolve_move(board, "a", 10, 17)
    assert out == rules.Moved(10, 17)
    after = rules.apply(board, out)
    assert after == {17: P("a", "paper", False)}


def test_quiet_move_keeps_a_revealed_fighter_revealed():
    board = {10: P("a", "paper", True)}
    assert rules.apply(board, rules.resolve_move(board, "a", 10, 11)) == {11: P("a", "paper", True)}


# AC-12 (FR-12): all six winning pairs, both ways round.
@pytest.mark.parametrize(("strong", "weak"), WINS)
@pytest.mark.parametrize("attacker", ["a", "b"])
def test_attacker_wins_takes_the_square_revealed(strong, weak, attacker):
    defender = "b" if attacker == "a" else "a"
    board = {17: P(attacker, strong), 24: P(defender, weak), 3: P(defender, "rock")}
    out = rules.resolve_move(board, attacker, 17, 24)
    assert out == rules.Fought(17, 24, "attacker")
    assert rules.apply(board, out) == {24: P(attacker, strong, True), 3: P(defender, "rock")}


@pytest.mark.parametrize(("strong", "weak"), WINS)
@pytest.mark.parametrize("attacker", ["a", "b"])
def test_attacker_loses_defender_stays_revealed(strong, weak, attacker):
    defender = "b" if attacker == "a" else "a"
    board = {17: P(attacker, weak), 24: P(defender, strong)}
    out = rules.resolve_move(board, attacker, 17, 24)
    assert out == rules.Fought(17, 24, "defender")
    assert rules.apply(board, out) == {24: P(defender, strong, True)}


def test_apply_does_not_mutate_its_input():
    board = {17: P("a", "rock"), 24: P("b", "scissors")}
    snapshot = dict(board)
    rules.apply(board, rules.resolve_move(board, "a", 17, 24))
    assert board == snapshot


# AC-13 (FR-13): same weapons start a duel; ties repeat; the winning pick wins.
@pytest.mark.parametrize("weapon", ["rock", "paper", "scissors"])
def test_same_weapons_start_a_duel(weapon):
    board = {17: P("a", weapon), 24: P("b", weapon)}
    out = rules.resolve_move(board, "a", 17, 24)
    assert out == rules.DuelStarted(17, 24)
    # Both fighters are revealed while the duel waits; nothing is removed yet.
    assert rules.apply(board, out) == {17: P("a", weapon, True), 24: P("b", weapon, True)}


@pytest.mark.parametrize("attacker", ["a", "b"])
def test_resolve_duel(attacker):
    for w in rules.WEAPONS:
        assert rules.resolve_duel(w, w, attacker) is None
    for strong, weak in WINS:
        a_wins = "attacker" if attacker == "a" else "defender"
        b_wins = "defender" if attacker == "a" else "attacker"
        assert rules.resolve_duel(strong, weak, attacker) == a_wins
        assert rules.resolve_duel(weak, strong, attacker) == b_wins


# AC-14 (FR-14): A's paper won a duel with a rock pick and is still paper.
def test_duel_winner_keeps_its_weapon():
    board = {17: P("a", "paper"), 24: P("b", "paper")}
    board = rules.apply(board, rules.resolve_move(board, "a", 17, 24))
    winner = rules.resolve_duel("rock", "scissors", "a")
    assert winner == "attacker"
    after = rules.apply(board, rules.Fought(17, 24, winner))
    assert after == {24: P("a", "paper", True)}
    lost = rules.apply(board, rules.Fought(17, 24, "defender"))
    assert lost == {24: P("b", "paper", True)}


# AC-15 (FR-15): every weapon falls into the trap; the trap stays hidden; a second one too.
@pytest.mark.parametrize("weapon", ["rock", "paper", "scissors"])
def test_trap_removes_every_attacker_and_stays_hidden(weapon):
    board = {17: P("a", weapon), 23: P("a", "scissors"), 24: P("b", "trap")}
    out = rules.resolve_move(board, "a", 17, 24)
    assert out == rules.Trapped(17, 24)
    board = rules.apply(board, out)
    assert board == {23: P("a", "scissors"), 24: P("b", "trap", False)}
    out = rules.resolve_move(board, "a", 23, 24)
    assert out == rules.Trapped(23, 24)
    assert rules.apply(board, out) == {24: P("b", "trap", False)}


# AC-16 (FR-16): attacking the flag captures it with any weapon.
@pytest.mark.parametrize("weapon", ["rock", "paper", "scissors"])
@pytest.mark.parametrize("attacker", ["a", "b"])
def test_attacking_the_flag_is_flag_taken(weapon, attacker):
    defender = "b" if attacker == "a" else "a"
    board = {17: P(attacker, weapon), 24: P(defender, "flag")}
    out = rules.resolve_move(board, attacker, 17, 24)
    assert out == rules.FlagTaken(17, 24)
    # The flag is never revealed by apply; the game is over and views show everything.
    assert rules.apply(board, out)[24] == P(defender, "flag", False)


# AC-17: apply returns only a board (turn state lives in the service).
def test_apply_returns_only_a_board():
    board = {17: P("a", "rock")}
    after = rules.apply(board, rules.Moved(17, 18))
    assert isinstance(after, dict)
    assert all(isinstance(p, Piece) for p in after.values())


def test_apply_refuses_an_illegal_outcome():
    with pytest.raises(ValueError):
        rules.apply({17: P("a", "rock")}, Illegal("not_legal"))


# AC-18 (FR-18): boxed-in, or no fighters left, means no legal move.
def test_boxed_in_side_has_no_legal_moves():
    # A's rock in the corner 0, boxed by its own flag (1) and trap (7).
    board = {0: P("a", "rock"), 1: P("a", "flag"), 7: P("a", "trap"), 30: P("b", "paper")}
    assert rules.legal_moves(board, "a") == {}
    assert rules.legal_moves(board, "b") != {}


def test_full_home_rows_with_a_front_line_blocked_still_move_into_the_middle():
    assert rules.legal_moves(full_board(), "a") != {}


def test_flag_and_trap_only_side_has_no_legal_moves():
    board = {0: P("a", "flag"), 13: P("a", "trap"), 30: P("b", "paper")}
    assert rules.legal_moves(board, "a") == {}


# AC-19 (FR-19): 500 quiet moves end nothing and leave legal moves.
def test_five_hundred_quiet_moves_never_end_the_game():
    board = {17: P("a", "rock"), 24: P("b", "rock"), 0: P("a", "flag"), 41: P("b", "flag")}
    hops = {"a": (17, 18), "b": (24, 25)}
    for ply in range(500):
        side = "a" if ply % 2 == 0 else "b"
        frm, to = hops[side]
        if ply % 4 >= 2:
            frm, to = to, frm
        out = rules.resolve_move(board, side, frm, to)
        assert out == rules.Moved(frm, to)
        board = rules.apply(board, out)
        assert rules.legal_moves(board, "a")
        assert rules.legal_moves(board, "b")
    assert board == {17: P("a", "rock"), 24: P("b", "rock"), 0: P("a", "flag"), 41: P("b", "flag")}
