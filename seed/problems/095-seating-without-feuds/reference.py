from functools import lru_cache


def seating_without_feuds(guests: int, feuds: list[list[int]]) -> int:
    bad = [0] * guests
    for a, b in feuds:
        bad[a] |= 1 << b
        bad[b] |= 1 << a
    full = (1 << guests) - 1

    @lru_cache(maxsize=None)
    def count(seated, last):
        if seated == full:
            return 1
        total = 0
        for g in range(guests):
            if seated >> g & 1 or bad[last] >> g & 1:
                continue
            total += count(seated | 1 << g, g)
        return total

    return sum(count(1 << g, g) for g in range(guests))
