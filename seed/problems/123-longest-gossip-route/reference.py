def longest_gossip_route(n, lanes):
    adj = [[] for _ in range(n)]
    for a, b, w in lanes:
        adj[a].append((b, w))
        adj[b].append((a, w))

    def farthest(src):
        dist = [-1] * n
        dist[src] = 0
        stack = [src]
        best = src
        while stack:
            v = stack.pop()
            if dist[v] > dist[best]:
                best = v
            for w, c in adj[v]:
                if dist[w] == -1:
                    dist[w] = dist[v] + c
                    stack.append(w)
        return best, dist[best]

    end, _ = farthest(0)
    _, total = farthest(end)
    return total
