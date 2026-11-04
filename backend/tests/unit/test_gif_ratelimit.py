"""NFR-3: per-participant sliding-window limits on GIF searches and posts."""

import pytest

from app.gifs.ratelimit import POSTS_PER_MINUTE, SEARCHES_PER_MINUTE, SlidingWindowLimiter


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def test_limits_match_spec() -> None:
    assert SEARCHES_PER_MINUTE == 20
    assert POSTS_PER_MINUTE == 5


@pytest.mark.parametrize("limit", [SEARCHES_PER_MINUTE, POSTS_PER_MINUTE])
def test_limit_reached_refuses_with_retry_after(limit: int) -> None:
    clock = Clock()
    lim = SlidingWindowLimiter(limit, 60, clock)
    for _ in range(limit):
        assert lim.try_acquire(("s1", "Ada")) is None
        clock.t += 0.5
    retry = lim.try_acquire(("s1", "Ada"))
    assert retry is not None
    assert retry >= 1


@pytest.mark.parametrize("limit", [SEARCHES_PER_MINUTE, POSTS_PER_MINUTE])
def test_other_participants_unaffected(limit: int) -> None:
    clock = Clock()
    lim = SlidingWindowLimiter(limit, 60, clock)
    for _ in range(limit):
        lim.try_acquire(("s1", "Ada"))
    assert lim.try_acquire(("s1", "Ada")) is not None
    assert lim.try_acquire(("s1", "Grace")) is None
    assert lim.try_acquire(("s2", "Ada")) is None


@pytest.mark.parametrize("limit", [SEARCHES_PER_MINUTE, POSTS_PER_MINUTE])
def test_allowed_again_after_window(limit: int) -> None:
    clock = Clock()
    lim = SlidingWindowLimiter(limit, 60, clock)
    for _ in range(limit):
        lim.try_acquire("k")
    retry = lim.try_acquire("k")
    assert retry is not None
    clock.t += retry
    assert lim.try_acquire("k") is None


@pytest.mark.parametrize("limit", [SEARCHES_PER_MINUTE, POSTS_PER_MINUTE])
def test_window_slides_one_slot_at_a_time(limit: int) -> None:
    clock = Clock()
    lim = SlidingWindowLimiter(limit, 60, clock)
    lim.try_acquire("k")  # t=1000
    clock.t += 30
    for _ in range(limit - 1):
        lim.try_acquire("k")  # t=1030
    clock.t += 30.5  # first call has aged out, the rest have not
    assert lim.try_acquire("k") is None
    assert lim.try_acquire("k") is not None


@pytest.mark.parametrize("limit", [SEARCHES_PER_MINUTE, POSTS_PER_MINUTE])
def test_refused_calls_do_not_extend_wait(limit: int) -> None:
    clock = Clock()
    lim = SlidingWindowLimiter(limit, 60, clock)
    for _ in range(limit):
        lim.try_acquire("k")  # all at t=1000
    clock.t += 10
    first = lim.try_acquire("k")
    for _ in range(30):
        clock.t += 1
        assert lim.try_acquire("k") is not None
    clock.t = 1060
    assert first == 50
    assert lim.try_acquire("k") is None


def test_retry_after_is_whole_seconds_rounded_up() -> None:
    clock = Clock()
    lim = SlidingWindowLimiter(1, 60, clock)
    lim.try_acquire("k")
    clock.t += 59.9
    assert lim.try_acquire("k") == 1
