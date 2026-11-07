import heapq


def cheapest_night_journey(n, legs, fee, start, goal):
    if start == goal:
        return 0
    adj = [[] for _ in range(n)]
    for a, b, fare in legs:
        adj[a].append((b, fare + fee))
    INF = float("inf")
    dist = [INF] * n
    dist[start] = 0
    heap = [(0, start)]
    while heap:
        d, v = heapq.heappop(heap)
        if d > dist[v]:
            continue
        if v == goal:
            return d - fee
        for w, c in adj[v]:
            nd = d + c
            if nd < dist[w]:
                dist[w] = nd
                heapq.heappush(heap, (nd, w))
    return -1
