from collections import deque


def window_swing_total(readings: list[int], k: int) -> int:
    hi = deque()
    lo = deque()
    total = 0
    for i, v in enumerate(readings):
        while hi and readings[hi[-1]] <= v:
            hi.pop()
        hi.append(i)
        while lo and readings[lo[-1]] >= v:
            lo.pop()
        lo.append(i)
        if hi[0] <= i - k:
            hi.popleft()
        if lo[0] <= i - k:
            lo.popleft()
        if i >= k - 1:
            total += readings[hi[0]] - readings[lo[0]]
    return total
