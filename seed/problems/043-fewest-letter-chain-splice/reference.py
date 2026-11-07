def shortest_splice_length(words: list[str]) -> int:
    ws = sorted(set(words))
    ws = [w for w in ws if not any(w != o and w in o for o in ws)]
    n = len(ws)
    if n == 0:
        return 0

    def overlap(a, b):
        for k in range(min(len(a), len(b)), 0, -1):
            if a.endswith(b[:k]):
                return k
        return 0

    ov = [[overlap(ws[i], ws[j]) if i != j else 0 for j in range(n)] for i in range(n)]
    INF = float('inf')
    dp = [[INF] * n for _ in range(1 << n)]
    for i in range(n):
        dp[1 << i][i] = len(ws[i])
    for mask in range(1, 1 << n):
        for last in range(n):
            cur = dp[mask][last]
            if cur == INF:
                continue
            for j in range(n):
                if mask >> j & 1:
                    continue
                nm = mask | 1 << j
                val = cur + len(ws[j]) - ov[last][j]
                if val < dp[nm][j]:
                    dp[nm][j] = val
    return min(dp[(1 << n) - 1])
