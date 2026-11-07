from collections import deque


def beacon_distance_map(n, links, beacons):
    adj = [[] for _ in range(n)]
    for a, b in links:
        adj[a].append(b)
        adj[b].append(a)
    dist = [-1] * n
    queue = deque()
    for b in beacons:
        dist[b] = 0
        queue.append(b)
    while queue:
        v = queue.popleft()
        for w in adj[v]:
            if dist[w] == -1:
                dist[w] = dist[v] + 1
                queue.append(w)
    return dist
