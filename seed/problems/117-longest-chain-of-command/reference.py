def longest_chain_of_command(parents):
    n = len(parents)
    depth = [0] * n
    for start in range(n):
        if depth[start]:
            continue
        path = []
        v = start
        while v != -1 and depth[v] == 0:
            path.append(v)
            v = parents[v]
        base = depth[v] if v != -1 else 0
        for u in reversed(path):
            base += 1
            depth[u] = base
    return max(depth)
