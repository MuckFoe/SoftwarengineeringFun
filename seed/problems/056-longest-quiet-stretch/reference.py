def longest_quiet(levels: list[int], limit: int) -> int:
    best = 0
    start = 0
    for end, v in enumerate(levels):
        if v > limit:
            start = end + 1
        else:
            best = max(best, end - start + 1)
    return best
