"""Chat message rules (spec 002 plan, Chat — Validation). Pure.

A character is a Unicode code point (Python `len`), matched on the client by
`[...text].length`. Only the emptiness check uses the stripped text; the length is
measured on, and the text stored as, exactly what was typed.
"""

from enum import StrEnum

MAX_CHAT_CHARS = 2000


class ChatError(StrEnum):
    EMPTY = "chat_empty"
    TOO_LONG = "chat_too_long"
    STALE = "session_stale"


def validate_body(text: str) -> ChatError | None:
    if not text.strip():
        return ChatError.EMPTY
    if len(text) > MAX_CHAT_CHARS:
        return ChatError.TOO_LONG
    return None
