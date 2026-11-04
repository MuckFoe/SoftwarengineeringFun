"""Spec 007 task 1: GIF rules and GifRef (FR-1, FR-2, FR-10, FR-12, NFR-1, NFR-2)."""

import ast
import copy
import dataclasses
from pathlib import Path
from typing import Any

import pytest

from app.gifs.models import GifRef
from app.gifs.rules import (
    ALLOWED_RATINGS,
    MAX_QUERY_CHARS,
    REQUEST_RATING,
    RESULT_LIMIT,
    normalise_query,
    parse_result,
)


def _item(**overrides: Any) -> dict[str, Any]:
    """A GIPHY search/get item with the fields the rules read (GIPHY sends sizes as strings)."""
    item: dict[str, Any] = {
        "id": "abc123",
        "title": "Happy dance",
        "rating": "g",
        "images": {
            "fixed_width": {
                "url": "https://media.giphy.com/media/abc123/200w.gif",
                "width": "200",
                "height": "150",
            },
            "fixed_width_still": {
                "url": "https://media.giphy.com/media/abc123/200w_s.gif",
                "width": "200",
                "height": "150",
            },
        },
    }
    item.update(overrides)
    return item


def test_constants_match_the_plan() -> None:
    assert ALLOWED_RATINGS == frozenset({"g", "pg", "pg-13"})
    assert REQUEST_RATING == "pg-13"
    assert MAX_QUERY_CHARS == 50
    assert RESULT_LIMIT == 24


def test_gifref_is_frozen() -> None:
    ref = GifRef(
        id="a", title="t", url="https://x/a.gif", still_url="https://x/s.gif", width=1, height=1
    )
    with pytest.raises(dataclasses.FrozenInstanceError):
        ref.title = "other"  # type: ignore[misc]


# FR-1 / NFR-2: no higher than PG-13


@pytest.mark.parametrize("rating", ["g", "pg", "pg-13"])
def test_allowed_ratings_parse(rating: str) -> None:
    assert parse_result(_item(rating=rating)) is not None


@pytest.mark.parametrize("rating", ["r", "nc-17", "", "PG-13x", None, 5])
def test_disallowed_or_unknown_rating_is_dropped(rating: object) -> None:
    assert parse_result(_item(rating=rating)) is None


def test_missing_rating_is_dropped() -> None:
    item = _item()
    del item["rating"]
    assert parse_result(item) is None


# FR-12: a reference to the GIF


def test_parsed_item_carries_id_title_both_urls_and_size() -> None:
    assert parse_result(_item()) == GifRef(
        id="abc123",
        title="Happy dance",
        url="https://media.giphy.com/media/abc123/200w.gif",
        still_url="https://media.giphy.com/media/abc123/200w_s.gif",
        width=200,
        height=150,
    )


def test_integer_sizes_are_accepted() -> None:
    item = _item()
    item["images"]["fixed_width"]["width"] = 200
    item["images"]["fixed_width"]["height"] = 150
    ref = parse_result(item)
    assert ref is not None and (ref.width, ref.height) == (200, 150)


def test_http_urls_are_accepted() -> None:
    item = _item()
    item["images"]["fixed_width"]["url"] = "http://localhost:9000/media/a.gif"
    item["images"]["fixed_width_still"]["url"] = "http://localhost:9000/media/a_s.gif"
    assert parse_result(item) is not None


@pytest.mark.parametrize("rendition", ["fixed_width", "fixed_width_still"])
@pytest.mark.parametrize(
    "bad_url",
    [
        "javascript:alert(1)",
        "/media/a.gif",
        "media/a.gif",
        "//evil/a.gif",
        "data:image/gif;base64,AA",
        "",
        None,
        7,
    ],
)
def test_bad_media_url_is_dropped(rendition: str, bad_url: object) -> None:
    item = _item()
    item["images"][rendition]["url"] = bad_url
    assert parse_result(item) is None


@pytest.mark.parametrize("rendition", ["fixed_width", "fixed_width_still"])
def test_missing_url_is_dropped(rendition: str) -> None:
    item = _item()
    del item["images"][rendition]["url"]
    assert parse_result(item) is None


@pytest.mark.parametrize("rendition", ["fixed_width", "fixed_width_still"])
def test_missing_rendition_is_dropped(rendition: str) -> None:
    item = _item()
    del item["images"][rendition]
    assert parse_result(item) is None


@pytest.mark.parametrize("images", [None, {}, "x", []])
def test_missing_or_malformed_images_is_dropped(images: object) -> None:
    assert parse_result(_item(images=images)) is None


@pytest.mark.parametrize("field", ["width", "height"])
@pytest.mark.parametrize("value", ["0", 0, "-3", -3, "abc", "", None, True, 1.5])
def test_non_positive_or_non_integer_size_is_dropped(field: str, value: object) -> None:
    item = _item()
    item["images"]["fixed_width"][field] = value
    assert parse_result(item) is None


@pytest.mark.parametrize("field", ["width", "height"])
def test_missing_size_is_dropped(field: str) -> None:
    item = _item()
    del item["images"]["fixed_width"][field]
    assert parse_result(item) is None


@pytest.mark.parametrize("gif_id", [None, "", 12])
def test_missing_or_bad_id_is_dropped(gif_id: object) -> None:
    assert parse_result(_item(id=gif_id)) is None


def test_parse_does_not_mutate_input() -> None:
    item = _item()
    before = copy.deepcopy(item)
    parse_result(item)
    assert item == before


# FR-10: title, or "GIF" when it has none (client side)


def test_missing_title_parses_to_empty_string() -> None:
    item = _item()
    del item["title"]
    ref = parse_result(item)
    assert ref is not None and ref.title == ""


@pytest.mark.parametrize("title", [None, 3])
def test_non_string_title_parses_to_empty_string(title: object) -> None:
    ref = parse_result(_item(title=title))
    assert ref is not None and ref.title == ""


# NFR-1: only the search term goes to the service


def test_query_is_stripped() -> None:
    assert normalise_query("  cat  ") == "cat"


def test_query_is_clipped_to_50_characters() -> None:
    assert normalise_query("x" * 60) == "x" * 50


def test_query_is_stripped_before_clipping() -> None:
    assert normalise_query("   " + "y" * 60) == "y" * 50


def test_empty_query_stays_empty() -> None:
    assert normalise_query("   ") == ""


# Dependency direction: gifs imports nothing from chat or sessions


def test_gifs_package_does_not_import_chat_or_sessions() -> None:
    pkg = Path(__file__).resolve().parents[2] / "app" / "gifs"
    for path in pkg.glob("*.py"):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            names: list[str] = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                names = [node.module or ""]
                if node.level:
                    names = [f"app.{node.module or ''}"] if node.level == 2 else []
            for name in names:
                assert not name.startswith(("app.chat", "app.sessions")), (
                    f"{path.name} imports {name}"
                )
