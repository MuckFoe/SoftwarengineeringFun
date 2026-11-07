from functools import lru_cache


def dominoes_on_a_cracked_floor(grid: list[str]) -> int:
    h, w = len(grid), len(grid[0])
    blocked = [grid[r][c] == "#" for r in range(h) for c in range(w)]
    total_cells = h * w

    @lru_cache(maxsize=None)
    def go(pos, mask):
        if pos == total_cells:
            return 1 if mask == 0 else 0
        if blocked[pos] or mask & 1:
            return go(pos + 1, mask >> 1)
        r, c = divmod(pos, w)
        total = 0
        if c + 1 < w and not blocked[pos + 1] and not mask & 2:
            total += go(pos + 1, (mask >> 1) | 1)
        if r + 1 < h and not blocked[pos + w]:
            total += go(pos + 1, (mask >> 1) | (1 << (w - 1)))
        return total

    return go(0, 0)
