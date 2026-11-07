def lantern_pairs_at_distance(n, paths, k):
    adj = [[] for _ in range(n)]
    for a, b in paths:
        adj[a].append(b)
        adj[b].append(a)
    parent = [-1] * n
    order = [0]
    seen = [False] * n
    seen[0] = True
    for v in order:
        for w in adj[v]:
            if not seen[w]:
                seen[w] = True
                parent[w] = v
                order.append(w)
    cnt = [None] * n
    total = 0
    for v in reversed(order):
        mine = cnt[v]
        if mine is None:
            mine = [0] * (k + 1)
            mine[0] = 1
        p = parent[v]
        if p == -1:
            break
        pc = cnt[p]
        if pc is None:
            pc = [0] * (k + 1)
            pc[0] = 1
            cnt[p] = pc
        for i in range(k):
            total += pc[k - 1 - i] * mine[i]
        for i in range(k):
            pc[i + 1] += mine[i]
        cnt[v] = None
    return total
