def lantern_score(glow: list[int]) -> int:
    vals = [1] + list(glow) + [1]
    n = len(vals)
    best = [[0] * n for _ in range(n)]
    for width in range(2, n):
        for lo in range(n - width):
            hi = lo + width
            top = 0
            base = vals[lo] * vals[hi]
            for last in range(lo + 1, hi):
                cand = best[lo][last] + best[last][hi] + base * vals[last]
                if cand > top:
                    top = cand
            best[lo][hi] = top
    return best[0][n - 1]
