def kth_in_sorted_grid(grid: list[list[int]], k: int) -> int:
    rows, cols = len(grid), len(grid[0])

    def count_at_most(limit: int) -> int:
        total = 0
        c = cols - 1
        for r in range(rows):
            while c >= 0 and grid[r][c] > limit:
                c -= 1
            if c < 0:
                break
            total += c + 1
        return total

    lo, hi = grid[0][0], grid[-1][-1]
    while lo < hi:
        mid = (lo + hi) // 2
        if count_at_most(mid) >= k:
            hi = mid
        else:
            lo = mid + 1
    return lo
