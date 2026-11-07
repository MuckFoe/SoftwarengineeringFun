import heapq


def best_rush_reward(orders: list[list[int]]) -> int:
    heap = []
    for deadline, reward in sorted(orders, key=lambda o: o[0]):
        heapq.heappush(heap, reward)
        if len(heap) > deadline:
            heapq.heappop(heap)
    return sum(heap)
