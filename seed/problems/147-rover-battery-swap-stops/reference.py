import heapq


def min_swap_stops(target: int, start_charge: int, stations: list[list[int]]) -> int:
    if start_charge >= target:
        return 0
    reach = start_charge
    stops = 0
    heap = []
    i = 0
    n = len(stations)
    while reach < target:
        while i < n and stations[i][0] <= reach:
            heapq.heappush(heap, -stations[i][1])
            i += 1
        if not heap:
            return -1
        reach += -heapq.heappop(heap)
        stops += 1
    return stops
