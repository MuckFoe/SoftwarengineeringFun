def fewest_hops(reach: list[int]) -> int:
    n = len(reach)
    if n <= 1:
        return 0
    hops = 0
    window_end = 0
    farthest = 0
    for i in range(n - 1):
        if i > farthest:
            return -1
        farthest = max(farthest, i + reach[i])
        if i == window_end:
            hops += 1
            window_end = farthest
            if window_end >= n - 1:
                return hops
    return -1
