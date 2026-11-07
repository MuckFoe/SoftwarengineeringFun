import heapq


def oven_schedule(n, rules):
    adj = [[] for _ in range(n)]
    indeg = [0] * n
    for a, b in rules:
        adj[a].append(b)
        indeg[b] += 1
    heap = [v for v in range(n) if indeg[v] == 0]
    heapq.heapify(heap)
    order = []
    while heap:
        v = heapq.heappop(heap)
        order.append(v)
        for w in adj[v]:
            indeg[w] -= 1
            if indeg[w] == 0:
                heapq.heappush(heap, w)
    return order if len(order) == n else []
