def flattest_pass_queries(n, trails, trips):
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    adj = [[] for _ in range(n)]
    for a, b, w in sorted(trails, key=lambda t: t[2]):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
            adj[a].append((b, w))
            adj[b].append((a, w))
    comp = [-1] * n
    depth = [0] * n
    up0 = list(range(n))
    mx0 = [0] * n
    for r in range(n):
        if comp[r] != -1:
            continue
        comp[r] = r
        order = [r]
        for v in order:
            for w, c in adj[v]:
                if comp[w] == -1:
                    comp[w] = r
                    depth[w] = depth[v] + 1
                    up0[w] = v
                    mx0[w] = c
                    order.append(w)
    LOG = max(1, (max(depth) + 1).bit_length())
    up = [up0]
    mx = [mx0]
    for k in range(1, LOG):
        pu, pm = up[-1], mx[-1]
        up.append([pu[pu[v]] for v in range(n)])
        mx.append([max(pm[v], pm[pu[v]]) for v in range(n)])
    out = []
    for s, t in trips:
        if comp[s] != comp[t]:
            out.append(-1)
            continue
        best = 0
        if depth[s] < depth[t]:
            s, t = t, s
        diff = depth[s] - depth[t]
        for k in range(LOG):
            if diff >> k & 1:
                best = max(best, mx[k][s])
                s = up[k][s]
        if s != t:
            for k in range(LOG - 1, -1, -1):
                if up[k][s] != up[k][t]:
                    best = max(best, mx[k][s], mx[k][t])
                    s, t = up[k][s], up[k][t]
            best = max(best, mx[0][s], mx[0][t])
        out.append(best)
    return out
