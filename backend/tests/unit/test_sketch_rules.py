"""Spec 022 task 1: sketch validation rules (FR-4–FR-7, FR-18, NFR-3, NFR-5)."""

from typing import Any

import pytest

from app.sketch.rules import (
    BOARD_H,
    BOARD_W,
    BUDGET_BYTES,
    MAX_CLIENT_ID_CHARS,
    MAX_POINTS,
    PALETTE,
    Action,
    SketchError,
    action_bytes,
    parse_action,
    valid_client_id,
)


def test_error_codes_match_the_wire_contract() -> None:
    assert SketchError.INVALID == "invalid"
    assert SketchError.FULL == "full"
    assert SketchError.NOT_YOURS == "not_yours"
    assert SketchError.STALE == "stale"


def test_limits() -> None:
    assert (BOARD_W, BOARD_H) == (1600, 1000)
    assert MAX_POINTS == 1000
    assert MAX_CLIENT_ID_CHARS == 64
    assert BUDGET_BYTES == 1_000_000


def test_ac7_the_palette_offers_8_named_colours() -> None:
    assert PALETTE == ("ink", "red", "orange", "yellow", "green", "blue", "purple", "pink")
    assert len(PALETTE) == 8


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ({"kind": "pen", "color": "red", "points": [10, 20]}, Action("pen", "red", [10, 20])),
        (
            {"kind": "pen", "color": "ink", "points": [0, 0, 1600, 1000, 5, 5]},
            Action("pen", "ink", [0, 0, 1600, 1000, 5, 5]),
        ),
        (
            {"kind": "box", "color": "blue", "points": [1, 2, 300, 400]},
            Action("box", "blue", [1, 2, 300, 400]),
        ),
        (
            {"kind": "ellipse", "color": "pink", "points": [300, 400, 1, 2]},
            Action("ellipse", "pink", [300, 400, 1, 2]),
        ),
        ({"kind": "erase", "points": [7, 8, 9, 10]}, Action("erase", None, [7, 8, 9, 10])),
        (
            {"kind": "pen", "color": "green", "points": [1, 1] * MAX_POINTS},
            Action("pen", "green", [1, 1] * MAX_POINTS),
        ),
    ],
)
def test_each_valid_kind_parses(raw: dict[str, Any], expected: Action) -> None:
    assert parse_action(raw) == expected


def _pen(**over: Any) -> dict[str, Any]:
    return {"kind": "pen", "color": "red", "points": [10, 10, 20, 20]} | over


