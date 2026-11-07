def ferry_pairs(weights: list[int], cap: int) -> int:
    i, j = 0, len(weights) - 1
    total = 0
    while i < j:
        if weights[i] + weights[j] <= cap:
            total += j - i
            i += 1
        else:
            j -= 1
    return total
