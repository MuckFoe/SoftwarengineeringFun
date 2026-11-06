import chess

from app.games.chess import rules
from app.games.chess.rules import Applied, Illegal


def play(moves: list[str]):
    """Build a position by playing uci moves through rules.apply."""
    board = rules.replay([])
    for uci in moves:
        res = rules.apply(board, uci[:2], uci[2:4], uci[4:] or None)
        assert isinstance(res, Applied), (uci, res)
    return board


def try_move(board, uci):
    fen = board.fen()
    res = rules.apply(board, uci[:2], uci[2:4], uci[4:] or None)
    if isinstance(res, Illegal):
        assert board.fen() == fen
    return res


def test_ac13_knight_destinations_and_white_only():
    view = rules.view(rules.replay([]))
    assert set(view.legal["g1"]) == {"f3", "h3"}
    assert view.turn == "white"
    assert all(int(sq[1]) <= 2 for sq in view.legal)


def test_ac14_castling_kingside_and_queenside():
    b = play(["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6"])
    assert isinstance(try_move(b, "e1g1"), Applied)
    b = play(["d2d4", "d7d5", "b1c3", "b8c6", "c1f4", "c8f5", "d1d2", "d8d7"])
    assert isinstance(try_move(b, "e1c1"), Applied)


def test_ac14_castling_through_check_refused():
    # black rook on f8 file attacks f1: after clearing, castle through f1
    b = play(["e2e4", "f7f5", "g1f3", "f5e4", "f1e2", "e4f3", "e2d3", "f3g2"])
    # black pawn on g2 attacks f1 and h1; castling kingside lands through f1
    assert isinstance(try_move(b, "e1g1"), Illegal)


