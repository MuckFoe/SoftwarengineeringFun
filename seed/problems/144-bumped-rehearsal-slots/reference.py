def bumped_rehearsals(slots: list[list[int]]) -> int:
    kept = 0
    last_end = None
    for start, end in sorted(slots, key=lambda s: (s[1], s[0])):
        if last_end is None or start >= last_end:
            kept += 1
            last_end = end
    return len(slots) - kept
