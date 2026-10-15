"""The only source of "now", so tests can control time (FR-28, FR-29)."""

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

_override: datetime | None = None


def now() -> datetime:
    return _override if _override is not None else datetime.now(UTC)


@contextmanager
def frozen(at: datetime) -> Iterator[None]:
    global _override
    previous, _override = _override, at
    try:
        yield
    finally:
        _override = previous
