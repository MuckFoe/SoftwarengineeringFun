def smallest_hauler_load(weights: list[int], days: int) -> int:
    if not weights:
        return 0

    def fits(limit: int) -> bool:
        used, load = 1, 0
        for w in weights:
            if load + w > limit:
                used += 1
                load = 0
            load += w
        return used <= days

    lo, hi = max(weights), sum(weights)
    while lo < hi:
        mid = (lo + hi) // 2
        if fits(mid):
            hi = mid
        else:
            lo = mid + 1
    return lo
