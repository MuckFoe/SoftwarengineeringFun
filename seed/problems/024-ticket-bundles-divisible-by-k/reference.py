def count_divisible_bundles(counts: list[int], k: int) -> int:
    seen = {0: 1}
    total = 0
    pairs = 0
    for v in counts:
        total = (total + v) % k
        c = seen.get(total, 0)
        pairs += c
        seen[total] = c + 1
    return pairs
