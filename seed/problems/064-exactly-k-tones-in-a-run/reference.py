def _at_most(melody: list[int], k: int) -> int:
    if k <= 0:
        return 0
    counts = {}
    left = 0
    total = 0
    for right, v in enumerate(melody):
        counts[v] = counts.get(v, 0) + 1
        while len(counts) > k:
            u = melody[left]
            counts[u] -= 1
            if counts[u] == 0:
                del counts[u]
            left += 1
        total += right - left + 1
    return total


def exactly_k_tones(melody: list[int], k: int) -> int:
    if k <= 0:
        return 0
    return _at_most(melody, k) - _at_most(melody, k - 1)
