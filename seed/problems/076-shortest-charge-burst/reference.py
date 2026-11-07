from collections import deque


def shortest_charge_burst(changes: list[int], goal: int) -> int:
    n = len(changes)
    prefix = [0] * (n + 1)
    for i, c in enumerate(changes):
        prefix[i + 1] = prefix[i] + c
    best = n + 1
    window = deque()
    for j in range(n + 1):
        while window and prefix[j] - prefix[window[0]] >= goal:
            best = min(best, j - window.popleft())
        while window and prefix[window[-1]] >= prefix[j]:
            window.pop()
        window.append(j)
    return best if best <= n else -1
