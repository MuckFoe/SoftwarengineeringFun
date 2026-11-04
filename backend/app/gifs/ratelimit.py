"""In-memory per-key sliding-window rate limiter (NFR-3). Pure: the clock is injected."""

import math
from collections import deque
from collections.abc import Callable, Hashable

SEARCHES_PER_MINUTE = 20
POSTS_PER_MINUTE = 5


class SlidingWindowLimiter:
    """Allow at most `limit` acquires per key within any `window_s` seconds."""

    def __init__(self, limit: int, window_s: float, now: Callable[[], float]) -> None:
        self._limit = limit
        self._window_s = window_s
        self._now = now
        self._hits: dict[Hashable, deque[float]] = {}

    def try_acquire(self, key: Hashable) -> int | None:
        """None: allowed and recorded. int: refused (not recorded), seconds to wait."""
        t = self._now()
        hits = self._hits.setdefault(key, deque())
        while hits and hits[0] <= t - self._window_s:
            hits.popleft()
        if len(hits) < self._limit:
            hits.append(t)
            return None
        return max(1, math.ceil(hits[0] + self._window_s - t))
