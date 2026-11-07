def critical_cables(n, cables):
    adj = [[] for _ in range(n)]
    for idx, (a, b) in enumerate(cables):
        adj[a].append((b, idx))
        adj[b].append((a, idx))
    tin = [-1] * n
    low = [0] * n
    timer = 0
    found = []
    for root in range(n):
        if tin[root] != -1:
            continue
        tin[root] = low[root] = timer
        timer += 1
        stack = [(root, -1, 0)]
        while stack:
            v, pe, i = stack.pop()
            if i < len(adj[v]):
                stack.append((v, pe, i + 1))
                w, eid = adj[v][i]
                if eid == pe:
                    continue
                if tin[w] == -1:
                    tin[w] = low[w] = timer
                    timer += 1
                    stack.append((w, eid, 0))
                else:
                    if tin[w] < low[v]:
                        low[v] = tin[w]
            elif stack:
                p = stack[-1][0]
                if low[v] < low[p]:
                    low[p] = low[v]
                if low[v] > tin[p]:
                    found.append([min(p, v), max(p, v)])
    found.sort()
    return found
