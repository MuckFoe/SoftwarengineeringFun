def closest_split_gap(weights: list[int]) -> int:
    total = sum(weights)
    reach = 1
    for w in weights:
        reach |= reach << w
    half = total // 2
    for s in range(half, -1, -1):
        if (reach >> s) & 1:
            return total - 2 * s
    return total
