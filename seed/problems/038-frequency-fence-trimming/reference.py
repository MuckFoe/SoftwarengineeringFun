def min_deletions_unique_freq(s: str) -> int:
    counts = {}
    for c in s:
        counts[c] = counts.get(c, 0) + 1
    used = set()
    dels = 0
    for f in sorted(counts.values(), reverse=True):
        while f > 0 and f in used:
            f -= 1
            dels += 1
        if f > 0:
            used.add(f)
    return dels
