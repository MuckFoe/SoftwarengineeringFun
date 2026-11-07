def nearest_shared_boss(parents, pairs):
    n = len(parents)
    children = [[] for _ in range(n)]
    root = 0
    for i, p in enumerate(parents):
        if p == -1:
            root = i
        else:
            children[p].append(i)
    depth = [0] * n
    order = [root]
    for v in order:
        for c in children[v]:
            depth[c] = depth[v] + 1
            order.append(c)
    LOG = max(1, (max(depth) + 1).bit_length())
    up = [[root] * n]
    for v in range(n):
        if parents[v] != -1:
            up[0][v] = parents[v]
    for k in range(1, LOG):
        prev = up[k - 1]
        up.append([prev[prev[v]] for v in range(n)])
    out = []
    for a, b in pairs:
        if depth[a] < depth[b]:
            a, b = b, a
        diff = depth[a] - depth[b]
        for k in range(LOG):
            if diff >> k & 1:
                a = up[k][a]
        if a != b:
            for k in range(LOG - 1, -1, -1):
                if up[k][a] != up[k][b]:
                    a, b = up[k][a], up[k][b]
            a = up[0][a]
        out.append(a)
    return out
