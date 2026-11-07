def busiest_initial(names: list[str]) -> str:
    counts = {}
    for name in names:
        ch = name[0].lower()
        counts[ch] = counts.get(ch, 0) + 1
    if not counts:
        return ""
    best = max(counts.values())
    return min(ch for ch, c in counts.items() if c == best)