def test_ac14_castling_out_of_check_refused():
    b = play(["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "d2d3", "f8b4"])
    # white in check from b4? b4 bishop attacks e1 via d2 (pawn moved)
    assert b.is_check()
    assert isinstance(try_move(b, "e1g1"), Illegal)


def test_ac14_castling_after_king_or_rook_moved_refused():
    b = play(["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "e1f1", "a7a6", "f1e1", "a6a5"])
    assert isinstance(try_move(b, "e1g1"), Illegal)
    b = play(["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "h1g1", "a7a6", "g1h1", "a6a5"])
    assert isinstance(try_move(b, "e1g1"), Illegal)


def test_ac14_en_passant_now_and_later():
    b = play(["e2e4", "a7a6", "e4e5", "d7d5"])
    assert isinstance(try_move(b, "e5d6"), Applied)
    b = play(["e2e4", "a7a6", "e4e5", "d7d5", "a2a3", "a6a5"])
    assert isinstance(try_move(b, "e5d6"), Illegal)


def test_ac14_self_check_refused():
    b = play(["e2e4", "d7d5", "f1b5"])  # black king in check from b5 via c6/d7
    assert b.is_check()
    assert isinstance(try_move(b, "a7a6"), Illegal)
    assert isinstance(try_move(b, "c7c6"), Applied)


PROMO = ["h2h4", "g7g5", "h4g5", "g8f6", "g5g6", "a7a6", "g6g7", "a6a5"]
# white pawn on g7, g8 empty, f8 bishop and h8 rook capturable


def test_ac15_promotion_each_piece():
    for p, letter in [("q", "Q"), ("r", "R"), ("b", "B"), ("n", "N")]:
        b = play(PROMO)
        assert isinstance(try_move(b, "g7g8" + p), Applied)
        assert b.piece_at(chess.G8).symbol() == letter


def test_ac15_promotion_required_and_collapsed():
    b = play(PROMO)
    assert try_move(b, "g7g8") == Illegal("promotion_required")
    view = rules.view(b)
    assert "g7" in view.promotions
    assert view.legal["g7"].count("g8") == 1
    assert set(view.legal["g7"]) == {"g8", "f8", "h8"}


def test_ac15_unnecessary_promotion_refused():
    b = rules.replay([])
    assert isinstance(try_move(b, "e2e4q"), Illegal)


def test_ac16_san():
    b = rules.replay([])
    assert rules.apply(b, "e2", "e4", None).san == "e4"
    rules.apply(b, "d7", "d5", None)
    assert rules.apply(b, "e4", "d5", None).san == "exd5"
    b = play(["e2e4", "d7d5", "e4d5", "a7a6"])
    assert rules.apply(b, "f1", "b5", None).san == "Bb5+"
    b = play(["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6"])
    assert rules.apply(b, "e1", "g1", None).san == "O-O"


def test_ac16_san_promotion():
    b = play(PROMO)
    assert rules.apply(b, "g7", "g8", "q").san == "g8=Q"


def test_ac17_check_square_set_then_cleared():
    b = rules.replay([])
    rules.apply(b, "e2", "e4", None)
    rules.apply(b, "d7", "d5", None)
    assert rules.view(b).check_square is None
    rules.apply(b, "f1", "b5", None)
    assert rules.view(b).check_square == "e8"
    rules.apply(b, "c7", "c6", None)
    assert rules.view(b).check_square is None


def test_replay_roundtrip():
    b = rules.replay(["e2e4", "e7e5"])
    assert rules.view(b).turn == "white"
    assert len(b.move_stack) == 2


def test_ac20_fools_mate_style_checkmate_outcome():
    moves = ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6"]
    board = play(moves)
    assert rules.outcome(board) is None
    res = rules.apply(board, "h5", "f7", None)
    assert isinstance(res, Applied)
    assert res.outcome == rules.Outcome("white", "checkmate")
    assert rules.outcome(board) == rules.Outcome("white", "checkmate")


def test_ac20_no_outcome_before_mate():
    board = rules.replay([])
    res = rules.apply(board, "e2", "e4", None)
    assert isinstance(res, Applied) and res.outcome is None


def test_ac21_stalemate():
    board = chess.Board("7k/5Q2/8/6K1/8/8/8/8 w - - 0 1")
    res = rules.apply(board, "g5", "g6", None)
    assert isinstance(res, Applied)
    assert res.outcome == rules.Outcome("draw", "stalemate")


def test_ac21_insufficient_material():
    board = chess.Board("7k/8/8/8/8/8/6p1/6K1 w - - 0 1")
    res = rules.apply(board, "g1", "g2", None)
    assert isinstance(res, Applied)
    assert res.outcome == rules.Outcome("draw", "insufficient_material")


def test_ac21_threefold_not_on_second_occurrence():
    shuffle = ["g1f3", "g8f6", "f3g1", "f6g8"]
    board = rules.replay([])
    results = []
    for uci in shuffle * 2:
        res = rules.apply(board, uci[:2], uci[2:4], None)
        assert isinstance(res, Applied)
        results.append(res.outcome)
    assert results[:-1] == [None] * 7
    assert results[-1] == rules.Outcome("draw", "threefold_repetition")


def test_ac21_threefold_second_occurrence_is_not_draw():
    board = play(["g1f3", "g8f6", "f3g1", "f6g8"])
    assert rules.outcome(board) is None


def test_replay_detects_threefold_before_replay_point():
    ucis = ["g1f3", "g8f6", "f3g1", "f6g8"] * 2 + ["e2e4"]
    board = rules.replay(ucis)
    # repetition happened earlier; the stack still shows it for the earlier prefix
    assert rules.outcome(rules.replay(ucis[:8])) == rules.Outcome("draw", "threefold_repetition")
    assert board.move_stack[-1].uci() == "e2e4"


def test_ac21_fifty_moves():
    board = chess.Board("7k/8/8/8/8/8/R7/K7 w - - 98 80")
    res = rules.apply(board, "a2", "b2", None)
    assert isinstance(res, Applied) and res.outcome is None  # 99 half-moves
    res = rules.apply(board, "h8", "g8", None)
    assert isinstance(res, Applied)
    assert res.outcome == rules.Outcome("draw", "fifty_moves")
