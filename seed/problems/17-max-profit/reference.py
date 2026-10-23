def max_profit(prices: list[int]) -> int:
    if not prices:
        return 0
    best = 0
    lowest = prices[0]
    for price in prices[1:]:
        best = max(best, price - lowest)
        lowest = min(lowest, price)
    return best
