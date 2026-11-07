def rooftop_lookouts(heights: list[int]) -> list[int]:
    n = len(heights)
    result = [0] * n
    seen = []
    for i in range(n - 1, -1, -1):
        h = heights[i]
        result[i] = len(seen)
        while seen and seen[-1] <= h:
            seen.pop()
        seen.append(h)
    return result
