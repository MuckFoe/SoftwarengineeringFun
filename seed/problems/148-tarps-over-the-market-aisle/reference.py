def fewest_tarps(length: int, tarps: list[list[int]]) -> int:
    if length <= 0:
        return 0
    ordered = sorted(tarps)
    covered = 0
    used = 0
    i = 0
    n = len(ordered)
    while covered < length:
        best = covered
        while i < n and ordered[i][0] <= covered:
            if ordered[i][1] > best:
                best = ordered[i][1]
            i += 1
        if best == covered:
            return -1
        covered = best
        used += 1
    return used
