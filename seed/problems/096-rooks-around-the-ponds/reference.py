def rooks_around_the_ponds(n: int, ponds: list[list[int]]) -> int:
    blocked = [0] * n
    for r, c in ponds:
        blocked[r] |= 1 << c
    memo = {}

    def go(row, used):
        if row == n:
            return 1
        if used in memo:
            return memo[used]
        total = 0
        free = ~(used | blocked[row]) & ((1 << n) - 1)
        while free:
            bit = free & -free
            free ^= bit
            total += go(row + 1, used | bit)
        memo[used] = total
        return total

    return go(0, 0)
