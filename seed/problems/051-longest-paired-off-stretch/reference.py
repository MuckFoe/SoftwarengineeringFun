def longest_paired_off(s: str) -> int:
    first = {0: -1}
    mask = 0
    best = 0
    for i, ch in enumerate(s):
        mask ^= 1 << (ord(ch) - 97)
        if mask in first:
            best = max(best, i - first[mask])
        else:
            first[mask] = i
    return best
