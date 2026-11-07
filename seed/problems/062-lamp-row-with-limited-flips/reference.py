def longest_lit(lamps: list[int], k: int) -> int:
    zeros = 0
    left = 0
    best = 0
    for right, v in enumerate(lamps):
        if v == 0:
            zeros += 1
        while zeros > k:
            if lamps[left] == 0:
                zeros -= 1
            left += 1
        best = max(best, right - left + 1)
    return best
