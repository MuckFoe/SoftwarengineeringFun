def lucky_ticket_census(lo: int, hi: int, s: int) -> int:
    def upto(n):
        if n < 0:
            return 0
        digs = list(map(int, str(n)))
        L = len(digs)
        # ways[r][t]: r free digits summing to t
        ways = [[0] * (s + 1) for _ in range(L + 1)]
        ways[0][0] = 1
        for r in range(1, L + 1):
            for t in range(s + 1):
                ways[r][t] = sum(ways[r - 1][t - d] for d in range(10) if t - d >= 0)
        total = 0
        used = 0
        for i, d in enumerate(digs):
            for c in range(d):
                need = s - used - c
                if need >= 0:
                    total += ways[L - i - 1][need]
            used += d
            if used > s:
                break
        else:
            if used == s:
                total += 1
        return total
    return upto(hi) - upto(lo - 1)
