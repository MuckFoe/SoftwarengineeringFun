import heapq


def max_events_attended(events: list[list[int]]) -> int:
    ordered = sorted(events)
    heap = []
    attended = 0
    day = 0
    i = 0
    n = len(ordered)
    while i < n or heap:
        if not heap:
            day = max(day, ordered[i][0])
        while i < n and ordered[i][0] <= day:
            heapq.heappush(heap, ordered[i][1])
            i += 1
        while heap and heap[0] < day:
            heapq.heappop(heap)
        if heap:
            heapq.heappop(heap)
            attended += 1
            day += 1
    return attended
