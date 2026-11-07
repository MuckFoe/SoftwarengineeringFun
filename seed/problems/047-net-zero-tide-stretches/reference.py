def count_net_zero(changes: list[int]) -> int:
    seen = {0: 1}
    total = 0
    result = 0
    for c in changes:
        total += c
        k = seen.get(total, 0)
        result += k
        seen[total] = k + 1
    return result
