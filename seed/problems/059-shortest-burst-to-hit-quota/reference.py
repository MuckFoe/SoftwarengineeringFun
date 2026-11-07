def shortest_burst(sales: list[int], quota: int) -> int:
    best = 0
    total = 0
    left = 0
    for right, v in enumerate(sales):
        total += v
        while total >= quota:
            length = right - left + 1
            if best == 0 or length < best:
                best = length
            total -= sales[left]
            left += 1
    return best
