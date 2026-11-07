def longest_shelf(shelf: list[int], k: int) -> int:
    if k <= 0:
        return 0
    counts = {}
    left = 0
    best = 0
    for right, v in enumerate(shelf):
        counts[v] = counts.get(v, 0) + 1
        while len(counts) > k:
            u = shelf[left]
            counts[u] -= 1
            if counts[u] == 0:
                del counts[u]
            left += 1
        best = max(best, right - left + 1)
    return best
