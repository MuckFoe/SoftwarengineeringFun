def count_safe_codes(n: int, banned: list[str], k: int) -> int:
    MOD = 1_000_000_007
    go = [[-1] * k]
    bad = [False]
    for w in banned:
        v = 0
        for ch in w:
            c = ord(ch) - 97
            if go[v][c] == -1:
                go.append([-1] * k)
                bad.append(False)
                go[v][c] = len(go) - 1
            v = go[v][c]
        bad[v] = True
    fail = [0] * len(go)
    queue = []
    for c in range(k):
        u = go[0][c]
        if u == -1:
            go[0][c] = 0
        else:
            queue.append(u)
    qi = 0
    while qi < len(queue):
        v = queue[qi]
        qi += 1
        bad[v] = bad[v] or bad[fail[v]]
        for c in range(k):
            u = go[v][c]
            if u == -1:
                go[v][c] = go[fail[v]][c]
            else:
                fail[u] = go[fail[v]][c]
                queue.append(u)
    m = len(go)
    dp = [0] * m
    dp[0] = 1
    for _ in range(n):
        nd = [0] * m
        for v in range(m):
            x = dp[v]
            if x:
                for c in range(k):
                    u = go[v][c]
                    if not bad[u]:
                        nd[u] = (nd[u] + x) % MOD
        dp = nd
    return sum(dp) % MOD
