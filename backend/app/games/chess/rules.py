"""Pure chess rules on top of python-chess. Imports nothing from `app`."""

from dataclasses import dataclass, field

import chess

_PROMOTIONS = {"q": chess.QUEEN, "r": chess.ROOK, "b": chess.BISHOP, "n": chess.KNIGHT}


@dataclass(frozen=True)
class Outcome:
    result: str  # "white" | "black" | "draw"
    reason: str


@dataclass(frozen=True)
class Applied:
    uci: str
    san: str
    outcome: Outcome | None = None


@dataclass(frozen=True)
class Illegal:
    reason: str = "illegal_move"


@dataclass(frozen=True)
class BoardView:
    fen: str
    turn: str
    check_square: str | None
    legal: dict[str, list[str]] = field(default_factory=dict)
    promotions: list[str] = field(default_factory=list)


def replay(ucis: list[str]) -> chess.Board:
    """Rebuild a position from the start by playing the full move stack."""
    board = chess.Board()
    for uci in ucis:
        board.push_uci(uci)
    return board


def _square(name: str) -> int | None:
    try:
        return chess.parse_square(name)
    except ValueError:
        return None


def _is_promotion_move(board: chess.Board, frm: int, to: int) -> bool:
    piece = board.piece_at(frm)
    return piece is not None and piece.piece_type == chess.PAWN and chess.square_rank(to) in (0, 7)


def outcome(board: chess.Board) -> Outcome | None:
    """First applicable end: checkmate, stalemate, insufficient material, threefold, fifty moves."""
    if board.is_checkmate():
        return Outcome("black" if board.turn == chess.WHITE else "white", "checkmate")
    if board.is_stalemate():
        return Outcome("draw", "stalemate")
    if board.is_insufficient_material():
        return Outcome("draw", "insufficient_material")
    if board.is_repetition(3):
        return Outcome("draw", "threefold_repetition")
    if board.is_fifty_moves():
        return Outcome("draw", "fifty_moves")
    return None


def apply(board: chess.Board, from_sq: str, to_sq: str, promotion: str | None) -> Applied | Illegal:
    """Play a move on `board` if legal; on Illegal the board is unchanged."""
    frm, to = _square(from_sq), _square(to_sq)
    if frm is None or to is None:
        return Illegal()
    promo = None
    if promotion is not None:
        promo = _PROMOTIONS.get(promotion.lower())
        if promo is None:
            return Illegal()
    needs = _is_promotion_move(board, frm, to)
    if needs and promo is None:
        if any(m.from_square == frm and m.to_square == to for m in board.legal_moves):
            return Illegal("promotion_required")
        return Illegal()
    if not needs and promo is not None:
        return Illegal()
    move = chess.Move(frm, to, promo)
    if move not in board.legal_moves:
        return Illegal()
    san = board.san(move)
    board.push(move)
    return Applied(uci=move.uci(), san=san, outcome=outcome(board))


def view(board: chess.Board) -> BoardView:
    legal: dict[str, list[str]] = {}
    promotions: list[str] = []
    for m in board.legal_moves:
        frm = chess.square_name(m.from_square)
        dest = chess.square_name(m.to_square)
        dests = legal.setdefault(frm, [])
        if dest not in dests:
            dests.append(dest)
        if m.promotion and frm not in promotions:
            promotions.append(frm)
    check = board.king(board.turn) if board.is_check() else None
    return BoardView(
        fen=board.fen(),
        turn="white" if board.turn == chess.WHITE else "black",
        check_square=None if check is None else chess.square_name(check),
        legal=legal,
        promotions=promotions,
    )
