"""Sketch board rules (spec 022 plan, Data model and Contracts). Pure, stdlib only.

An action arrives as untrusted JSON. `parse_action` accepts only the exact shapes
the plan lists, so nothing but palette names and integer coordinates is ever
stored or sent on (NFR-5): every other input is `SketchError.INVALID`.
"""

import json
from dataclasses import dataclass
from enum import StrEnum

PALETTE: tuple[str, ...] = ("ink", "red", "orange", "yellow", "green", "blue", "purple", "pink")
BOARD_W = 1600
BOARD_H = 1000
MAX_POINTS = 1000
MAX_CLIENT_ID_CHARS = 64
BUDGET_BYTES = 1_000_000
_BYTES_OVERHEAD = 32

_COLOURED = frozenset({"pen", "box", "ellipse"})
_KINDS = _COLOURED | {"erase"}


class SketchError(StrEnum):
    INVALID = "invalid"
    FULL = "full"
    NOT_YOURS = "not_yours"
    STALE = "stale"


@dataclass(frozen=True)
class Action:
    kind: str
    color: str | None
    points: list[int] | None


def _is_coord(value: object, limit: int) -> bool:
    # bool is an int subclass; JSON floats such as 10.0 are refused too.
    return type(value) is int and 0 <= value <= limit


def _parse_points(raw: object, kind: str) -> list[int] | None:
    if not isinstance(raw, list) or not raw or len(raw) % 2:
        return None
    count = len(raw) // 2
    if count > MAX_POINTS or (kind in ("box", "ellipse") and count != 2):
        return None
    xs, ys = raw[0::2], raw[1::2]
    if not all(_is_coord(x, BOARD_W) for x in xs) or not all(_is_coord(y, BOARD_H) for y in ys):
        return None
    return list(raw)


def parse_action(raw: object) -> Action | SketchError:
    if not isinstance(raw, dict):
        return SketchError.INVALID
    kind = raw.get("kind")
    if not isinstance(kind, str) or kind not in _KINDS:
        return SketchError.INVALID
    allowed = {"kind", "color", "points"} if kind in _COLOURED else {"kind", "points"}
    if not set(raw) <= allowed or "points" not in raw:
        return SketchError.INVALID
    color = raw.get("color")
    if kind in _COLOURED and (not isinstance(color, str) or color not in PALETTE):
        return SketchError.INVALID
    points = _parse_points(raw["points"], kind)
    if points is None:
        return SketchError.INVALID
    return Action(kind, color, points)


def valid_client_id(raw: object) -> bool:
    return isinstance(raw, str) and 0 < len(raw) <= MAX_CLIENT_ID_CHARS


def action_bytes(action: Action) -> int:
    return len(json.dumps(action.points, separators=(",", ":"))) + _BYTES_OVERHEAD
