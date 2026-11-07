def courier_round_trip(dist: list[list[int]]) -> int:
    n = len(dist)
    if n == 1:
        return 0
    inf = float("inf")
    m = n - 1  # stops 1..n-1 map to bits 0..m-1
    full = 1 << m
    dp = [[inf] * m for _ in range(full)]
    for j in range(m):
        dp[1 << j][j] = dist[0][j + 1]
    for mask in range(1, full):
        row = dp[mask]
        for last in range(m):
            cur = row[last]
            if cur == inf:
                continue
            for nxt in range(m):
                bit = 1 << nxt
                if mask & bit:
                    continue
                cand = cur + dist[last + 1][nxt + 1]
                if cand < dp[mask | bit][nxt]:
                    dp[mask | bit][nxt] = cand
    return min(dp[full - 1][j] + dist[j + 1][0] for j in range(m))
