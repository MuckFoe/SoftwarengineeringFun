def near_pair_count(values: list[int], tolerance: int) -> int:
    ordered = sorted(values)
    total = 0
    left = 0
    for right, v in enumerate(ordered):
        while v - ordered[left] > tolerance:
            left += 1
        total += right - left
    return total