@pytest.mark.parametrize(
    "raw",
    [
        pytest.param(None, id="none"),
        pytest.param("pen", id="string"),
        pytest.param([1, 2], id="list"),
        pytest.param(42, id="int"),
        pytest.param({}, id="empty-dict"),
        pytest.param(_pen(kind="triangle"), id="unknown-kind"),
        pytest.param(_pen(kind="clear"), id="clear-is-not-an-add"),
        pytest.param(_pen(kind="<script>alert(1)</script>"), id="markup-kind"),
        pytest.param(_pen(kind=None), id="kind-null"),
        pytest.param(_pen(extra=1), id="unknown-key"),
        pytest.param(_pen(author_id="x"), id="author-id-key"),
        pytest.param(_pen(seq=5), id="seq-key"),
        pytest.param(_pen(color="<script>"), id="markup-colour"),
        pytest.param(_pen(color="magenta"), id="colour-not-in-palette"),
        pytest.param(_pen(color="#ff0000"), id="hex-colour"),
        pytest.param(_pen(color="Red"), id="colour-wrong-case"),
        pytest.param(_pen(color=3), id="colour-not-string"),
        pytest.param(_pen(color=None), id="pen-colour-null"),
        pytest.param({"kind": "pen", "points": [1, 1]}, id="pen-without-colour"),
        pytest.param({"kind": "box", "points": [1, 1, 2, 2]}, id="box-without-colour"),
        pytest.param({"kind": "pen", "color": "red"}, id="no-points"),
        pytest.param(_pen(points=None), id="points-null"),
        pytest.param(_pen(points="10,10"), id="points-string"),
        pytest.param(_pen(points={"x": 1}), id="points-dict"),
        pytest.param(_pen(points=[]), id="pen-no-points"),
        pytest.param(_pen(points=[10.5, 10]), id="float-coordinate"),
        pytest.param(_pen(points=[10.0, 10]), id="integral-float-coordinate"),
        pytest.param(_pen(points=["10", 10]), id="string-coordinate"),
        pytest.param(_pen(points=[True, 10]), id="bool-coordinate"),
        pytest.param(_pen(points=[None, 10]), id="null-coordinate"),
        pytest.param(_pen(points=[[1], 10]), id="nested-coordinate"),
        pytest.param(_pen(points=[-1, 10]), id="negative-x"),
        pytest.param(_pen(points=[10, -1]), id="negative-y"),
        pytest.param(_pen(points=[1601, 10]), id="x-out-of-range"),
        pytest.param(_pen(points=[10, 1001]), id="y-out-of-range"),
        pytest.param(_pen(points=[10, 10, 20]), id="odd-length-points"),
        pytest.param(_pen(points=[1, 1] * (MAX_POINTS + 1)), id="1001-points"),
        pytest.param({"kind": "box", "color": "red", "points": [1, 1]}, id="box-1-point"),
        pytest.param(
            {"kind": "box", "color": "red", "points": [1, 1, 2, 2, 3, 3]}, id="box-3-points"
        ),
        pytest.param({"kind": "ellipse", "color": "red", "points": [1, 1]}, id="ellipse-1-point"),
        pytest.param(
            {"kind": "ellipse", "color": "red", "points": [1, 1, 2, 2, 3, 3]},
            id="ellipse-3-points",
        ),
        pytest.param({"kind": "erase", "color": "red", "points": [1, 1]}, id="erase-with-colour"),
        pytest.param({"kind": "erase", "color": None, "points": [1, 1]}, id="erase-colour-null"),
        pytest.param({"kind": "erase", "points": []}, id="erase-no-points"),
    ],
)
def test_ac22_malformed_actions_are_refused(raw: object) -> None:
    assert parse_action(raw) is SketchError.INVALID


def test_points_are_copied_not_aliased() -> None:
    points = [1, 2]
    action = parse_action({"kind": "pen", "color": "red", "points": points})
    assert isinstance(action, Action)
    points.append(3)
    assert action.points == [1, 2]


@pytest.mark.parametrize(
    ("raw", "ok"),
    [
        ("3f2a1c6e-0b1d-4e8f-9a7b-1c2d3e4f5a6b", True),
        ("x" * 64, True),
        ("x" * 65, False),
        ("", False),
        (None, False),
        (123, False),
        (["a"], False),
    ],
)
def test_client_id_must_be_a_short_non_empty_string(raw: object, ok: bool) -> None:
    assert valid_client_id(raw) is ok


def test_action_bytes_is_compact_points_json_plus_32() -> None:
    assert action_bytes(Action("box", "red", [1, 2, 300, 400])) == len("[1,2,300,400]") + 32
    assert action_bytes(Action("clear", None, None)) == len("null") + 32


def test_ac18_2000_typical_actions_fit_the_budget() -> None:
    # A pen line of ~45 points after simplification, any box or circle, a short erase,
    # with full-width (4-digit, 3-digit) coordinates as the worst typical case.
    pen = Action("pen", "blue", [1599, 999] * 45)
    box = Action("box", "red", [1599, 999, 1000, 500])
    ellipse = Action("ellipse", "green", [1599, 999, 1000, 500])
    erase = Action("erase", None, [1599, 999] * 10)
    for action in (pen, box, ellipse, erase):
        assert action_bytes(action) * 2000 <= BUDGET_BYTES
    mix = (action_bytes(pen) + action_bytes(box) + action_bytes(ellipse) + action_bytes(erase)) / 4
    assert mix * 2000 <= BUDGET_BYTES
