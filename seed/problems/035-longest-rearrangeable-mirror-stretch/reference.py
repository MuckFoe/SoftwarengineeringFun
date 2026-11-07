def longest_mirror_stretch(s: str) -> int:
    first = {0: -1}
    mask = 0
    best = 0
    for i, ch in enumerate(s):
        mask ^= 1 << (ord(ch) - 97)
        if mask in first:
            best = max(best, i - first[mask])
        else:
            first[mask] = i
        for b in range(26):
            j = first.get(mask ^ (1 << b))
            if j is not None:
                best = max(best, i - j)
    return best
