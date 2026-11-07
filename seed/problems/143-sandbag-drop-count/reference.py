def sandbags_to_drop(weights: list[int], needed: int) -> int:
    if needed <= 0:
        return 0
    dropped = 0
    for count, w in enumerate(sorted(weights, reverse=True), start=1):
        dropped += w
        if dropped >= needed:
            return count
    return -1
