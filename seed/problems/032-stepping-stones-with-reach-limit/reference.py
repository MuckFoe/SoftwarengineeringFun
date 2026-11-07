from collections import deque


def cheapest_crossing(costs: list[int], k: int) -> int:
    n = len(costs)
    best = [0] * n
    window: deque[int] = deque()  # indices with increasing best values
    for i in range(n):
        while window and window[0] < i - k:
            window.popleft()
        best[i] = costs[i] + (best[window[0]] if window else 0)
        while window and best[window[-1]] >= best[i]:
            window.pop()
        window.append(i)
    return best[-1]
