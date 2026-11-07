def ribbon_revenue(length: int, prices: list[int]) -> int:
    best = [0] * (length + 1)
    for total in range(1, length + 1):
        top = 0
        for k in range(min(total, len(prices))):
            cand = prices[k] + best[total - k - 1]
            if cand > top:
                top = cand
        best[total] = top
    return best[length]
