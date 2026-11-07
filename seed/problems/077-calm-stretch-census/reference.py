from collections import deque


def calm_stretch_census(temps: list[int], limit: int) -> int:
    hi = deque()
    lo = deque()
    left = 0
    count = 0
    for right, v in enumerate(temps):
        while hi and temps[hi[-1]] <= v:
            hi.pop()
        hi.append(right)
        while lo and temps[lo[-1]] >= v:
            lo.pop()
        lo.append(right)
        while temps[hi[0]] - temps[lo[0]] > limit:
            left += 1
            if hi[0] < left:
                hi.popleft()
            if lo[0] < left:
                lo.popleft()
        count += right - left + 1
    return count
