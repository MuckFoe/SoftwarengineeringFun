from itertools import permutations


def latin_tile_completions(grid: list[list[int]]) -> int:
    n = len(grid)
    for i in range(n):
        for j in range(n):
            v = grid[i][j]
            if v:
                for k in range(n):
                    if (k != j and grid[i][k] == v) or (k != i and grid[k][j] == v):
                        return 0
    perms = list(permutations(range(1, n + 1)))
    memo = {}

    def go(row, cols):
        if row == n:
            return 1
        key = (row, cols)
        if key in memo:
            return memo[key]
        total = 0
        for p in perms:
            ok = True
            for c in range(n):
                g = grid[row][c]
                if (g and g != p[c]) or (cols[c] >> p[c]) & 1:
                    ok = False
                    break
            if ok:
                nxt = tuple(cols[c] | (1 << p[c]) for c in range(n))
                total += go(row + 1, nxt)
        memo[key] = total
        return total

    return go(0, (0,) * n)
