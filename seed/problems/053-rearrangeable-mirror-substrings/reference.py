def count_mirror_rearrangeable(s: str) -> int:
    counts = {0: 1}
    mask = 0
    total = 0
    for ch in s:
        mask ^= 1 << (ord(ch) - 97)
        total += counts.get(mask, 0)
        for b in range(26):
            total += counts.get(mask ^ (1 << b), 0)
        counts[mask] = counts.get(mask, 0) + 1
    return total
