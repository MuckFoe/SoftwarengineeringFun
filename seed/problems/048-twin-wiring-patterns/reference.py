def count_twin_patterns(labels: list[str]) -> int:
    counts = {}
    total = 0
    for s in labels:
        ids = {}
        sig = []
        for ch in s:
            if ch not in ids:
                ids[ch] = len(ids)
            sig.append(ids[ch])
        key = tuple(sig)
        k = counts.get(key, 0)
        total += k
        counts[key] = k + 1
    return total
