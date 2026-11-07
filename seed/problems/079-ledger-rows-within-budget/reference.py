def count_within_budget(prices: list[int], budget: int) -> int:
    lo, hi = 0, len(prices)
    while lo < hi:
        mid = (lo + hi) // 2
        if prices[mid] <= budget:
            lo = mid + 1
        else:
            hi = mid
    return lo
