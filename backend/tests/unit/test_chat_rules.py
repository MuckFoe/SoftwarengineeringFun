"""Spec 002 task 4: chat message rules (FR13, FR14)."""

import pytest

from app.chat.rules import MAX_CHAT_CHARS, ChatError, validate_body


def test_error_codes_match_the_wire_contract() -> None:
    assert MAX_CHAT_CHARS == 2000
    assert ChatError.EMPTY == "chat_empty"
    assert ChatError.TOO_LONG == "chat_too_long"
    assert ChatError.STALE == "session_stale"


@pytest.mark.parametrize("text", ["", "  \n \n", "\t", "  \n"])
def test_fr13_empty_or_whitespace_only_text_is_refused(text: str) -> None:
    assert validate_body(text) is ChatError.EMPTY


def test_fr14_2001_characters_are_refused() -> None:
    assert validate_body("x" * 2001) is ChatError.TOO_LONG


def test_fr14_exactly_2000_characters_are_accepted() -> None:
    assert validate_body("x" * 2000) is None


def test_fr14_length_counts_code_points_not_utf16_units() -> None:
    emoji = "\U0001f600"  # one code point, two UTF-16 units
    assert validate_body(emoji * 2000) is None
    assert validate_body(emoji * 2001) is ChatError.TOO_LONG


def test_fr14_length_is_measured_on_the_text_as_typed() -> None:
    # Surrounding whitespace counts toward the limit: the text is stored as typed.
    assert validate_body(" " + "x" * 2000) is ChatError.TOO_LONG
    assert validate_body("  hello  \n") is None
