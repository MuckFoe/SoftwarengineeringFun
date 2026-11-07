import heapq


def cheapest_with_coupons(n, legs, coupons, start, goal):
    adj = [[] for _ in range(n)]
    for a, b, fare in legs:
        adj[a].append((b, fare))
    INF = float("inf")
    width = coupons + 1
    dist = [INF] * (n * width)
    dist[start * width] = 0
    heap = [(0, start, 0)]
    while heap:
        d, v, used = heapq.heappop(heap)
        if d > dist[v * width + used]:
            continue
        if v == goal:
            return d
        for w, fare in adj[v]:
            nd = d + fare
            if nd < dist[w * width + used]:
                dist[w * width + used] = nd
                heapq.heappush(heap, (nd, w, used))
            if used < coupons and d < dist[w * width + used + 1]:
                dist[w * width + used + 1] = d
                heapq.heappush(heap, (d, w, used + 1))
    return -1
